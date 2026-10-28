import { moment, Notice } from "obsidian";
import type { Editor, EditorPosition } from "obsidian";
import { mapTabstops, resolveTabstops, substituteVariables } from "../engine/placeholders";
import { clock } from "./clock";
import { readClipboardSafe } from "./clipboard";
import { expand } from "../engine";
import type { Dict, EditPlan, ExpandContext, ExpandInput } from "../engine/types";
import { isSeparator } from "../shared/delimiters";
import { isInFencedCode, isInInlineCode, isInMath, isInYamlFrontmatter } from "../shared/markdown";

export function makeExpandInput(
    editor: Editor,
    sepCh: number,
    lastTyped: string,
    line?: number,
    /** B-137: opt-in trigger-prefix mode, threaded straight through to
     *  `ExpandInput.prefix`. `undefined` (the default) = mode off,
     *  identical to pre-1.3.0 behavior. */
    prefix?: string,
): ExpandInput {
    const targetLine = line ?? editor.getCursor().line;
    const lineText = editor.getLine(targetLine) ?? "";
    const textBefore = lineText.slice(0, sepCh);
    const textAfter = lineText.slice(sepCh + 1);
    return { textBefore, textAfter, lastTyped, sepCh, prefix };
}

export function makeContext(
    editor: Editor,
    filename: string | undefined,
    now: Date,
    readClipboard?: () => Promise<string>,
    /** B-148: the line/column the trigger actually lives on. Defaults
     *  to the live cursor (original behavior) — callers that resolved
     *  a newline-separator against the PREVIOUS line pass these
     *  explicitly so context checks (fenced code / frontmatter /
     *  inline code) evaluate where the trigger was typed, not
     *  wherever the cursor ended up after Enter. */
    line?: number,
    ch?: number,
): ExpandContext {
    const cursor = editor.getCursor();
    const targetLine = line ?? cursor.line;
    const targetCh = ch ?? cursor.ch;
    const getLine = (i: number) => editor.getLine(i) ?? "";
    const last = editor.lastLine();

    const isFront = isInYamlFrontmatter(getLine, last, targetLine);
    const isFence = isInFencedCode(getLine, last, targetLine);
    const isInline = isInInlineCode(getLine(targetLine), targetCh);
    // B-167: `$…$` / `$$…$$` — one more top-down pass, skipped cheaply on `$`-free lines.
    const isMath = isInMath(getLine, last, targetLine, targetCh);

    return {
        isInCode: isFence || isInline,
        isInMath: isMath,
        isInFrontmatter: isFront,
        filename,
        now,
        formatDate: (date, format) => moment(date).format(format),
        readClipboard
    };
}

/**
 * Applies an `EditPlan` at an explicit target `line`.
 *
 * B-136: this used to re-read `editor.getCursor()` internally rather
 * than take the line as a parameter. `tryExpandAtSeparator` computes
 * `plan` via `await expand(...)`, which does a real await when the
 * replacement contains `$clipboard` (`readClipboard` hits
 * `navigator.clipboard`). If the user pressed Enter or clicked
 * elsewhere during that await, the live cursor no longer pointed at
 * the line the trigger was on — the old code would apply
 * `plan.fromCh/toCh` to whatever line the cursor happened to be on
 * *now*, corrupting unrelated text. Callers must snapshot the target
 * line before any await and pass it explicitly.
 *
 * B-147: the text edit above always targets the explicit `line`/`ch`
 * coordinates, so it's safe regardless of where the live cursor is.
 * Repositioning the cursor via `plan.newCursor` is a different
 * story — it's relative to `line`, and only makes sense if the user
 * is still sitting on that line. If they moved to another line during
 * the async gap (or — B-148 — if `line` refers to the PREVIOUS line
 * because the separator was Enter, and the live cursor is legitimately
 * one line further down already, exactly where Enter put it), forcing
 * the cursor back would teleport it away from wherever the user
 * actually is. Read the live cursor BEFORE the edit (so the check
 * reflects the user's real position, not any auto-mapping the editor
 * might do in response to `replaceRange`) and skip the reposition —
 * not the text edit — when it isn't on `line`.
 */
export function applyEditPlan(editor: Editor, plan: EditPlan, line: number) {
    const userStillOnTargetLine = editor.getCursor().line === line;

    const from: EditorPosition = { line, ch: plan.fromCh };
    const to: EditorPosition = { line, ch: plan.toCh };
    editor.replaceRange(plan.insert, from, to);
    if (plan.newCursor !== undefined && userStillOnTargetLine) {
        editor.setCursor({
            line: line + plan.newCursor.lineDelta,
            ch: plan.newCursor.ch,
        });
    }
}

function advancePosition(from: EditorPosition, text: string): EditorPosition {
    const parts = text.split("\n");
    if (parts.length === 1) {
        return { line: from.line, ch: from.ch + text.length };
    }
    return {
        line: from.line + parts.length - 1,
        ch: parts[parts.length - 1]?.length ?? 0
    };
}

