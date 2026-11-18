import { moment, Notice } from "obsidian";
import type { Editor, EditorPosition } from "obsidian";
import {
    countTabstops,
    fieldMarker,
    mapTabstops,
    orderFieldHits,
    prepareTabstops,
    scanMarkers,
    substituteVariables,
} from "../engine/placeholders";
import { clock } from "./clock";
import { readClipboardSafe } from "./clipboard";
import { expand } from "../engine";
import { expandInstant } from "../engine/expand";
import { matchPatterns, type CompiledRule } from "../engine/patterns";
import type { Dict, EditPlan, ExpandContext, ExpandInput, FieldStops } from "../engine/types";
import { DEFAULT_DELIMITERS, isSeparator } from "../shared/delimiters";
import { isInFencedCode, isInInlineCode, isInMath, isInYamlFrontmatter } from "../shared/markdown";

/** The part of moment Snipsy uses. */
interface MomentLike {
    format(pattern: string): string;
}

/**
 * Formats with `moment` from obsidian, typed by hand. Its typing is an `export =` namespace, which TypeScript 6
 * (and 5 with `esModuleInterop`) does not treat as callable, so the community scanner reported the call as unsafe
 * (K-058). Read at call time, so a module mock without `moment` does not break importing this file.
 */
function formatWithMoment(date: Date, format: string): string {
    return (moment as unknown as (input: Date) => MomentLike)(date).format(format);
}

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
        formatDate: formatWithMoment,
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
/**
 * `userEvent` of a pattern expansion (ADR-0008). Not typing (the B-149 gate
 * rejects it, so the inserted text is never re-scanned) and not matched by
 * CM6 history's `/^(input\.type|delete)($|\.)/` join rule, so it is its own
 * undo step: Cmd/Ctrl+Z gives back exactly what was typed. Literal expansions
 * are written untagged and CM6 joins them into the typing group (B-132).
 */
export const PATTERN_USER_EVENT = "snipsy.expand";

export function applyEditPlan(editor: Editor, plan: EditPlan, line: number) {
    const userStillOnTargetLine = editor.getCursor().line === line;

    const from: EditorPosition = { line, ch: plan.fromCh };
    const to: EditorPosition = { line, ch: plan.toCh };
    // `editor.cm` is absent on a legacy editor: the plain write is the fallback.
    if (plan.kind === "pattern" && editor.cm) {
        editor.cm.dispatch({
            changes: { from: editor.posToOffset(from), to: editor.posToOffset(to), insert: plan.insert },
            userEvent: PATTERN_USER_EVENT,
        });
    } else {
        editor.replaceRange(plan.insert, from, to);
    }
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

/**
 * B-176: where a trigger expansion landed, as document offsets, plus what
 * the user had typed. The CM6 bridge turns this into the highlight / the
 * Backspace-undo mark. Offsets are taken BEFORE the edit and are valid
 * right after it (nothing else runs in between).
 */
export type ExpansionResult = {
    /** Start of the inserted text. */
    from: number;
    /** The inserted text; the separator follows it. */
    insert: string;
    /** The replaced text: prefix (B-137) + trigger, as typed. */
    original: string;
    /** The separator typed after the trigger (`"\n"` for Enter). */
    separator: string;
    /** B-243: the fields of the inserted text (document offsets), when the
     *  snippet has two or more. The caller opens the field session. */
    session?: FieldStops;
};

/** CM6 turns `\r\n` / `\r` in inserted text into `\n`; offsets must follow. */
function normalizedLength(text: string): number {
    return text.replace(/\r\n?/g, "\n").length;
}

/** B-243: offsets inside `insert` -> document offsets, given where it starts. */
function toDocStops(
    from: number,
    insert: string,
    fields: number[],
    docOrder: number[] | undefined,
    final: number,
): FieldStops {
    const at = (offset: number): number => from + normalizedLength(insert.slice(0, offset));
    return { fields: fields.map(at), docOrder, final: at(final) };
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
        /** ADR-0008: compiled pattern rules, tried after a literal miss, top to bottom. */
        patterns?: readonly CompiledRule[];
        /** ADR-0008: the update was a single typed character: instant rules may match through the typed
         *  separator. Ignored for Enter (the caret is on the next line). */
        instant?: boolean;
    }
): Promise<ExpansionResult | undefined> {
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
        if (cursor.ch === 0) return undefined; // column 0 of the first line: nothing precedes it
        lastTyped = lineText[cursor.ch - 1] ?? "";
        if (!isSeparator(lastTyped)) return undefined;
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

    const patterns = deps.patterns ?? [];
    return expandAndApply(
        editor,
        () => expand(input, dict, ctx, DEFAULT_DELIMITERS, patterns, deps.instant === true && !isNewlineSeparator),
        targetLine,
        lineText,
        lastTyped,
        cursor,
    );
}

