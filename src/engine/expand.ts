import type { Dict, EditPlan, ExpandContext, ExpandInput } from "./types";
import { shouldExpandHere } from "./guards";
import { findTrigger } from "./match";
import { applyPlaceholders } from "./placeholders";
import { applyPatternReplacement, matchPatterns, type CompiledRule } from "./patterns";
import { buildEdit } from "./edit";
import { DEFAULT_DELIMITERS } from "../shared/delimiters";

export async function expand(
    input: ExpandInput,
    dict: Dict,
    ctx: ExpandContext,
    delimiters = DEFAULT_DELIMITERS,
    /** ADR-0008: compiled pattern rules; only `separator` ones are tried here. */
    patterns: readonly CompiledRule[] = []
): Promise<EditPlan | null> {
    if (!shouldExpandHere(ctx)) return null;

    const m = findTrigger(input, dict, delimiters);
    if (!m) return expandPatternAtSeparator(input, ctx, delimiters, patterns);

    const raw = dict[m.trigger] ?? "";
    const applied = await applyPlaceholders(raw, ctx);
    return buildEdit(input, m, applied);
}

/**
 * ADR-0008, separator mode. Reached whenever no literal snippet expanded,
 * whatever the reason `findTrigger` said no (unknown word, empty candidate
 * between two separators as in `:smile:` + space, lookback cap, prefix
 * mismatch): literal triggers always win. Prefix mode does not apply here.
 */
async function expandPatternAtSeparator(
    input: ExpandInput,
    ctx: ExpandContext,
    delimiters: string[],
    patterns: readonly CompiledRule[],
): Promise<EditPlan | null> {
    if (patterns.length === 0 || !delimiters.includes(input.lastTyped)) return null;
    const hit = matchPatterns(input.textBefore, patterns, "separator");
    if (!hit) return null;
    const applied = await applyPatternReplacement(hit, ctx);
    const plan = buildEdit(input, { trigger: hit.rule.id, fromCh: hit.index, toCh: input.textBefore.length }, applied);
    return { ...plan, kind: "pattern" };
}

/**
 * ADR-0008, instant mode: `textBefore` is the line up to the caret right after
 * a typed character. The match must end at the caret. The editor maps a caret
 * that sits at the end of the replaced range to the end of the insert, so the
 * caret lands after the inserted text unless the replacement says otherwise
 * (`$|`, fields). The inserted text is not scanned again: the next keystroke
 * does that.
 */
export async function expandInstant(
    textBefore: string,
    ctx: ExpandContext,
    patterns: readonly CompiledRule[],
): Promise<EditPlan | null> {
    if (patterns.length === 0 || !shouldExpandHere(ctx)) return null;
    const hit = matchPatterns(textBefore, patterns, "instant");
    if (!hit) return null;
    const applied = await applyPatternReplacement(hit, ctx);
    const input: ExpandInput = { textBefore, textAfter: "", lastTyped: "", sepCh: textBefore.length };
    const plan = buildEdit(input, { trigger: hit.rule.id, fromCh: hit.index, toCh: textBefore.length }, applied);
    return { ...plan, kind: "pattern" };
}
