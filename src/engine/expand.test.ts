import { describe, it, expect } from "vitest";
import { expand, expandInstant } from "./expand";
import { compilePatternRules } from "./patterns";
import type { CompiledRule } from "./patterns";
import type { Dict, ExpandContext, PatternRule } from "./types";

const dict: Dict = {
    fn: "function $|() {}",
    brb: "be right back"
};

describe("expand", () => {
    const baseCtx = { isInCode: false, isInMath: false, isInFrontmatter: false, now: new Date("2025-09-02T10:11:12") };

    it("returns null if guard blocks (code/frontmatter)", async () => {
        const input = { textBefore: "fn", textAfter: "", lastTyped: " ", sepCh: 2 };
        const plan1 = await expand(input, dict, { ...baseCtx, isInCode: true });
        expect(plan1).toBeNull();
        const plan2 = await expand(input, dict, { ...baseCtx, isInFrontmatter: true });
        expect(plan2).toBeNull();
    });

    it("expands known trigger and positions cursor at $|", async () => {
        const input = { textBefore: "fn", textAfter: "", lastTyped: " ", sepCh: 2 };
        const plan = await expand(input, dict, baseCtx);
        expect(plan).not.toBeNull();
        expect(plan!.insert).toBe("function () {}");
        expect(plan!.fromCh).toBe(0);
        expect(plan!.toCh).toBe(2);
        expect(plan!.newCursor).toEqual({ lineDelta: 0, ch: "function ".length });
    });

    it("returns null for unknown trigger", async () => {
        const input = { textBefore: "zzz", textAfter: "", lastTyped: " ", sepCh: 3 };
        const plan = await expand(input, dict, baseCtx);
        expect(plan).toBeNull();
    });

    // S-008: before the fix, typing `constructor ` resolved `dict.constructor`
    // to the Object function — `expand` then called `.replace` on it and
    // threw a TypeError on the per-keystroke hot path. Must resolve to a
    // clean no-match instead.
    it("[S-008] returns null (no throw) for inherited prototype key as trigger", async () => {
        const input = { textBefore: "constructor", textAfter: "", lastTyped: " ", sepCh: "constructor".length };
        await expect(expand(input, dict, baseCtx)).resolves.toBeNull();
    });

    // B-243
    it("a snippet with two fields yields a plan with fields and a final stop", async () => {
        const input = { textBefore: "lnk", textAfter: "", lastTyped: " ", sepCh: 3 };
        const plan = await expand(input, { lnk: "[$1]($2)" }, baseCtx);
        expect(plan?.insert).toBe("[]()");
        expect(plan?.fields).toEqual([1, 3]);
        expect(plan?.docOrder).toEqual([0, 1]);
        // no `$|`: the adapter puts the final stop after the typed separator
        expect(plan?.final).toBeUndefined();
    });

    it("a virtual separator at the caret expands the trigger before it (B-244 input shape)", async () => {
        const input = { textBefore: "see brb", textAfter: " tail", lastTyped: "\n", sepCh: 7 };
        const plan = await expand(input, dict, baseCtx);
        expect(plan).toMatchObject({ fromCh: 4, toCh: 7, insert: "be right back" });
    });
});


// ADR-0008 patterns -------------------------------------------------------

const pctx: ExpandContext = { isInCode: false, isInMath: false, isInFrontmatter: false, now: new Date("2025-09-02T10:11:12") };

function patterns(...rules: Array<Partial<PatternRule> & { source: string }>): CompiledRule[] {
    const list: PatternRule[] = rules.map((r, i) => ({
        id: `r${i}`,
        replacement: "x",
        enabled: true,
        mode: "separator",
        ...r,
    }));
    const set = compilePatternRules(list);
    expect(set.errors).toEqual([]);
    return [...set.rules];
}

/** `typed` ends with the separator that was just typed. */
function sepInput(typed: string, extra: { prefix?: string } = {}) {
    const textBefore = typed.slice(0, -1);
    return { textBefore, textAfter: "", lastTyped: typed.slice(-1), sepCh: textBefore.length, ...extra };
}

