import { describe, it, expect } from "vitest";
import { checkPattern, PATTERN_REASON_CODES, type PatternReasonCode } from "../engine/patterns";
import { describePatternRefusal, engineDetail, PATTERN_REASON_MESSAGES } from "./pattern-reasons";

/** One pattern per reason code `checkPattern` can return: proves each code is reachable and worded. */
const SAMPLES: Record<PatternReasonCode, { source: string | null; mode?: "instant" | "separator"; says: string }> = {
    too_long: { source: `/${"a".repeat(201)}$/`, says: "Keep the pattern to 200 characters. This one has 202." },
    shape: { source: "abc$", says: "Write the pattern between slashes, like /abc$/." },
    flag: { source: "/a$/g", says: "Flag g isn't allowed. Use i or none." },
    flag_twice: { source: "/a$/ii", says: "Flag i is written twice." },
    invalid_regex: { source: "/a{2,1}$/", says: "Not a valid regular expression: numbers out of order in {} quantifier" },
    nothing_to_repeat: { source: null, says: "A repeat (*, + or ?) has nothing before it to repeat." },
    lone_backslash: { source: null, says: "The pattern ends with a lone backslash. Write \\\\ for a backslash." },
    backreference: { source: "/(a)\\1$/", says: "Backreferences like \\1 aren't supported." },
    lookahead: { source: "/a(?=b)$/", says: "Lookahead like (?=x) isn't supported. Nothing follows the caret yet." },
    property_escape: { source: "/\\p{L}$/", says: "Unicode property classes like \\p{L} aren't supported yet. Use \\w or a range such as [а-яё]." },
    astral_in_class: { source: "/[\u{1F600}]$/", says: "Emoji can't go inside [ ] yet. Write them as plain text, or use a group like (?:😀|🙏)." },
    emoji_quantifier: { source: "/\u{1F600}+$/", says: "A repeat can't follow an emoji directly. Put the emoji in a group, like (?:😀)+." },
    escaped_emoji: { source: "/\\\u{1F600}$/", says: "A backslash can't go before an emoji. Write the emoji as plain text." },
    repeated_emoji_alternation: {
        source: "/(?:\u{1F600}|\u{1F64F})+$/",
        says: "A repeated group can't hold a choice, and emoji can't go inside [ ]. Use the group once, like (?:😀|🙏), or write one rule per emoji.",
    },
    unsupported_escape: { source: "/\\041$/", says: "The escape \\041 isn't supported. Write the character itself, or use \\d, \\w, \\s or \\b." },
    class_not_closed: { source: null, says: "A [ is missing its closing ]." },
    group_name_not_closed: { source: null, says: "A group name is missing its closing >." },
    group_name_backslash: { source: "/(?<na\\u0064me>a)$/", says: "A group name can't contain a backslash." },
    group_syntax: { source: null, says: "This group syntax isn't supported. Use (…), (?:…), (?<name>…) or (?<=…)." },
    group_not_closed: { source: null, says: "A ( is missing its closing )." },
    unbalanced_paren: { source: null, says: "There is a ) with no ( before it." },
    missing_end_anchor: { source: "/abc/", says: "End the pattern with $ so it matches right before the caret." },
    reserved_group_name: { source: "/(?<date>\\d+)$/", says: 'The group name "date" is reserved. Pick another name.' },
    lookbehind_quantifier: { source: "/(?<=a+)b$/", says: "A lookbehind needs a fixed length, like (?<= )." },
    repeated_group: { source: "/(a+)+$/", says: "A repeated group can't hold a repeat or a choice, like (a+)+. This can freeze typing. Use a class like [ab] instead." },
    lookbehind_size: { source: "/(?<=abcdefghi)x$/", says: "All lookbehinds together can hold at most 8 characters or groups. Shorten them." },
    too_many_unbounded: { source: "/\\w+\\w+\\w+x$/", mode: "separator", says: "Use at most 2 open-ended repeats (*, + or {n,}). This one has 3." },
    instant_unbounded: {
        source: "/\\w+\\d+x$/",
        mode: "instant",
        says: "An instant rule can have at most 1 open-ended repeat (*, + or {n,}); this one has 2. Choose After a separator to use up to 2.",
    },
    too_many_choices: { source: "/a?a?a?a?a?a?a?a?a?a?a?a?\\w+x$/", mode: "separator", says: "Too many optional or ranged parts (?, {n,m} or |) next to the other repeats, so matching could get slow. Remove some." },
    empty_match: { source: "/a*$/", says: "This pattern can match empty text, so it would fire on every key." },
};

