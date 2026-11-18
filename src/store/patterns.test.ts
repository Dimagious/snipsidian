import { describe, it, expect } from "vitest";
import { getCompiledPatterns, patternsSignature } from "./patterns";
import { NO_PATTERNS } from "../engine/patterns";
import type { SnipSidianSettings } from "../types";
import type { PatternRule } from "../engine/types";

function rule(id: string, source: string, extra: Partial<PatternRule> = {}): PatternRule {
    return { id, source, replacement: "x", enabled: true, mode: "instant", ...extra };
}

function settings(extra: Partial<SnipSidianSettings> = {}): SnipSidianSettings {
    return { snippets: {}, ...extra };
}

describe("store/patterns: getCompiledPatterns", () => {
    it("no patterns field, an empty list or a broken one give the shared empty value", () => {
        expect(getCompiledPatterns(settings())).toBe(NO_PATTERNS);
        expect(getCompiledPatterns(settings({ patterns: [] }))).toBe(NO_PATTERNS);
        const broken = { snippets: {}, patterns: "nope" } as unknown as SnipSidianSettings;
        expect(getCompiledPatterns(broken)).toBe(NO_PATTERNS);
        const obj = { snippets: {}, patterns: { length: 3 } } as unknown as SnipSidianSettings;
        expect(getCompiledPatterns(obj)).toBe(NO_PATTERNS);
    });

    it("compiles the saved rules in list order", () => {
        const out = getCompiledPatterns(settings({ patterns: [rule("a", "/a$/"), rule("b", "/b$/", { mode: "separator" })] }));
        expect(out.rules.map((r) => r.id)).toEqual(["a", "b"]);
        expect(out.hasInstant && out.hasSeparator).toBe(true);
    });

    it("a rule from a hand-edited data.json goes through the same gate: refused alone, with its reason", () => {
        const out = getCompiledPatterns(
            settings({ patterns: [rule("evil", String.raw`/(a+)+$/`), rule("ok", "/ok$/"), rule("nog", "/abc/")] }),
        );
        expect(out.rules.map((r) => r.id)).toEqual(["ok"]);
        expect(out.errors.map((e) => e.id)).toEqual(["evil", "nog"]);
    });

    it("disabledGroups applies to rules that name the group", () => {
        const out = getCompiledPatterns(
            settings({
                disabledGroups: ["muted"],
                patterns: [rule("a", "/a$/", { group: "muted" }), rule("b", "/b$/", { group: "other" }), rule("c", "/c$/")],
            }),
        );
        expect(out.rules.map((r) => r.id)).toEqual(["b", "c"]);
        expect(out.errors).toEqual([]);
    });

    it("a switched-off rule is not compiled and not reported", () => {
        const out = getCompiledPatterns(settings({ patterns: [rule("a", String.raw`/(a+)+$/`, { enabled: false })] }));
        expect(out.rules).toEqual([]);
        expect(out.errors).toEqual([]);
    });

    it("repeated calls reuse the compiled RegExp (nothing is compiled per keystroke)", () => {
        const s = settings({ patterns: [rule("a", "/reuse(\\d)$/")] });
        expect(getCompiledPatterns(s).rules[0]?.re).toBe(getCompiledPatterns(s).rules[0]?.re);
    });

    it("an edit in place is seen at once (no stale copy of the list)", () => {
        const s = settings({ patterns: [rule("a", "/a$/")] });
        expect(getCompiledPatterns(s).rules).toHaveLength(1);
        s.patterns?.push(rule("b", "/b$/"));
        expect(getCompiledPatterns(s).rules).toHaveLength(2);
        if (s.patterns?.[0]) s.patterns[0].enabled = false;
        expect(getCompiledPatterns(s).rules.map((r) => r.id)).toEqual(["b"]);
    });
});

describe("store/patterns: patternsSignature", () => {
    it("is stable for unrelated changes and moves with the rules and the muted groups", () => {
        const s = settings({ patterns: [rule("a", "/a$/", { group: "g" })] });
        const before = patternsSignature(s);
        s.snippets = { "x/y": "z" };
        s.expansion = { highlight: true };
        expect(patternsSignature(s)).toBe(before);
        const edits: Array<(x: SnipSidianSettings) => void> = [
            (x) => { if (x.patterns?.[0]) x.patterns[0].replacement = "other"; },
            (x) => { if (x.patterns?.[0]) x.patterns[0].source = "/b$/"; },
            (x) => { if (x.patterns?.[0]) x.patterns[0].enabled = false; },
            (x) => { x.patterns?.push(rule("b", "/b$/")); },
            (x) => { x.disabledGroups = ["g"]; },
        ];
        for (const edit of edits) {
            const copy: SnipSidianSettings = structuredClone(s);
            edit(copy);
            expect(patternsSignature(copy)).not.toBe(before);
        }
    });

    it("treats no patterns and no muted groups as one state", () => {
        expect(patternsSignature(settings())).toBe(patternsSignature(settings({ snippets: { a: "b" } })));
    });
});