export async function tryExpandAtSeparator(
    editor: Editor,
    dict: Dict,
    deps: {
        filename?: string;
        now: Date;
        readClipboard?: () => Promise<string>;
        /** B-137: see `ExpandInput.prefix`. `undefined` = mode off. */
        prefix?: string;
    }
) {
    const cursor = editor.getCursor();

    // B-148: on the Obsidian/CM6 versions this now actually runs
    // against, pressing Enter reports a SINGLE `editor-change` event
    // with the cursor already at column 0 of the brand-new line —
    // not at the end of the line that held the trigger. The newline
    // itself never appears as a character on any one line, so it
    // can't be found via "the character right before the cursor, on
    // this line" the way a space/punctuation separator can. When the
    // cursor is at column 0 of a line after the first, treat the
    // line break as the separator and look at the END of the
    // PREVIOUS line — that's where the trigger actually was typed.
    const isNewlineSeparator = cursor.ch === 0 && cursor.line > 0;
    const targetLine = isNewlineSeparator ? cursor.line - 1 : cursor.line;
    const lineText = editor.getLine(targetLine) ?? "";

    let sepCh: number;
    let lastTyped: string;
    let ctxCh: number;
    if (isNewlineSeparator) {
        sepCh = lineText.length;
        lastTyped = "\n";
        ctxCh = sepCh;
    } else {
        if (cursor.ch === 0) return; // column 0 of the first line: nothing precedes it
        lastTyped = lineText[cursor.ch - 1] ?? "";
        if (!isSeparator(lastTyped)) return;
        sepCh = cursor.ch - 1;
        ctxCh = cursor.ch;
    }

    // B-136: snapshot the target line now — `expand()` below may
    // await an async clipboard read, during which the user can keep
    // typing, press Enter, or click elsewhere. `applyEditPlan` must
    // apply the plan to THIS line, not whatever line the cursor ends
    // up on after the await.
    const input = makeExpandInput(editor, sepCh, lastTyped, targetLine, deps.prefix);
    const ctx = makeContext(editor, deps.filename, deps.now, deps.readClipboard, targetLine, ctxCh);

    const plan = await expand(input, dict, ctx);
    if (!plan) return;

    // Cheap staleness guard: if the text the plan expects to replace
    // (the trigger + separator, as it read before the await) no
    // longer matches what's actually at that range now, the document
    // changed under us in some other way — skip the edit instead of
    // overwriting whatever is there now.
    const currentLineText = editor.getLine(targetLine) ?? "";
    const expectedSlice = lineText.slice(plan.fromCh, plan.toCh);
    const actualSlice = currentLineText.slice(plan.fromCh, plan.toCh);
    if (actualSlice !== expectedSlice) return;

    applyEditPlan(editor, plan, targetLine);
}

/** B-197: what the picker paths need to run the full placeholder pipeline. */
export type SnippetInsertDeps = {
    filename?: string;
    now?: Date;
    readClipboard?: () => Promise<string>;
};

function pickerContext(editor: Editor, deps: SnippetInsertDeps): ExpandContext {
    return makeContext(editor, deps.filename, deps.now ?? clock.now(), deps.readClipboard ?? readClipboardSafe);
}

function samePos(a: EditorPosition, b: EditorPosition): boolean {
    return a.line === b.line && a.ch === b.ch;
}

/** B-199: shown when the captured selection no longer holds the same text. */
const STALE_TARGET_NOTICE = "Snippet not inserted: the note changed";

/**
 * B-199: the user moved (or the note changed) during the async placeholder
 * resolution, so the live selection is not the captured one. Write over the
 * captured range ONLY if it still holds the captured selection text; if the
 * document changed above it (sync, another plugin) the positions are stale
 * and overwriting would hit the wrong characters, so write nothing and tell
 * the user instead.
 */
function replaceCapturedSelection(
    editor: Editor,
    text: string,
    from: EditorPosition,
    to: EditorPosition,
    selection: string,
): void {
    if (editor.getRange(from, to) !== selection) {
        new Notice(STALE_TARGET_NOTICE);
        return;
    }
    editor.replaceRange(text, from, to);
}

/**
 * Inserts a snippet at the current cursor position, running the same
 * placeholder pipeline as trigger expansion (B-192 tabstops, then B-197
 * variables, then the `$|` cursor). The target position is captured BEFORE
 * the (possibly async, `$clipboard`) substitution: if the user moved
 * meanwhile the text still lands at the captured position and the cursor is
 * left alone (B-136 / B-147).
 */