describe("expand: separator-mode patterns (ADR-0008)", () => {
    const fraction = patterns({ source: String.raw`/(\d+)\/(\d+)$/`, replacement: "{{1}}\u2044{{2}}" });

    it("fires on the separator after the match and keeps the separator", async () => {
        const plan = await expand(sepInput("see 1/2 "), dict, pctx, undefined, fraction);
        expect(plan).toMatchObject({ kind: "pattern", fromCh: 4, toCh: 7, insert: "1\u20442" });
    });

    it("no patterns, no change: an unknown word is still null", async () => {
        await expect(expand(sepInput("1/2 "), dict, pctx)).resolves.toBeNull();
        await expect(expand(sepInput("1/2 "), dict, pctx, undefined, [])).resolves.toBeNull();
    });

    it(":(\\w+): fires on the space after the closing colon, where the literal candidate is empty", async () => {
        const rules = patterns({ source: String.raw`/:(\w+):$/`, replacement: "[{{1}}]" });
        // `findTrigger` has nothing to look up here (the char before the space is a separator itself).
        const plan = await expand(sepInput("hi :smile: "), dict, pctx, undefined, rules);
        expect(plan).toMatchObject({ fromCh: 3, toCh: 10, insert: "[smile]" });
        // ... and not on the closing colon itself (nothing to close yet).
        await expect(expand(sepInput("hi :smile:"), dict, pctx, undefined, rules)).resolves.toBeNull();
    });

    it("a literal trigger wins over a pattern that could also match", async () => {
        const rules = patterns({ source: String.raw`/\w+$/`, replacement: "PATTERN" });
        const plan = await expand(sepInput("brb "), dict, pctx, undefined, rules);
        expect(plan?.insert).toBe("be right back");
        expect(plan?.kind).toBeUndefined();
    });

    it("runs when the literal miss is a lookback cap (a trigger-less 100-char word)", async () => {
        const rules = patterns({ source: String.raw`/z+$/`, replacement: "Z" });
        const typed = "z".repeat(100) + " ";
        const plan = await expand(sepInput(typed), dict, pctx, undefined, rules);
        expect(plan).toMatchObject({ insert: "Z", toCh: 100 });
        expect(plan?.fromCh).toBe(100 - 64); // only the last 64 characters are looked at
    });

    it("runs when prefix mode refused the literal (prefix mode does not apply to patterns)", async () => {
        const rules = patterns({ source: String.raw`/(\d+)\/(\d+)$/`, replacement: "{{1}}-{{2}}" });
        const plan = await expand(sepInput("1/2 ", { prefix: ":" }), dict, pctx, undefined, rules);
        expect(plan?.insert).toBe("1-2");
        // a literal without the prefix does not expand, and a pattern for it still can
        const brb = patterns({ source: "/brb$/", replacement: "PATTERN" });
        expect((await expand(sepInput("brb ", { prefix: ":" }), dict, pctx, undefined, brb))?.insert).toBe("PATTERN");
    });

    it("does nothing when the typed character is not a delimiter", async () => {
        const rules = patterns({ source: String.raw`/\d+$/` });
        await expect(expand({ textBefore: "12", textAfter: "", lastTyped: "3", sepCh: 2 }, dict, pctx, undefined, rules)).resolves.toBeNull();
    });

    it("works for Enter (virtual separator) and for the end-of-line command shape", async () => {
        const rules = patterns({ source: String.raw`/mtg (\w+)$/`, replacement: "Meeting with {{1}}" });
        const plan = await expand({ textBefore: "mtg Bob", textAfter: "", lastTyped: "\n", sepCh: 7 }, dict, pctx, undefined, rules);
        expect(plan).toMatchObject({ fromCh: 0, toCh: 7, insert: "Meeting with Bob" });
    });

    it("guards apply: no expansion in code, math or frontmatter", async () => {
        const input = sepInput("1/2 ");
        for (const flag of ["isInCode", "isInMath", "isInFrontmatter"] as const) {
            await expect(expand(input, dict, { ...pctx, [flag]: true }, undefined, fraction), flag).resolves.toBeNull();
        }
    });

    it("instant rules are not tried at a separator", async () => {
        const rules = patterns({ source: String.raw`/(\d+)\/(\d+)$/`, mode: "instant" });
        await expect(expand(sepInput("1/2 "), dict, pctx, undefined, rules)).resolves.toBeNull();
    });

    it("the first matching rule in list order wins", async () => {
        const rules = patterns(
            { source: String.raw`/\d$/`, replacement: "first" },
            { source: String.raw`/\d\d$/`, replacement: "second" },
        );
        expect((await expand(sepInput("12 "), dict, pctx, undefined, rules))?.insert).toBe("first");
    });

    it("a capture before a field puts the field and the caret in the right place of the plan", async () => {
        const rules = patterns({ source: String.raw`/mtg (\w+)$/`, replacement: "With {{1}} on $1 re $2$|" });
        const plan = await expand(sepInput("mtg Bob "), dict, pctx, undefined, rules);
        expect(plan?.insert).toBe("With Bob on  re ");
        expect(plan?.fields).toEqual(["With Bob on ".length, "With Bob on  re ".length]);
        expect(plan?.final).toBe("With Bob on  re ".length);
    });

    it("a literal snippet keeps {{1}} as text", async () => {
        const plan = await expand(sepInput("lit "), { lit: "{{1}} stays" }, pctx, undefined, patterns({ source: "/zzz$/" }));
        expect(plan?.insert).toBe("{{1}} stays");
    });
});

