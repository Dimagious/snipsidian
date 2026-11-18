import type { Dict, EditPlan, ExpandContext, ExpandInput } from "./types";
import { shouldExpandHere } from "./guards";
import { findTrigger } from "./match";
import { applyPlaceholders } from "./placeholders";
import { applyPatternReplacement, matchPatternsInOrder, type CompiledRule, type PatternMatch } from "./patterns";
import { buildEdit } from "./edit";
import { DEFAULT_DELIMITERS } from "../shared/delimiters";

export async function expand(
    input: ExpandInput,
    dict: Dict,
    ctx: ExpandContext,
    delimiters = DEFAULT_DELIMITERS,
    /** ADR-0008: compiled pattern rules, tried after a literal miss. */
    patterns: readonly CompiledRule[] = [],
    /** ADR-0008: the keystroke was a typed character (not the Enter key, not the command), so instant rules may
     *  read the line up to and including the typed separator. */
    instant = false,
): Promise<EditPlan | null> {
    if (!shouldExpandHere(ctx)) return null;

    const m = findTrigger(input, dict, delimiters);
    if (!m) return expandPatternAtSeparator(input, ctx, delimiters, patterns, instant);

    const raw = dict[m.trigger] ?? "";
    const applied = await applyPlaceholders(raw, ctx);
    return buildEdit(input, m, applied);
}

/**
 * ADR-0008, patterns on a separator. Reached whenever no literal snippet
 * expanded, whatever the reason `findTrigger` said no (unknown word, empty
 * candidate between two separators as in `:smile:` + space, lookback cap,
 * prefix mismatch): literal triggers always win. Prefix mode does not apply
 * here. The rules are tried top to bottom whatever their mode: a separator rule
 * reads the line before the separator, an instant rule (only when `instant`)
 * the line up to and including it.
 */
async function expandPatternAtSeparator(
    input: ExpandInput,
    ctx: ExpandContext,
    delimiters: string[],
    patterns: readonly CompiledRule[],
    instant: boolean,
): Promise<EditPlan | null> {
    if (patterns.length === 0 || !delimiters.includes(input.lastTyped)) return null;
    const throughCaret = input.textBefore + input.lastTyped;
    const hit = matchPatternsInOrder(
        { beforeSeparator: input.textBefore, atCaret: instant ? throughCaret : undefined },
        patterns,
    );
    if (!hit) return null;
    const applied = await applyPatternReplacement(hit, ctx);
    if (hit.rule.mode === "instant") {
        // The match ends with the typed separator: it is replaced with the rest.
        const plan = buildEdit(input, { trigger: hit.rule.id, fromCh: hit.index, toCh: throughCaret.length }, applied);
        return { ...plan, kind: "pattern", consumesSeparator: true };
    }
    const plan = buildEdit(input, { trigger: hit.rule.id, fromCh: hit.index, toCh: input.textBefore.length }, applied);
    return { ...plan, kind: "pattern" };
}

/**
 * ADR-0008, instant mode: `textBefore` is the line up to the caret right after
 * a typed character. `hit` is the match the caller already found on that line
 * (so the regex runs once per keystroke, not twice); it ends at the caret. The editor maps a caret
 * that sits at the end of the replaced range to the end of the insert, so the
 * caret lands after the inserted text unless the replacement says otherwise
 * (`$|`, fields). The inserted text is not scanned again: the next keystroke
 * does that.
 */
export async function expandInstant(
    textBefore: string,
    ctx: ExpandContext,
    hit: PatternMatch,
): Promise<EditPlan | null> {
    if (!shouldExpandHere(ctx)) return null;
    const applied = await applyPatternReplacement(hit, ctx);
    const input: ExpandInput = { textBefore, textAfter: "", lastTyped: "", sepCh: textBefore.length };
    const plan = buildEdit(input, { trigger: hit.rule.id, fromCh: hit.index, toCh: textBefore.length }, applied);
    return { ...plan, kind: "pattern" };
}
