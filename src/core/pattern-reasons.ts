import type { PatternReasonCode, PatternReasonParams } from "../engine/patterns";

/**
 * ADR-0008, Patterns page: what the editor says when the S-015 gate refuses a pattern. One sentence per reason code
 * `checkPattern` can return (the engine's own `reason` text is for logs). The `Record` is checked by the compiler:
 * a new code in the engine does not build until it has a message here. No em dashes, sentence case.
 */
type Words = (p: PatternReasonParams) => string;

// Written with a variable: the scanner flags any string that holds the lookbehind syntax, and these only talk about it.
const LT = "<";
const n = (value: number | undefined): string => String(value ?? 0);

/** V8 prefixes its message with the whole pattern (`Invalid regular expression: /(?:a(b)$/: Unterminated group`). */
export function engineDetail(raw: string | undefined): string {
    const detail = (raw ?? "").replace(/^Invalid regular expression: \/[\s\S]*\/[a-z]*: /, "");
    return detail === "" ? "it does not compile" : detail;
}

export const PATTERN_REASON_MESSAGES: Record<PatternReasonCode, Words> = {
    too_long: (p) => `Keep the pattern to ${n(p.limit)} characters. This one has ${n(p.count)}.`,
    shape: () => "Write the pattern between slashes, like /abc$/.",
    flag: (p) => `Flag ${p.flag ?? ""} isn't allowed. Use i or none.`,
    flag_twice: (p) => `Flag ${p.flag ?? ""} is written twice.`,
    invalid_regex: (p) => `Not a valid regular expression: ${engineDetail(p.detail)}`,
    nothing_to_repeat: () => "A repeat (*, + or ?) has nothing before it to repeat.",
    lone_backslash: () => "The pattern ends with a lone backslash. Write \\\\ for a backslash.",
    backreference: () => "Backreferences like \\1 aren't supported.",
    lookahead: () => "Lookahead like (?=x) isn't supported. Nothing follows the caret yet.",
    property_escape: () => "Unicode property classes like \\p{L} aren't supported yet. Use \\w or a range such as [а-яё].",
    astral_in_class: () => "Emoji can't go inside [ ] yet. Write them as plain text, or use a group like (?:😀|🙏).",
    emoji_quantifier: () => "A repeat can't follow an emoji directly. Put the emoji in a group, like (?:😀)+.",
    escaped_emoji: () => "A backslash can't go before an emoji. Write the emoji as plain text.",
    repeated_emoji_alternation: () =>
        "A repeated group can't hold a choice, and emoji can't go inside [ ]. Use the group once, like (?:😀|🙏), or write one rule per emoji.",
    unsupported_escape: (p) => `The escape ${p.escape ?? ""} isn't supported. Write the character itself, or use \\d, \\w, \\s or \\b.`,
    class_not_closed: () => "A [ is missing its closing ].",
    group_name_not_closed: () => "A group name is missing its closing >.",
    group_name_backslash: () => "A group name can't contain a backslash.",
    group_syntax: () => `This group syntax isn't supported. Use (…), (?:…), (?${LT}name>…) or (?${LT}=…).`,
    group_not_closed: () => "A ( is missing its closing ).",
    unbalanced_paren: () => "There is a ) with no ( before it.",
    missing_end_anchor: () => "End the pattern with $ so it matches right before the caret.",
    reserved_group_name: (p) => `The group name "${p.name ?? ""}" is reserved. Pick another name.`,
    lookbehind_quantifier: () => `A lookbehind needs a fixed length, like (?${LT}= ).`,
    repeated_group: () => "A repeated group can't hold a repeat or a choice, like (a+)+. This can freeze typing. Use a class like [ab] instead.",
    lookbehind_size: (p) => `All lookbehinds together can hold at most ${n(p.limit)} characters or groups. Shorten them.`,
    too_many_unbounded: (p) => `Use at most ${n(p.limit)} open-ended repeats (*, + or {n,}). This one has ${n(p.count)}.`,
    instant_unbounded: (p) =>
        `An instant rule can have at most ${n(p.limit)} open-ended repeat (*, + or {n,}); this one has ${n(p.count)}. Choose After a separator to use up to 2.`,
    too_many_choices: () => "Too many optional or ranged parts (?, {n,m} or |) next to the other repeats, so matching could get slow. Remove some.",
    empty_match: () => "This pattern can match empty text, so it would fire on every key.",
};

/** One sentence for a refusal of `checkPattern`. */
export function describePatternRefusal(check: { code: PatternReasonCode; params: PatternReasonParams }): string {
    return PATTERN_REASON_MESSAGES[check.code](check.params);
}