describe("expandInstant (ADR-0008)", () => {
    const arrows = patterns(
        { source: String.raw`/<<$/`, replacement: "\u226a", mode: "instant" },
        { source: String.raw`/\u226a<$/`, replacement: "\u22d8", mode: "instant" },
    );

    it("a match that ends at the caret is replaced, the caret lands after it", async () => {
        const plan = await expandInstant("a <<", pctx, arrows);
        expect(plan).toMatchObject({ kind: "pattern", fromCh: 2, toCh: 4, insert: "\u226a" });
        // no explicit caret: the editor maps the caret at the end of the replaced range to the end of the insert
        expect(plan?.newCursor).toBeUndefined();
    });

    it("the inserted text is not scanned again in the same call (<< gives one step, not two)", async () => {
        // `<<` -> `\u226a`; the second rule would match `\u226a<`, which is NOT what the line holds, and the
        // inserted text itself is never offered to a rule. One call, one plan.
        const plan = await expandInstant("<<", pctx, arrows);
        expect(plan?.insert).toBe("\u226a");
        // The next keystroke sees it: `\u226a<` -> `\u22d8`.
        expect((await expandInstant("\u226a<", pctx, arrows))?.insert).toBe("\u22d8");
    });

    it("no match, no plan; separator-mode rules are ignored", async () => {
        await expect(expandInstant("a <", pctx, arrows)).resolves.toBeNull();
        await expect(expandInstant("<<", pctx, patterns({ source: "/<<$/", mode: "separator" }))).resolves.toBeNull();
        await expect(expandInstant("<<", pctx, [])).resolves.toBeNull();
    });

    it("guards apply", async () => {
        for (const flag of ["isInCode", "isInMath", "isInFrontmatter"] as const) {
            await expect(expandInstant("<<", { ...pctx, [flag]: true }, arrows), flag).resolves.toBeNull();
        }
    });

    it("$| puts the caret inside the insert, fields start at the first field", async () => {
        const caret = patterns({ source: "/box$/", replacement: "[ $| ]", mode: "instant" });
        const plan = await expandInstant("box", pctx, caret);
        expect(plan?.newCursor).toEqual({ lineDelta: 0, ch: 2 });
        const fields = patterns({ source: "/lnk$/", replacement: "[$1]($2)", mode: "instant" });
        const withFields = await expandInstant("see lnk", pctx, fields);
        expect(withFields?.fields).toEqual([1, 3]);
        expect(withFields?.newCursor).toEqual({ lineDelta: 0, ch: 5 });
    });

    it("$| on a later line of a multi-line replacement is placed by line and column", async () => {
        const rules = patterns({ source: "/cal$/", replacement: "> [!note]\n> $|", mode: "instant" });
        const plan = await expandInstant("cal", pctx, rules);
        expect(plan?.newCursor).toEqual({ lineDelta: 1, ch: 2 });
    });

    it("a capture sits where the typed text was: 1/2 -> half", async () => {
        const rules = patterns({ source: String.raw`/(\d+)\/(\d+)$/`, replacement: "{{1}}\u2044{{2}}", mode: "instant" });
        const plan = await expandInstant("take 3/4", pctx, rules);
        expect(plan).toMatchObject({ fromCh: 5, toCh: 8, insert: "3\u20444" });
    });
});