export async function insertSnippetAtCursor(
    editor: Editor,
    replacement: string,
    deps: SnippetInsertDeps = {},
): Promise<void> {
    const cursor = editor.getCursor();
    const selection = editor.getSelection();
    const from = selection ? editor.getCursor("from") : cursor;
    const to = selection ? editor.getCursor("to") : cursor;
    // B-199: cheap staleness probe for the no-selection target.
    const capturedLine = editor.getLine(cursor.line);
    const lineStillThere = (): boolean =>
        cursor.line <= editor.lastLine() && editor.getLine(cursor.line) === capturedLine;
    const resolved = await substituteVariables(resolveTabstops(replacement), pickerContext(editor, deps));

    // Handle cursor position after insertion
    const cursorMatch = resolved.indexOf('$|');
    let cleanReplacement = resolved;
    let cursorPrefix = "";

    if (cursorMatch !== -1) {
        // Remove $| from text
        cleanReplacement = resolved.replace(/\$\|/g, '');
        cursorPrefix = resolved.slice(0, cursorMatch);
    }

    if (!samePos(editor.getCursor(), cursor) || editor.getSelection() !== selection) {
        // The user moved during the await: insert where they chose, do not teleport the cursor.
        if (selection) {
            replaceCapturedSelection(editor, cleanReplacement, from, to, selection);
            return;
        }
        // B-199: the captured position is only trusted while its line still
        // has the text it had at capture time; otherwise the note changed
        // above it and the live cursor is the best target.
        const target = lineStillThere() ? cursor : editor.getCursor();
        editor.replaceRange(cleanReplacement, target, target);
        return;
    }

    if (selection) {
        // If there's a selection, replace it
        editor.replaceSelection(cleanReplacement);
        // Set cursor to the correct position
        if (cursorMatch >= 0) {
            try {
                const newCursor = advancePosition(from, cursorPrefix);
                editor.setCursor(newCursor);
            } catch (error) {
                console.warn('Failed to set cursor position:', error);
            }
        }
    } else {
        // Otherwise insert at cursor position
        editor.replaceRange(cleanReplacement, cursor, cursor);
        // Set cursor to the correct position
        if (cursorMatch >= 0) {
            try {
                const newCursor = advancePosition(from, cursorPrefix);
                editor.setCursor(newCursor);
            } catch (error) {
                console.warn('Failed to set cursor position:', error);
            }
        }
    }
}

/**
 * Wraps selection with a snippet. Pipeline (B-197): resolve tabstops on the
 * template (the first `$1` is the selection slot, other tabstops are
 * stripped) -> substitute variables -> locate `$|` -> insert the selection
 * verbatim (never re-scanned, so a selection containing `$date`, `$1` or
 * `$|` stays literal) -> place the cursor.
 */
export async function wrapSelectionWithSnippet(
    editor: Editor,
    replacement: string,
    deps: SnippetInsertDeps = {},
): Promise<void> {
    const selection = editor.getSelection();

    if (!selection) {
        // If no selection, just insert
        await insertSnippetAtCursor(editor, replacement, deps);
        return;
    }

    // Capture the target before any await (B-136 / B-147).
    const cursor = editor.getCursor();
    const from = editor.getCursor('from');
    const to = editor.getCursor('to');

    const CURSOR_SENTINEL = "__SNIPSIDIAN_CURSOR__";
    // Private-use delimiters: a word character here would defeat the `\b` of
    // `$clipboard$1` / `$date$1` during variable substitution.
    const SELECTION_SLOT = "\uE000SNIPSIDIAN_SELECTION\uE001";
    const hasSelToken = replacement.includes("${SEL}");
    let slotUsed = false;
    let template = mapTabstops(replacement, (n) => {
        if (n === 1 && !hasSelToken && !slotUsed) {
            slotUsed = true;
            return SELECTION_SLOT;
        }
        return "";
    });

    template = await substituteVariables(template, pickerContext(editor, deps));

    const cursorMatch = template.indexOf("$|");
    if (cursorMatch >= 0) {
        template = template.replace("$|", CURSOR_SENTINEL).replace(/\$\|/g, "");
    }

    // The selection goes in LAST, through replacer functions, so it is
    // inserted verbatim (`$2`, `$&`, `$date`).
    if (hasSelToken) {
        template = template.replace("${SEL}", () => selection);
    } else if (slotUsed) {
        template = template.replace(SELECTION_SLOT, () => selection);
    } else if (template.includes(CURSOR_SENTINEL)) {
        // If no selection placeholders exist, insert selection at cursor marker.
        template = template.replace(CURSOR_SENTINEL, () => `${selection}${CURSOR_SENTINEL}`);
    }

    const cursorOffset = template.indexOf(CURSOR_SENTINEL);
    const finalText = template.replace(CURSOR_SENTINEL, "");

    if (!samePos(editor.getCursor(), cursor) || editor.getSelection() !== selection) {
        // The user moved during the await: replace the captured range (if it
        // still holds the selection, B-199), leave the cursor.
        replaceCapturedSelection(editor, finalText, from, to, selection);
        return;
    }

    editor.replaceSelection(finalText);

    if (cursorOffset >= 0) {
        try {
            const newCursor = advancePosition(from, finalText.slice(0, cursorOffset));
            editor.setCursor(newCursor);
        } catch (error) {
            console.warn('Failed to set cursor position:', error);
        }
    }
}
