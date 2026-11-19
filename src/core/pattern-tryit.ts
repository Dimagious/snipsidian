import { expand, expandInstant } from "../engine/expand";
import { findTrigger } from "../engine/match";
import { matchPatterns, matchPatternsInOrder, type CompiledRule } from "../engine/patterns";
import type { Dict, EditPlan, ExpandContext, ExpandInput } from "../engine/types";
import { DEFAULT_DELIMITERS } from "../shared/delimiters";

/**
 * ADR-0008, Patterns page: "Try it". Replays a typed line one character at a time through the REAL engine
 * (`findTrigger`, `matchPatternsInOrder`, `matchPatterns`, `expand`, `expandInstant`), the way the editor adapters
 * call it, so the answer is the one a note would give. Pure: the clipboard is never read (`$clipboard` and
 * `$filename` come back as their own names), the note is not touched.
 *
 * What the replay does, per character:
 *   - a separator (`DEFAULT_DELIMITERS`): literal snippets first (with the prefix setting), then the rules top to
 *     bottom; instant rules read the line through the separator, but only while "Expand while typing" is on;
 *   - any other character: instant rules only, and only while "Expand while typing" is on (owner decision
 *     2026-11-19: with it off, an instant rule never fires, Tab only tries separator rules);
 *   - the inserted text is not scanned again within the same keystroke; the next character sees it.
 * The engine looks at the last 64 characters of the line, so a longer line behaves as it does in a note.
 */

export type TryItInput = {
    line: string;
    /** Compiled rules in list order, the draft among them in its place. */
    rules: readonly CompiledRule[];
    /** 1-based position of each rule id in the list ("Rule 2 fires first"). */
    positions: ReadonlyMap<string, number>;
    draftId: string;
    snippets: Dict;
    /** The prefix character of prefix mode, when it is on. */
    prefix?: string;
    /** "Expand while typing". */
    expandWhileTyping: boolean;
    now: Date;
    formatDate?: (date: Date, format: string) => string;
};

export type TryItStatus =
    | { kind: "empty" }
    | { kind: "none" }
    /** The draft fires on what was typed: `at` is the text it matched. */
    | { kind: "fires"; at: string }
    /** It fired at `at`, and `next` (not a separator) was typed after it. */
    | { kind: "early"; at: string; next: string }
    /** A separator rule: nothing fired yet, the preview adds a space. */
    | { kind: "needs-separator" }
    | { kind: "shadowed-rule"; position: number }
    | { kind: "shadowed-snippet"; trigger: string };

export type TryItResult = {
    /** The line after typing (with the space the preview added, if any). */
    text: string;
    /** Where the last expansion's insert sits in `text`. */
    replaced: { from: number; to: number } | null;
    /** Field (tab stop) offsets in `text`, in visit order, for the last expansion when no text was typed after it. */
    fields: number[];
    /** Where the caret ends: an explicit one from the replacement (`$|`), else the end of the text. */
    caret: number;
    status: TryItStatus;
};

type Expansion = {
    /** Snippet trigger or rule id. */
    snippet?: string;
    ruleId?: string;
    /** The text the rule matched (what was typed). */
    matched: string;
    /** The character typed right after the expansion, if any. */
    next?: string;
};

type Run = {
    text: string;
    replaced: { from: number; to: number } | null;
    fields: number[];
    caret: number | null;
    expansions: Expansion[];
    /** The last character typed was the one that expanded: its caret and fields still hold. */
    fresh: boolean;
};

function isSeparatorChar(ch: string): boolean {
    return DEFAULT_DELIMITERS.includes(ch);
}

/** Absolute offset (in the whole line) of a plan's caret. `newCursor` is a line/column relative to the insert. */
function caretOffset(plan: EditPlan): number | null {
    if (!plan.newCursor) return null;
    const { lineDelta, ch } = plan.newCursor;
    if (lineDelta === 0) return ch;
    let at = -1;
    for (let i = 0; i < lineDelta; i++) at = plan.insert.indexOf("\n", at + 1);
    return plan.fromCh + at + 1 + ch;
}