describe("pattern refusal messages", () => {
    it("has one sample and one message for every reason code (the Record is checked by the compiler)", () => {
        expect(Object.keys(SAMPLES).sort()).toEqual([...PATTERN_REASON_CODES].sort());
        expect(Object.keys(PATTERN_REASON_MESSAGES).sort()).toEqual([...PATTERN_REASON_CODES].sort());
    });

    // `source: null`: the parser's own refusals for malformed syntax. `new RegExp` rejects such a pattern first (as
    // `invalid_regex`), so `checkPattern` cannot return them today; they stay worded in case the order of the checks changes.
    for (const code of PATTERN_REASON_CODES) {
        it(`${code}: checkPattern returns it and the message is the planned sentence`, () => {
            const sample = SAMPLES[code];
            if (sample.source === null) {
                expect(PATTERN_REASON_MESSAGES[code]({})).toBe(sample.says);
                return;
            }
            const check = checkPattern(sample.source, sample.mode ?? "separator");
            expect(check.ok).toBe(false);
            if (check.ok) return;
            expect(check.code).toBe(code);
            expect(describePatternRefusal(check)).toBe(sample.says);
        });
    }

    it("never uses an em dash or leaves a placeholder undefined", () => {
        for (const code of PATTERN_REASON_CODES) {
            const text = PATTERN_REASON_MESSAGES[code]({});
            expect(text).not.toMatch(/—|undefined|NaN/);
            expect(text.length).toBeGreaterThan(10);
        }
    });

    it("an instant rule over the separator limit too is worded as the separator limit", () => {
        const check = checkPattern("/\\w+\\d+\\s+x$/", "instant");
        expect(check.ok).toBe(false);
        if (check.ok) return;
        expect(check.code).toBe("too_many_unbounded");
        expect(describePatternRefusal(check)).toContain("at most 2");
    });

    it("the same pattern is refused as instant and accepted as a separator rule", () => {
        expect(checkPattern("/\\w+\\d+x$/", "instant").ok).toBe(false);
        expect(checkPattern("/\\w+\\d+x$/", "separator").ok).toBe(true);
    });

    it("strips the pattern V8 puts in front of its own message", () => {
        expect(engineDetail("Invalid regular expression: /(?:a{2,1})$/g: numbers out of order in {} quantifier")).toBe("numbers out of order in {} quantifier");
        expect(engineDetail("plain")).toBe("plain");
        expect(engineDetail(undefined)).toBe("it does not compile");
    });

    it("too_long counts the body the message talks about, not the slashes and flags around it", () => {
        for (const source of [`/${"a".repeat(300)}$/`, `/${"a".repeat(300)}$/i`]) {
            const check = checkPattern(source, "separator");
            expect(check.ok).toBe(false);
            if (check.ok) return;
            expect(check.code).toBe("too_long");
            expect(describePatternRefusal(check)).toBe("Keep the pattern to 200 characters. This one has 301.");
        }
        const noSlashes = checkPattern("a".repeat(300), "separator");
        if (noSlashes.ok) throw new Error("expected a refusal");
        expect(describePatternRefusal(noSlashes)).toBe("Keep the pattern to 200 characters. This one has 300.");
    });
});