/**
 * Shared tail of the trigger paths: resolves the plan, guards against a note
 * that changed during the (possibly async) resolution, applies it.
 */
async function expandAndApply(
    editor: Editor,
    resolvePlan: () => Promise<EditPlan | null>,
    targetLine: number,
    lineText: string,
    separator: string,
    /** The live caret when the expansion started. */
    cursorAtStart: EditorPosition,
): Promise<ExpansionResult | undefined> {
    const plan = await resolvePlan();
    if (!plan) return undefined;

    // Cheap staleness guard: if the text the plan expects to replace
    // (the trigger + separator, as it read before the await) no
    // longer matches what's actually at that range now, the document
    // changed under us in some other way — skip the edit instead of
    // overwriting whatever is there now.
    const currentLineText = editor.getLine(targetLine) ?? "";
    const expectedSlice = lineText.slice(plan.fromCh, plan.toCh);
    const actualSlice = currentLineText.slice(plan.fromCh, plan.toCh);
    if (actualSlice !== expectedSlice) return undefined;

    const from = editor.posToOffset({ line: targetLine, ch: plan.fromCh });
    // B-147: the user may have moved during the (clipboard) await. A field
    // session pulls the caret into the first field, so it opens only when the
    // caret is still where the expansion started (same rule as the pickers).
    const stayed = samePos(editor.getCursor(), cursorAtStart) && !editor.getSelection();
    // A field plan carries a fallback caret (the first field); when the user
    // moved, that must not pull the caret back either.
    applyEditPlan(editor, plan.fields && !stayed ? { ...plan, newCursor: undefined } : plan, targetLine);
    // An instant rule that matched through the typed separator replaced it: nothing of it follows the insert.
    const keptSeparator = plan.consumesSeparator ? "" : separator;
    const result: ExpansionResult = {
        from,
        insert: plan.insert,
        original: expectedSlice,
        separator: keptSeparator,
    };
    if (plan.fields && stayed) {
        // Without `$|` the last Tab lands right after the inserted text plus the
        // separator, where the caret sits with no fields (B-182). A session opens
        // only when the caret was still exactly after the trigger and separator,
        // so this is also where the live caret ends up. Enter in a list item: if
        // the editor already continued the list marker before the expansion
        // lands, the caret moved, so no field session opens (fields are dropped,
        // caret stays on the new line).
        const final =
            plan.final !== undefined
                ? from + normalizedLength(plan.insert.slice(0, plan.final))
                : from + normalizedLength(plan.insert) + normalizedLength(keptSeparator);
        const stops = toDocStops(from, plan.insert, plan.fields, plan.docOrder, 0);
        result.session = { ...stops, final };
    }
    return result;
}

/**
 * B-244: expands the trigger that ends right at the caret, without a
 * separator (command "Expand trigger at cursor"). Same engine, same guards
 * (code, math, frontmatter, prefix mode, the dict the caller passes already
 * has disabled groups removed). A selection, the start of a line and a
 * missing trigger all return `undefined`: the command stays silent.
 */
export async function tryExpandAtCursor(
    editor: Editor,
    dict: Dict,
    deps: {
        filename?: string;
        now: Date;
        readClipboard?: () => Promise<string>;
        prefix?: string;
        /** ADR-0008: compiled pattern rules (separator mode is tried). */
        patterns?: readonly CompiledRule[];
    },
): Promise<ExpansionResult | undefined> {
    if (editor.getSelection()) return undefined;
    const cursor = editor.getCursor();
    if (cursor.ch === 0) return undefined;
    const lineText = editor.getLine(cursor.line) ?? "";
    // Inside a word (`sig|nature`) the text before the caret is not a trigger:
    // typing would not expand there either (a separator ends the word first).
    const after = lineText[cursor.ch];
    if (after !== undefined && !isSeparator(after)) return undefined;
    // `\n` is a virtual separator: `findTrigger` reads the trigger BEFORE
    // `sepCh`, which here is the caret itself.
    const input: ExpandInput = {
        textBefore: lineText.slice(0, cursor.ch),
        textAfter: lineText.slice(cursor.ch),
        lastTyped: "\n",
        sepCh: cursor.ch,
        prefix: deps.prefix,
    };
    const ctx = makeContext(editor, deps.filename, deps.now, deps.readClipboard, cursor.line, cursor.ch);
    const patterns = deps.patterns ?? [];
    return expandAndApply(
        editor,
        () => expand(input, dict, ctx, DEFAULT_DELIMITERS, patterns),
        cursor.line,
        lineText,
        "",
        cursor,
    );
}

