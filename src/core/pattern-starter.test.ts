import { describe, it, expect } from "vitest";
import { checkPattern, compileRule, type CompiledRule } from "../engine/patterns";
import { replayTryIt } from "./pattern-tryit";
import { STARTER_GROUP, STARTER_RULES } from "./pattern-starter";

function compiled(): CompiledRule[] {
    return STARTER_RULES.map((s, i) => {
        const r = compileRule({ ...s, id: `s${i}`, enabled: true });
        if (!r.ok) throw new Error(`${s.source}: ${r.reason}`);
        return r.rule;
    });
}

async function type(line: string): Promise<string> {
    const rules = compiled();
    const result = await replayTryIt({
        line,
        rules,
        positions: new Map(rules.map((r, i) => [r.id, i + 1])),
        draftId: "none",
        snippets: {},
        expandWhileTyping: true,
        now: new Date(2026, 10, 19),
    });
    return result.text;
}

describe("typography starter set", () => {
    it("has the 32 rules of the Substitutions defaults, in one group", () => {
        expect(STARTER_RULES).toHaveLength(32);
        expect(new Set(STARTER_RULES.map((r) => r.group))).toEqual(new Set([STARTER_GROUP]));
    });

    it("has unique patterns and unique replacements", () => {
        expect(new Set(STARTER_RULES.map((r) => r.source)).size).toBe(32);
        expect(new Set(STARTER_RULES.map((r) => r.replacement)).size).toBe(32);
    });

    it("passes the S-015 gate in the mode each rule ships in, and compiles", () => {
        for (const rule of STARTER_RULES) {
            expect(checkPattern(rule.source, rule.mode), rule.source).toEqual({ ok: true });
        }
        expect(compiled()).toHaveLength(32);
    });

    it("fractions wait for a separator, everything else is instant", () => {
        const fractions = STARTER_RULES.filter((r) => /^[¼-¾⅐-⅞↉]$/.test(r.replacement));
        expect(fractions).toHaveLength(18);
        expect(fractions.every((r) => r.mode === "separator")).toBe(true);
        expect(STARTER_RULES.filter((r) => r.mode === "instant")).toHaveLength(14);
    });

    // typed text -> what a note shows, through the real engine
    const examples: Array<[string, string]> = [
        ["1/2 ", "½ "],
        ["1/3 ", "⅓ "],
        ["3/4 ", "¾ "],
        ["1/10 ", "⅒ "],
        ["7/8 ", "⅞ "],
        ["see 1/2.", "see ½."],
        ["1/23 ", "1/23 "],
        ["11/2 ", "11/2 "],
        ["a1/2 ", "a1/2 "],
        ["5/1/2 ", "5/1/2 "],
        ["1/2", "1/2"],
        ["a --> b", "a → b"],
        ["a <-- b", "a ← b"],
        ["a <-> b", "a ↔ b"],
        ["a != b", "a ≠ b"],
        ["a <= b", "a ≤ b"],
        ["a >= b", "a ≥ b"],
        ["a ~= b", "a ≅ b"],
        ["a +- b", "a ± b"],
        ["a -+ b", "a ∓ b"],
        ["wait...", "wait…"],
        ["<<", "≪"],
        ["<<<", "⋘"],
        [">>", "≫"],
        [">>>", "⋙"],
    ];
    it.each(examples)("typing %j gives %j", async (typed, shown) => {
        expect(await type(typed)).toBe(shown);
    });
});
