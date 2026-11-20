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
import { formatNoteDate } from "./daily-notes";
import { expand } from "../engine";
import { expandInstant, expandPatternHit } from "../engine/expand";
import { shouldExpandHere } from "../engine/guards";
import { findTrigger } from "../engine/match";
import { matchPatterns, matchPatternsInOrder, type CompiledRule, type PatternMatch } from "../engine/patterns";
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
export function formatWithMoment(date: Date, format: string): string {
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
    /** B-204 / B-218: the note's name without its extension, for `{{title}}` and `{{notedate:FMT}}`. */
    basename?: string,
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
        basename,
        now,
        formatDate: formatWithMoment,
        formatNoteDate: (format) => formatNoteDate(basename, format),
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

export function applyEditPlan(
    editor: Editor,
    plan: EditPlan,
    line: number,
    /** The replaced range reaches past the caret (an auto-paired closer went with the opener): the caret would
     *  map to the start of the insert, so it is put after it explicitly. */
    caretAfterInsert = false,
) {
    const userStillOnTargetLine = editor.getCursor().line === line;

    const from: EditorPosition = { line, ch: plan.fromCh };
    const to: EditorPosition = { line, ch: plan.toCh };
    // `editor.cm` is absent on a legacy editor: the plain write is the fallback.
    if (plan.kind === "pattern" && editor.cm) {
        editor.cm.dispatch({
            changes: { from: editor.posToOffset(from), to: editor.posToOffset(to), insert: plan.insert },
            ...(caretAfterInsert
                ? { selection: { anchor: editor.posToOffset(from) + normalizedLength(plan.insert) } }
                : {}),
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
    /** An auto-paired closer went with the replaced opener (`original` includes it): where the caret goes when the
     *  expansion is undone, as an offset into `original` (between the pair, not after it). */
    restoreCaret?: number;
};

/**
 * ADR-0008: the closer the editor's auto-pair inserted in one update, tied to where it sits: the caret right after
 * the opener and the line as it read then. A fallback attempt that re-reads the live caret after an await must not
 * take a closer that is not this one (a `)` the user typed or clicked next to).
 */
export type PairedCloser = {
    closer: string;
    caret: EditorPosition;
    lineText: string;
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
        basename?: string;
        now: Date;
        readClipboard?: () => Promise<string>;
        /** B-137: see `ExpandInput.prefix`. `undefined` = mode off. */
        prefix?: string;
        /** ADR-0008: compiled pattern rules, tried after a literal miss, top to bottom. */
        patterns?: readonly CompiledRule[];
        /** ADR-0008: the update was a single typed character: instant rules may match through the typed
         *  separator. Ignored for Enter (the caret is on the next line). */
        instant?: boolean;
        /** ADR-0008: the closer the editor's auto-pair inserted right after the caret in this update. An instant
         *  rule that replaces the opener removes it too (see `expandAndApply`). */
        pairCloser?: PairedCloser;
        /** B-246: Enter in a list item: the editor continued the list in the same change and the caret sits after
         *  the new marker. The text it inserted after the trigger line (`"\n- "`, `"\n2. "`, `"\n\t- [ ] "`). The
         *  line break is the separator: the trigger is read at the end of the previous line, and the new marker is
         *  kept (it counts as part of the separator, so a field session ends after it). */
        listContinuation?: string;
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
    // B-246: after a list continuation the caret is past the marker, not at column 0; it must be exactly where the
    // update put it, or a later move (the user, another plugin) would be read as the Enter.
    const continuation = deps.listContinuation;
    const isNewlineSeparator =
        continuation !== undefined
            ? cursor.line > 0 && cursor.ch === continuation.length - 1
            : cursor.ch === 0 && cursor.line > 0;
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
        if (continuation !== undefined) return undefined; // the caret is not where the Enter left it
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
    const ctx = makeContext(editor, deps.filename, deps.now, deps.readClipboard, targetLine, ctxCh, deps.basename);

    const patterns = deps.patterns ?? [];
    return expandAndApply(
        editor,
        () => expand(input, dict, ctx, DEFAULT_DELIMITERS, patterns, deps.instant === true && !isNewlineSeparator),
        targetLine,
        lineText,
        // B-246: the kept separator is the whole inserted `"\n" + marker`, the engine still sees a plain `"\n"`.
        isNewlineSeparator && continuation !== undefined ? continuation : lastTyped,
        cursor,
        deps.pairCloser,
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
    /** The auto-paired closer right after the caret, when the update that started this inserted a pair. */
    pairCloser?: PairedCloser,
    /** The selected text when it started (`""` = none): "stayed" needs both. */
    selectionAtStart = "",
    /** B-255 manual mode (selection / mid-word): put the caret after the new text. */
    moveCaretToEnd = false,
): Promise<ExpansionResult | undefined> {
    const resolved = await resolvePlan();
    if (!resolved) return undefined;
    // ADR-0008: an instant rule that replaced the opener of a just-inserted pair (`:(` to a sad face) would leave
    // the editor's closer behind (`face)`): the result must equal what the same typing gives with auto-pair off, so
    // the closer goes in the same write (one undo step restores the pair). Only the closer that update inserted,
    // still directly after the caret, and only for a plan that replaced text ending exactly at the caret. That is a
    // pattern rule (a literal trigger ends before its separator, and a pattern match is never empty), so no further
    // check on the plan's kind or length is needed. The Expand-at-cursor path (`tryExpandAtCursor`) also produces a
    // literal plan ending at the caret; it is safe only because it passes no `pairCloser`.
    const closerAtStart =
        pairCloser !== undefined &&
        editor.cm !== undefined &&
        resolved.toCh === cursorAtStart.ch &&
        // The closer belongs to this exact spot: the caret is where the update left it and the line is as it was
        // (a stale attempt, the user typing or clicking elsewhere, never takes a closer of theirs).
        samePos(cursorAtStart, pairCloser.caret) &&
        lineText === pairCloser.lineText &&
        lineText.charAt(resolved.toCh) === pairCloser.closer;
    // B-147: the user may have moved during the (clipboard) await. A field session pulls the caret into the first
    // field, so it opens only when the caret is still where the expansion started (same rule as the pickers).
    const stayed = samePos(editor.getCursor(), cursorAtStart) && editor.getSelection() === selectionAtStart;
    // Fail closed: after an await the closer may have been stepped over or typed past (a selection-only change that
    // leaves the line intact), so it is taken only when the caret has not moved at all.
    // The two pre-await snapshots (`lineText`, the pair's line) say nothing about the closer NOW: a forward Delete
    // on it during the await, with an identical character behind it, would make the slice check pass and eat the
    // next one. So the closer goes only when the live line is still exactly the snapshot; a caret that has not
    // moved over a changed line means the note changed under us, and nothing is written.
    if (closerAtStart && stayed && (editor.getLine(targetLine) ?? "") !== lineText) return undefined;
    const takesCloser = closerAtStart && stayed;
    const plan = takesCloser ? { ...resolved, toCh: resolved.toCh + 1 } : resolved;

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
    // A field plan carries a fallback caret (the first field); when the user
    // moved, that must not pull the caret back either.
    applyEditPlan(
        editor,
        plan.fields && !stayed ? { ...plan, newCursor: undefined } : plan,
        targetLine,
        takesCloser,
    );
    // The replaced range held the caret or the selection; park the caret
    // after the new text unless a field session or `$|` places it.
    if (moveCaretToEnd && stayed && !plan.fields && plan.newCursor === undefined) {
        editor.setCursor(advancePosition({ line: targetLine, ch: plan.fromCh }, plan.insert));
    }
    // An instant rule that matched through the typed separator replaced it: nothing of it follows the insert.
    const keptSeparator = plan.consumesSeparator ? "" : separator;
    const result: ExpansionResult = {
        from,
        insert: plan.insert,
        original: expectedSlice,
        separator: keptSeparator,
    };
    // Backspace undo puts the caret between the restored pair, as Cmd+Z does.
    if (takesCloser) result.restoreCaret = expectedSlice.length - 1;
    if (plan.fields && stayed) {
        // Without `$|` the last Tab lands right after the inserted text plus the
        // separator, where the caret sits with no fields (B-182). A session opens
        // only when the caret was still exactly after the trigger and separator,
        // so this is also where the live caret ends up. Enter in a list item
        // (B-246): the separator is the whole `"\n" + marker` the editor
        // inserted, so the final stop is after the new marker.
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
 *
 * B-255 `manual`: the Tab key and the Text Snippets alias command. Like the
 * original plugin, a selection that is exactly a trigger is replaced, and a
 * caret inside a word takes the whole word around it (see
 * {@link cursorExpansionInput}). Every guard above still applies.
 */
export async function tryExpandAtCursor(
    editor: Editor,
    dict: Dict,
    deps: {
        filename?: string;
        basename?: string;
        now: Date;
        readClipboard?: () => Promise<string>;
        prefix?: string;
        /** ADR-0008: compiled pattern rules (separator mode is tried). */
        patterns?: readonly CompiledRule[];
        manual?: boolean;
        /**
         * What `canExpandAtCursor` just found (the Tab key): used as is, so the rules are not run a second time and
         * the decision to take the key cannot differ from the expansion. Only valid in the same synchronous turn
         * (the editor must not have changed since).
         */
        prepared?: CursorExpansion;
    },
): Promise<ExpansionResult | undefined> {
    const at = deps.prepared ?? planCursorExpansion(editor, dict, deps.prefix, deps.patterns ?? [], deps.manual === true);
    if (!at) return undefined;
    const ctx = makeContext(editor, deps.filename, deps.now, deps.readClipboard, at.cursor.line, at.input.sepCh, deps.basename);
    const hit = at.hit;
    // No `pairCloser`: a command or Tab never takes an auto-paired closer (only the typing path knows one was inserted).
    return expandAndApply(
        editor,
        // A literal trigger runs through `expand` without rules (it found it already); a rule hit is expanded as found.
        () => (hit ? expandPatternHit(at.input, ctx, hit) : expand(at.input, dict, ctx)),
        at.cursor.line,
        at.lineText,
        "",
        at.cursor,
        undefined,
        at.selection,
        at.moveCaretToEnd,
    );
}

/**
 * B-255: synchronous twin of the check inside `tryExpandAtCursor` in manual
 * mode: would the expand path find a snippet right now (same input helper,
 * same guards, nothing is resolved or written)? The Tab key needs the answer
 * at once, to decide whether it is taken or passed on to indent.
 *
 * Returns what it found (`undefined` = nothing): the caller hands it to
 * `tryExpandAtCursor` as `prepared`, so a pattern rule runs once per Tab.
 */
export function canExpandAtCursor(
    editor: Editor,
    dict: Dict,
    prefix?: string,
    /** ADR-0008: compiled pattern rules; a literal trigger wins, then the rules in list order (as `expand` does). */
    patterns: readonly CompiledRule[] = [],
): CursorExpansion | undefined {
    // The line alone first (cheap): the context below scans the note for frontmatter, fences and math.
    const plan = planCursorExpansion(editor, dict, prefix, patterns, true);
    if (!plan) return undefined;
    const ctx = makeContext(editor, undefined, clock.now(), undefined, plan.cursor.line, plan.input.sepCh);
    return shouldExpandHere(ctx) ? plan : undefined;
}

/** What expanding at the caret found: the input, plus the literal trigger or the rule hit (never both). */
export type CursorExpansion = CursorInput & {
    /** A literal trigger ends the candidate (it wins over any rule). */
    literal: boolean;
    /** ADR-0008: the separator rule that matched when there is no literal trigger. */
    hit?: PatternMatch;
};

/**
 * The line-only part of "is there something to expand at the caret": the input, then a literal trigger, then
 * (manual path and the command) the separator rules top to bottom. No Markdown context, no async.
 */
function planCursorExpansion(
    editor: Editor,
    dict: Dict,
    prefix: string | undefined,
    patterns: readonly CompiledRule[],
    manual: boolean,
): CursorExpansion | undefined {
    const at = cursorExpansionInput(editor, dict, prefix, manual);
    if (!at) return undefined;
    if (findTrigger(at.input, dict) !== null) return { ...at, literal: true };
    // A selection reaches here only as a literal trigger (`cursorExpansionInput` takes nothing else), which won
    // above; kept as defence: a rule never reads a selection. Instant rules are not tried (no typed character).
    if (at.selection || patterns.length === 0) return undefined;
    const hit = matchPatternsInOrder({ beforeSeparator: at.input.textBefore }, patterns);
    if (!hit) return undefined;
    // A caret inside a word takes the line up to the word's end: a match that starts after the caret would replace
    // a tail the caret is not in (`abc|dd5` is fine, `a|bcdd5` for `dd\d+$` is not), so it does not count.
    if (at.moveCaretToEnd && hit.index > at.cursor.ch) return undefined;
    return { ...at, literal: false, hit };
}

type CursorInput = { input: ExpandInput; cursor: EditorPosition; lineText: string; selection: string; moveCaretToEnd: boolean };

/**
 * The input for expanding at the caret, or `undefined` when nothing can match
 * there. Shared by the expand path and `canExpandAtCursor`, so they agree.
 *
 * Default mode: the trigger must end exactly at the caret, which must sit at
 * a word end (typing would not expand inside a word either). `manual` adds
 * the two behaviours of the original Text Snippets plugin: a one-line
 * selection that is exactly a trigger is replaced, and a caret strictly
 * inside a word (a word character on both sides) uses the whole word as the
 * candidate. A caret at the START of a word is not "inside": Tab there keeps
 * indenting. The caret is moved to the end of the inserted text afterwards
 * (`moveCaretToEnd`), as the original did.
 */
function cursorExpansionInput(
    editor: Editor,
    dict: Dict,
    prefix: string | undefined,
    manual: boolean,
): CursorInput | undefined {
    const selection = editor.getSelection();
    const cursor = editor.getCursor();
    const lineText = editor.getLine(cursor.line) ?? "";
    const build = (sepCh: number): ExpandInput => ({
        textBefore: lineText.slice(0, sepCh),
        textAfter: lineText.slice(sepCh),
        // `\n` is a virtual separator: `findTrigger` reads the trigger BEFORE
        // `sepCh`, which here is the end of the candidate itself.
        lastTyped: "\n",
        sepCh,
        prefix,
    });

    if (selection) {
        if (!manual) return undefined;
        const from = editor.getCursor("from");
        const to = editor.getCursor("to");
        if (from.line !== to.line || from.line !== cursor.line) return undefined;
        const input = build(to.ch);
        const match = findTrigger(input, dict);
        // The selection must BE the trigger, not the tail of a longer word. In
        // prefix mode two selections qualify: prefix char + trigger (it starts
        // where the match starts), or the trigger alone with the prefix char
        // right before it (that char is consumed, as when typing).
        const startsAt = match?.fromCh;
        const exact = startsAt === from.ch;
        const bareWithPrefix = prefix !== undefined && prefix !== "" && startsAt === from.ch - 1;
        if (!match || match.toCh !== to.ch || !(exact || bareWithPrefix)) return undefined;
        return { input, cursor, lineText, selection, moveCaretToEnd: true };
    }

    let sepCh = cursor.ch;
    let moveCaretToEnd = false;
    const after = lineText[cursor.ch];
    if (after !== undefined && !isSeparator(after)) {
        // Inside a word (`sig|nature`) typing would not expand. Manual mode
        // takes the whole word around the caret, but only from strictly
        // inside it (a word character right before the caret too).
        const before = cursor.ch > 0 ? lineText[cursor.ch - 1] : undefined;
        if (!manual || before === undefined || isSeparator(before)) return undefined;
        while (sepCh < lineText.length && !isSeparator(lineText[sepCh] ?? " ")) sepCh++;
        moveCaretToEnd = true;
    } else if (cursor.ch === 0) {
        return undefined;
    }
    return { input: build(sepCh), cursor, lineText, selection: "", moveCaretToEnd };
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
        basename?: string;
        now: Date;
        readClipboard?: () => Promise<string>;
        /** The closer the editor's auto-pair inserted right after the caret in this update. */
        pairCloser?: PairedCloser;
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
    const ctx = makeContext(editor, deps.filename, deps.now, deps.readClipboard, cursor.line, cursor.ch, deps.basename);
    return expandAndApply(
        editor,
        () => expandInstant(textBefore, ctx, hit),
        cursor.line,
        lineText,
        "",
        cursor,
        deps.pairCloser,
    );
}

/** B-197: what the picker paths need to run the full placeholder pipeline. */
export type SnippetInsertDeps = {
    filename?: string;
    basename?: string;
    now?: Date;
    readClipboard?: () => Promise<string>;
};

function pickerContext(editor: Editor, deps: SnippetInsertDeps): ExpandContext {
    return makeContext(editor, deps.filename, deps.now ?? clock.now(), deps.readClipboard ?? readClipboardSafe, undefined, undefined, deps.basename);
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
    const verbatim: string[] = [];
    const resolved = await substituteVariables(prepared.text, pickerContext(editor, deps), prepared.fields, verbatim);

    // Handle cursor position after insertion
    const scan = scanMarkers(resolved, prepared.fields, true, verbatim);
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

    // B-204 / B-218: `{{title}}` / `{{notedate}}` values stay out of the `$|` search; the walk below writes them in.
    const verbatim: string[] = [];
    template = await substituteVariables(template, pickerContext(editor, deps), withFields, verbatim);

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
        `${SELECTION_SLOT}|${CURSOR_SENTINEL}` + (withFields ? "|\\uE002(?<field>[1-9])\\uE003" : "") + (verbatim.length > 0 ? "|\\uE005(?<verb>\\d+)\\uE005" : ""),
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
        const field = m.groups?.["field"];
        const verb = m.groups?.["verb"];
        if (verb !== undefined) {
            finalText += verbatim[Number(verb)] ?? m[0];
        } else if (field !== undefined) {
            hits.push({ n: Number(field), offset: finalText.length });
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