/**
 * ADR-0008, instant mode: tries the `instant` pattern rules on the line up to
 * the caret, right after a typed character (the caller has checked the change
 * source: typing only, one character, one caret). Nothing happens with a
 * selection or at the start of a line. Same guards as typing; the match has to
 * end exactly at the caret.
 */
export async function tryExpandInstant(
    editor: Editor,
    patterns: readonly CompiledRule[],
    deps: {
        filename?: string;
        now: Date;
        readClipboard?: () => Promise<string>;
    },
): Promise<ExpansionResult | undefined> {
    if (editor.getSelection()) return undefined;
    const cursor = editor.getCursor();
    if (cursor.ch === 0) return undefined;
    const lineText = editor.getLine(cursor.line) ?? "";
    const textBefore = lineText.slice(0, cursor.ch);
    // A typed separator is `tryExpandAtSeparator`'s: it tries literal triggers, then every rule in list order
    // (instant ones through the separator), so the order stays one order.
    if (DEFAULT_DELIMITERS.includes(textBefore.charAt(textBefore.length - 1))) return undefined;
    // This runs after EVERY typed character: look at the tail first and build the context (it scans the note for
    // frontmatter, fences and math) only for a match.
    // The match is handed on, so the rule's regex runs once per hit.
    const hit = matchPatterns(textBefore, patterns, "instant");
    if (!hit) return undefined;
    const ctx = makeContext(editor, deps.filename, deps.now, deps.readClipboard, cursor.line, cursor.ch);
    return expandAndApply(editor, () => expandInstant(textBefore, ctx, hit), cursor.line, lineText, "", cursor);
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
 * variables, then the `$|` cursor, B-243 fields). The target position is
 * captured BEFORE the (possibly async, `$clipboard`) substitution: if the
 * user moved meanwhile the text still lands at the captured position and the
 * cursor is left alone (B-136 / B-147). Returns the field stops (document
 * offsets) when the snippet has two or more fields and landed where the user
 * was; the caller opens the session.
 */
export async function insertSnippetAtCursor(
    editor: Editor,
    replacement: string,
    deps: SnippetInsertDeps = {},
): Promise<FieldStops | undefined> {
    const cursor = editor.getCursor();
    const selection = editor.getSelection();
    const from = selection ? editor.getCursor("from") : cursor;
    const to = selection ? editor.getCursor("to") : cursor;
    // B-199: cheap staleness probe for the no-selection target.
    const capturedLine = editor.getLine(cursor.line);
    const lineStillThere = (): boolean =>
        cursor.line <= editor.lastLine() && editor.getLine(cursor.line) === capturedLine;
    const prepared = prepareTabstops(replacement);
    const resolved = await substituteVariables(prepared.text, pickerContext(editor, deps), prepared.fields);

    // Handle cursor position after insertion
    const scan = scanMarkers(resolved, prepared.fields, true);
    const cleanReplacement = scan.text;
    const { offsets: fields, docOrder } = orderFieldHits(scan.fields);
    // Without `$|` the first field is where the caret goes if no session starts.
    const cursorOffset = scan.cursor ?? fields[0];
    const cursorPrefix = cursorOffset === undefined ? "" : cleanReplacement.slice(0, cursorOffset);
    const cursorMatch = cursorOffset ?? -1;

    if (!samePos(editor.getCursor(), cursor) || editor.getSelection() !== selection) {
        // The user moved during the await: insert where they chose, do not teleport the cursor.
        if (selection) {
            replaceCapturedSelection(editor, cleanReplacement, from, to, selection);
            return undefined;
        }
        // B-199: the captured position is only trusted while its line still
        // has the text it had at capture time; otherwise the note changed
        // above it and the live cursor is the best target.
        const target = lineStillThere() ? cursor : editor.getCursor();
        editor.replaceRange(cleanReplacement, target, target);
        return undefined;
    }

    const base = editor.posToOffset(from);
    if (selection) {
        // If there's a selection, replace it
        editor.replaceSelection(cleanReplacement);
    } else {
        // Otherwise insert at cursor position
        editor.replaceRange(cleanReplacement, cursor, cursor);
    }
    // Set cursor to the correct position
    if (cursorMatch >= 0) {
        try {
            const newCursor = advancePosition(from, cursorPrefix);
            editor.setCursor(newCursor);
        } catch (error) {
            console.warn('Failed to set cursor position:', error);
        }
    }
    if (fields.length === 0) return undefined;
    return toDocStops(base, cleanReplacement, fields, docOrder, scan.cursor ?? cleanReplacement.length);
}