async function replay(input: TryItInput): Promise<Run> {
    const ctx: ExpandContext = {
        isInCode: false,
        isInMath: false,
        isInFrontmatter: false,
        filename: "$filename",
        now: input.now,
        formatDate: input.formatDate,
        // The clipboard is never read here: the token stands for it.
        readClipboard: () => Promise.resolve("$clipboard"),
    };
    const run: Run = { text: "", replaced: null, fields: [], caret: null, expansions: [], fresh: false };
    const apply = (plan: EditPlan, base: string, expansion: Expansion): void => {
        run.text = base.slice(0, plan.fromCh) + plan.insert + base.slice(plan.toCh);
        run.replaced = { from: plan.fromCh, to: plan.fromCh + plan.insert.length };
        run.fields = (plan.fields ?? []).map((offset) => plan.fromCh + offset);
        run.caret = caretOffset(plan);
        run.expansions.push(expansion);
        run.fresh = true;
    };

    for (const ch of Array.from(input.line)) {
        run.fresh = false;
        const last = run.expansions[run.expansions.length - 1];
        if (last && last.next === undefined) last.next = ch;
        const before = run.text;
        const typed = before + ch;
        if (isSeparatorChar(ch)) {
            const expandInput: ExpandInput = { textBefore: before, textAfter: "", lastTyped: ch, sepCh: before.length, prefix: input.prefix };
            const literal = findTrigger(expandInput, input.snippets, DEFAULT_DELIMITERS);
            // Who fires is looked up with the same calls `expand` makes (the plan does not say which rule it came from).
            const hit = literal
                ? null
                : matchPatternsInOrder({ beforeSeparator: before, atCaret: input.expandWhileTyping ? typed : undefined }, input.rules);
            if (literal || hit) {
                const plan = await expand(expandInput, input.snippets, ctx, DEFAULT_DELIMITERS, input.rules, input.expandWhileTyping);
                if (plan) {
                    const matched = literal ? before.slice(literal.fromCh) : hit ? hit.text.slice(hit.index, hit.end) : "";
                    apply(plan, typed, { snippet: literal?.trigger, ruleId: hit?.rule.id, matched });
                    continue;
                }
            }
            run.text = typed;
            continue;
        }
        run.text = typed;
        if (!input.expandWhileTyping) continue;
        const hit = matchPatterns(typed, input.rules, "instant");
        if (!hit) continue;
        const plan = await expandInstant(typed, ctx, hit);
        if (plan) apply(plan, typed, { ruleId: hit.rule.id, matched: hit.text.slice(hit.index, hit.end) });
    }
    return run;
}

function statusOf(run: Run, input: TryItInput): TryItStatus {
    const mine = run.expansions.find((e) => e.ruleId === input.draftId);
    if (mine) {
        if (mine.next !== undefined && !isSeparatorChar(mine.next)) return { kind: "early", at: mine.matched, next: mine.next };
        return { kind: "fires", at: mine.matched };
    }
    const first = run.expansions[0];
    if (first?.snippet !== undefined) return { kind: "shadowed-snippet", trigger: first.snippet };
    if (first?.ruleId !== undefined) return { kind: "shadowed-rule", position: input.positions.get(first.ruleId) ?? 0 };
    return { kind: "none" };
}

/** The longest line Try it replays (the engine reads 64 characters; more only costs time). */
export const TRY_IT_MAX_LINE = 500;

/** Cuts a line to `TRY_IT_MAX_LINE` characters without splitting an emoji; `cut` says whether anything was dropped. */
export function capTryItLine(line: string): { line: string; cut: boolean } {
    if (line.length <= TRY_IT_MAX_LINE) return { line, cut: false };
    let end = TRY_IT_MAX_LINE;
    const last = line.charCodeAt(end - 1);
    if (last >= 0xd800 && last <= 0xdbff) end--;
    return { line: line.slice(0, end), cut: true };
}

/**
 * Types `input.line` and says what happened to the draft. A separator rule that has not seen a separator yet gets
 * one added to the preview (`needs-separator`), because that is what the user types next.
 */
export async function replayTryIt(input: TryItInput): Promise<TryItResult> {
    if (input.line === "") return { text: "", replaced: null, fields: [], caret: 0, status: { kind: "empty" } };
    let run = await replay(input);
    let status = statusOf(run, input);
    const draft = input.rules.find((r) => r.id === input.draftId);
    if (status.kind === "none" && draft?.mode === "separator") {
        const withSeparator = await replay({ ...input, line: `${input.line} ` });
        if (withSeparator.expansions.some((e) => e.ruleId === input.draftId)) {
            run = withSeparator;
            status = { kind: "needs-separator" };
        }
    }
    return {
        text: run.text,
        replaced: run.replaced,
        fields: run.fresh ? run.fields : [],
        caret: run.fresh && run.caret !== null ? run.caret : run.text.length,
        status,
    };
}
