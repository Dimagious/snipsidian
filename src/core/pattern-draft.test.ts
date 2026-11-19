import { describe, it, expect } from "vitest";
import { MAX_PATTERN_REPLACEMENT } from "../engine/patterns";
import {
    countCaptureGroups,
    OVER_RULE_LIMIT,
    REPLACEMENT_HALF_EMOJI,
    REPLACEMENT_TOO_LONG,
    storedRuleProblem,
    validatePatternDraft,
} from "./pattern-draft";

describe("validatePatternDraft", () => {
    it("accepts a good rule", () => {
        expect(validatePatternDraft({ source: "/1\\/2$/", replacement: "½", mode: "instant" })).toEqual({ warnings: [], ok: true });
    });

    it("an empty pattern cannot be saved but shows no error line yet", () => {
        const issues = validatePatternDraft({ source: "  ", replacement: "x", mode: "instant" });
        expect(issues.ok).toBe(false);
        expect(issues.pattern).toBeUndefined();
    });

    it("refuses with the sentence for the refusal, and cannot be saved", () => {
        const issues = validatePatternDraft({ source: "/a$/g", replacement: "x", mode: "instant" });
        expect(issues.ok).toBe(false);
        expect(issues.pattern).toBe("Flag g isn't allowed. Use i or none.");
    });

    it("passes the draft's MODE to the gate: two open-ended repeats are fine After a separator, not Instant", () => {
        const source = "/\\w+\\d+x$/";
        expect(validatePatternDraft({ source, replacement: "x", mode: "separator" }).ok).toBe(true);
        const instant = validatePatternDraft({ source, replacement: "x", mode: "instant" });
        expect(instant.ok).toBe(false);
        expect(instant.pattern).toMatch(/^An instant rule can have at most 1 open-ended repeat/);
    });

    it("words a malformed pattern with the engine's own message", () => {
        const issues = validatePatternDraft({ source: "/(a$/", replacement: "x", mode: "instant" });
        expect(issues.pattern).toMatch(/^Not a valid regular expression: .+/);
        expect(issues.pattern).not.toContain("Invalid regular expression: /");
    });

    it("refuses an over-long replacement at the cap and accepts it at the cap", () => {
        const atCap = validatePatternDraft({ source: "/a$/", replacement: "x".repeat(MAX_PATTERN_REPLACEMENT), mode: "instant" });
        expect(atCap.ok).toBe(true);
        const over = validatePatternDraft({ source: "/a$/", replacement: "x".repeat(MAX_PATTERN_REPLACEMENT + 1), mode: "instant" });
        expect(over.ok).toBe(false);
        expect(over.replacement).toBe(REPLACEMENT_TOO_LONG);
        expect(REPLACEMENT_TOO_LONG).toBe("Keep the replacement to 10,000 characters.");
    });

    it("refuses a replacement with half an emoji", () => {
        const issues = validatePatternDraft({ source: "/a$/", replacement: "x\ud83d", mode: "instant" });
        expect(issues.ok).toBe(false);
        expect(issues.replacement).toBe(REPLACEMENT_HALF_EMOJI);
        expect(validatePatternDraft({ source: "/a$/", replacement: "\u{1F600}", mode: "instant" }).ok).toBe(true);
    });

    it("an empty replacement is allowed (a rule can delete text)", () => {
        expect(validatePatternDraft({ source: "/a$/", replacement: "", mode: "instant" }).ok).toBe(true);
    });

    it("warns, without blocking, for {{n}} with no group n", () => {
        const issues = validatePatternDraft({ source: "/(\\d+)x$/", replacement: "{{1}} {{3}} {{3}} {{2}}", mode: "separator" });
        expect(issues.ok).toBe(true);
        expect(issues.warnings).toEqual([
            "{{2}} has no group 2 in the pattern, so it inserts nothing.",
            "{{3}} has no group 3 in the pattern, so it inserts nothing.",
        ]);
    });

    it("{{0}} is always there, and no warning while the pattern is refused", () => {
        expect(validatePatternDraft({ source: "/a$/", replacement: "{{0}}", mode: "instant" }).warnings).toEqual([]);
        expect(validatePatternDraft({ source: "/a$/g", replacement: "{{5}}", mode: "instant" }).warnings).toEqual([]);
    });
});

describe("countCaptureGroups", () => {
    it.each([
        ["/a$/", 0],
        ["/(a)(b)$/", 2],
        ["/(?:a)(b)$/", 1],
        ["/(?<n>a)(b)$/", 2],
        ["/(?<=a)(?<!b)c$/", 0],
        ["/\\(a\\)$/", 0],
        ["/[(]a$/", 0],
        ["/[\\]](a)$/", 1],
        ["not a pattern", 0],
    ])("%s has %i group(s)", (source, count) => {
        expect(countCaptureGroups(source)).toBe(count);
    });
});

describe("storedRuleProblem", () => {
    const good = { id: "a", source: "/a$/", replacement: "b", mode: "instant", enabled: true };

    it("is null for a rule the engine accepts", () => {
        expect(storedRuleProblem(good, 0)).toBeNull();
    });

    it("says the rule is over the 100 rule limit", () => {
        expect(storedRuleProblem(good, 100)).toBe(OVER_RULE_LIMIT);
        expect(storedRuleProblem(good, 99)).toBeNull();
        expect(OVER_RULE_LIMIT).toBe("Skipped: over the 100 rule limit.");
    });

    it("gives the refusal of the gate for a bad pattern, with the rule's own mode", () => {
        expect(storedRuleProblem({ ...good, source: "/a$/g" }, 0)).toBe("Flag g isn't allowed. Use i or none.");
        expect(storedRuleProblem({ ...good, source: "/\\w+\\d+x$/", mode: "instant" }, 0)).toMatch(/instant rule/);
        expect(storedRuleProblem({ ...good, source: "/\\w+\\d+x$/", mode: "separator" }, 0)).toBeNull();
    });

    it("survives a hand-edited data.json", () => {
        expect(storedRuleProblem(null, 0)).toBe("This entry is not a rule.");
        expect(storedRuleProblem("x", 0)).toBe("This entry is not a rule.");
        expect(storedRuleProblem({ ...good, source: 5 }, 0)).toBe("This rule has no pattern.");
        expect(storedRuleProblem({ ...good, replacement: undefined }, 0)).toBe("This rule has no replacement.");
        expect(storedRuleProblem({ ...good, mode: "later" }, 0)).toMatch(/unknown mode/);
        expect(storedRuleProblem({ ...good, id: "" }, 0)).toBe("The rule has no id.");
    });

    it("a stored instant rule with two open-ended repeats gets the instant sentence, not the separator limit", () => {
        const problem = storedRuleProblem({ ...good, source: "/\\w+\\d+x$/", mode: "instant" }, 0);
        expect(problem).toBe(
            "An instant rule can have at most 1 open-ended repeat (*, + or {n,}); this one has 2. Choose After a separator to use up to 2.",
        );
    });

    it("a missing mode means instant, like the engine", () => {
        const { mode: _mode, ...noMode } = good;
        expect(storedRuleProblem({ ...noMode, source: "/\\w+\\d+x$/" }, 0)).toMatch(/instant rule/);
    });
});