/**
 * Wraps selection with a snippet. Pipeline (B-197): resolve tabstops on the
 * template (the first `$1` is the selection slot; with two or more tabstops
 * the others are fields, B-243, else they are stripped) -> substitute
 * variables -> locate `$|` -> insert the selection verbatim (never re-scanned,
 * so a selection containing `$date`, `$1` or `$|` stays literal) -> place the
 * cursor. Returns the field stops (document offsets) when the snippet has
 * fields left after the selection took `$1`.
 */
export async function wrapSelectionWithSnippet(
    editor: Editor,
    replacement: string,
    deps: SnippetInsertDeps = {},
): Promise<FieldStops | undefined> {
    const selection = editor.getSelection();

    if (!selection) {
        // If no selection, just insert
        return insertSnippetAtCursor(editor, replacement, deps);
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
    const withFields = countTabstops(replacement) >= 2;
    let slotUsed = false;
    let template = mapTabstops(replacement, (n) => {
        if (n === 1 && !hasSelToken && !slotUsed) {
            slotUsed = true;
            return SELECTION_SLOT;
        }
        return withFields ? fieldMarker(n) : "";
    });

    template = await substituteVariables(template, pickerContext(editor, deps), withFields);

    const cursorMatch = template.indexOf("$|");
    if (cursorMatch >= 0) {
        template = template.replace("$|", CURSOR_SENTINEL).replace(/\$\|/g, "");
    }

    if (hasSelToken) {
        template = template.replace("${SEL}", SELECTION_SLOT);
    } else if (!slotUsed && template.includes(CURSOR_SENTINEL)) {
        // If no selection placeholders exist, insert selection at cursor marker.
        template = template.replace(CURSOR_SENTINEL, `${SELECTION_SLOT}${CURSOR_SENTINEL}`);
    }

    // One walk over the markers builds the final text. The selection goes in
    // LAST, as a plain string (never through `$` replacement patterns, never
    // re-scanned), so it is inserted verbatim (`$2`, `$&`, `$date`, even a
    // marker lookalike), and every offset below counts its length.
    const walk = new RegExp(
        withFields
            ? `${SELECTION_SLOT}|${CURSOR_SENTINEL}|\\uE002([1-9])\\uE003`
            : `${SELECTION_SLOT}|${CURSOR_SENTINEL}`,
        "g",
    );
    let finalText = "";
    let last = 0;
    let selectionDone = false;
    let cursorOffset = -1;
    const hits: Array<{ n: number; offset: number }> = [];
    for (let m = walk.exec(template); m; m = walk.exec(template)) {
        finalText += template.slice(last, m.index);
        last = m.index + m[0].length;
        if (m[1] !== undefined) {
            hits.push({ n: Number(m[1]), offset: finalText.length });
        } else if (m[0] === CURSOR_SENTINEL) {
            cursorOffset = finalText.length;
        } else if (!selectionDone) {
            selectionDone = true;
            finalText += selection;
        }
    }
    finalText += template.slice(last);
    const { offsets: fields, docOrder } = orderFieldHits(hits);

    if (!samePos(editor.getCursor(), cursor) || editor.getSelection() !== selection) {
        // The user moved during the await: replace the captured range (if it
        // still holds the selection, B-199), leave the cursor.
        replaceCapturedSelection(editor, finalText, from, to, selection);
        return undefined;
    }

    const base = editor.posToOffset(from);
    editor.replaceSelection(finalText);

    // Without `$|` the first field is where the caret goes if no session starts.
    const caretOffset = cursorOffset >= 0 ? cursorOffset : (fields[0] ?? -1);
    if (caretOffset >= 0) {
        try {
            const newCursor = advancePosition(from, finalText.slice(0, caretOffset));
            editor.setCursor(newCursor);
        } catch (error) {
            console.warn('Failed to set cursor position:', error);
        }
    }
    if (fields.length === 0) return undefined;
    return toDocStops(base, finalText, fields, docOrder, cursorOffset >= 0 ? cursorOffset : finalText.length);
}
