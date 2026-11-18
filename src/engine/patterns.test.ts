import { describe, it, expect, vi } from "vitest";
import { createContext, Script } from "node:vm";
import {
    applyPatternReplacement,
    checkPattern,
    canEndWith,
    matchPatternsInOrder,
    compilePatternRules,
    compileRule,
    matchPatterns,
    MAX_PATTERN_REPLACEMENT,
    NO_PATTERNS,
    type CompiledRule,
    type PatternMatch,
} from "./patterns";
import type { ExpandContext, PatternMode, PatternRule } from "./types";

const ctx: ExpandContext = { isInCode: false, isInMath: false, isInFrontmatter: false, now: new Date("2025-09-02T10:11:12") };

/** The separator limits (the lenient ones) unless a mode is given; instant rules are stricter. */
const check = (source: string, mode: PatternMode = "separator") => checkPattern(source, mode);

/** `/body/` or a full source. */
const src = (body: string, flags = ""): string => `/${body}/${flags}`;

function rule(source: string, replacement = "x", extra: Partial<PatternRule> = {}): PatternRule {
    return { id: "r1", source, replacement, enabled: true, mode: "instant", ...extra };
}

function compiled(source: string, replacement = "x", mode: PatternRule["mode"] = "separator"): CompiledRule {
    const result = compileRule(rule(source, replacement, { mode }));
    if (!result.ok) throw new Error(`expected ${source} to compile: ${result.reason}`);
    return result.rule;
}

function matchOf(source: string, text: string, replacement = "x"): PatternMatch {
    const hit = matchPatterns(text, [compiled(source, replacement)], "separator");
    if (!hit) throw new Error(`expected ${source} to match "${text}"`);
    return hit;
}

// ---------------------------------------------------------------------------
// S-015 corpus (ADR-0008, both columns verbatim)
// ---------------------------------------------------------------------------

const MUST_REFUSE: Array<[label: string, source: string]> = [
    ["(a+)+$", src(String.raw`(a+)+$`)],
    ["(a*)*$", src(String.raw`(a*)*$`)],
    ["(a|a)*$", src(String.raw`(a|a)*$`)],
    ["(a|aa)+$", src(String.raw`(a|aa)+$`)],
    ["(\\w+\\s?)+$", src(String.raw`(\w+\s?)+$`)],
    ["(?:a+)+$", src(String.raw`(?:a+)+$`)],
    ["(.*a){20}$", src(String.raw`(.*a){20}$`)],
    ["([a-z]+)*$", src(String.raw`([a-z]+)*$`)],
    ["(a{1,10}){1,10}$", src(String.raw`(a{1,10}){1,10}$`)],
    ["\\w*\\w*\\w*\\w*$", src(String.raw`\w*\w*\w*\w*$`)],
    ["(a)\\1$", src(String.raw`(a)\1$`)],
    ["(?<=x+)y$", src(String.raw`(?<=x+)y$`)],
    ["x(?=y)$", src(String.raw`x(?=y)$`)],
    ["a*$ (empty match)", src(String.raw`a*$`)],
    ["abc (no $)", src("abc")],
    ["/a$/g", "/a$/g"],
    // Round 1 of the checker: escapes depend on the flags. Without `u`, \u{1,} is a letter and a quantifier.
    ["(\\u{1,})+$ (no u: a letter and a quantifier)", src(String.raw`(\u{1,})+$`)],
    ["(\\p{1,})+$", src(String.raw`(\p{1,})+$`)],
    ["(\\P{1,})+$", src(String.raw`(\P{1,})+$`)],
    ["\\u{1,} x4 then x$", src(String.raw`\u{1,}\u{1,}\u{1,}\u{1,}x$`)],
    [".*.*\\c*\\c*x$ (\\c before a non-letter is a backslash)", src(String.raw`.*.*\c*\c*x$`)],
    // Alternation is a choice point: each one multiplies the budget.
    ["(?:a|) x30 then x$", src("(?:a|)".repeat(30) + "x$")],
    ["(a|) x40 then x$", src("(a|)".repeat(40) + "x$")],
    ["(?:a|aa) x24 then x$", src("(?:a|aa)".repeat(24) + "x$")],
    ["(?:a|aa) x20 then $", src("(?:a|aa)".repeat(20) + "$")],
    ["(?:\\w|\\w\\w) x10 then \\w+\\w+x$", src(String.raw`(?:\w|\w\w)`.repeat(10) + String.raw`\w+\w+x$`)],
    ["(?:a|a|a|a|a|a|a|a) x8 then x$", src("(?:a|a|a|a|a|a|a|a)".repeat(8) + "x$")],
    ["(?:a|a) x24 then x$", src("(?:a|a)".repeat(24) + "x$")],
    // A group name written with escapes can hide a reserved one.
    ["(?<\\u0064ate>a)b$ (date)", src(String.raw`(?<\u0064ate>a)b$`)],
];

const MUST_ACCEPT: Array<[label: string, source: string]> = [
    ["(\\d+)\\/(\\d+)$", src(String.raw`(\d+)\/(\d+)$`)],
    ["mtg (\\w+)$", src(String.raw`mtg (\w+)$`)],
    [":(\\w+):$", src(String.raw`:(\w+):$`)],
    ["(?<n>\\d+)x$", src(String.raw`(?<n>\d+)x$`)],
    ["(a|b)$", src(String.raw`(a|b)$`)],
    ["(?:ab)+$", src(String.raw`(?:ab)+$`)],
    ["x\\^(\\d)$", src(String.raw`x\^(\d)$`)],
    ["[+-]?\\d+(?:\\.\\d+)?$", src(String.raw`[+-]?\d+(?:\.\d+)?$`)],
    ["\\:(\\w+)$ (no u)", src(String.raw`\:(\w+)$`)],
    ["(?<= )--$", src(String.raw`(?<= )--$`)],
    ["(foo|bar|baz) (\\w+)$", src(String.raw`(foo|bar|baz) (\w+)$`)],
    ["(?:Mr|Mrs|Ms|Dr)\\.? (\\w+)$", src(String.raw`(?:Mr|Mrs|Ms|Dr)\.? (\w+)$`)],
];

describe("patterns: S-015 corpus", () => {
    it.each(MUST_REFUSE)("refuses %s with a readable reason", (_label, source) => {
        const result = check(source);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reason).toMatch(/^[A-Z]/);
            expect(result.reason.length).toBeGreaterThan(10);
        }
    });

    it.each(MUST_ACCEPT)("accepts %s", (_label, source) => {
        expect(check(source)).toEqual({ ok: true });
    });

    // The reason must name the actual problem, not just "refused".
    it.each([
        [src(String.raw`(a)\1$`), /backreference/i],
        [src(String.raw`x(?=y)$`), /lookahead/i],
        [src(String.raw`(?<=x+)y$`), /lookbehind/i],
        [src(String.raw`(a+)+$`), /repeated group/i],
        [src(String.raw`\w*\w*\w*\w*$`), /unbounded/i],
        [src(String.raw`a*$`), /empty string/i],
        [src("abc"), /end with \$/],
        ["/a$/g", /flag "g"/],
    ])("%s: the reason says why", (source, expected) => {
        const result = check(source);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toMatch(expected);
    });

    // Timing (ADR-0008): accepted patterns run in well under 1 ms here. The bound is loose on purpose (25 ms): it
    // guards orders of magnitude (a backtracking blow-up takes seconds), not a slow or loaded CI machine.
    it("every accepted corpus pattern stays far from a backtracking blow-up on adversarial 64-char strings", () => {
        const adversarial = [
            "a".repeat(64),
            "a".repeat(63) + "!",
            "1".repeat(63) + "x",
            "1/".repeat(32),
            " ".repeat(64),
            "-".repeat(64),
            "ab".repeat(32) + "!",
            ":" + "w".repeat(62) + "!",
            "mtg " + "w".repeat(59) + "!",
            "9".repeat(30) + "." + "9".repeat(32) + "!",
            "Mrs " + "w".repeat(59) + "!",
            "foo " + "b".repeat(59) + "!",
        ];
        const runs = 50;
        for (const [label, source] of MUST_ACCEPT) {
            const { re } = compiled(source);
            for (const text of adversarial) {
                const exec = (): void => {
                    re.lastIndex = 0;
                    re.exec(text);
                };
                for (let i = 0; i < 5; i++) exec(); // warm up
                const start = performance.now();
                for (let i = 0; i < runs; i++) exec();
                const perRun = (performance.now() - start) / runs;
                expect(perRun, `${label} on ${text.slice(0, 12)}...`).toBeLessThan(25);
            }
        }
    });
});

describe("patterns: source format and flags", () => {
    it("takes i and u as written, and does not add u (\\: throws under u)", () => {
        expect(check("/abc$/i")).toEqual({ ok: true });
        expect(check("/abc$/u")).toEqual({ ok: true });
        expect(check("/abc$/iu")).toEqual({ ok: true });
        expect(check(src(String.raw`\:abc$`))).toEqual({ ok: true });
        const withU = check(src(String.raw`\:abc$`, "u"));
        expect(withU.ok).toBe(false);
        expect(compiled(src(String.raw`\:abc$`)).re.flags).toBe("g"); // `g` only for lastIndex (the window's context char), never `u`
    });

    it.each(["g", "y", "m", "s", "d", "v"])("refuses the flag %s", (flag) => {
        const result = check(src("a$", flag));
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toContain(`"${flag}"`);
    });

    it("refuses a repeated flag, a missing slash and an empty body", () => {
        expect(check("/a$/ii").ok).toBe(false);
        expect(check("a$").ok).toBe(false);
        expect(check("/a$").ok).toBe(false);
        expect(check("//").ok).toBe(false);
        expect(check("").ok).toBe(false);
    });

    it("the i flag matches case-insensitively", () => {
        expect(matchPatterns("hello MTG bob", [compiled("/mtg (\\w+)$/i")], "separator")?.captures[1]).toBe("bob");
    });

    it("body over 200 characters is refused, exactly 200 is not", () => {
        const ok = "a".repeat(198) + "$"; // 199
        const edge = "a".repeat(199) + "$"; // 200
        const over = "a".repeat(200) + "$"; // 201
        expect(check(src(ok)).ok).toBe(true);
        expect(check(src(edge)).ok).toBe(true);
        const result = check(src(over));
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toContain("200");
    });

    it("a huge source is refused without being parsed", () => {
        expect(check("/" + "a".repeat(1_000_000) + "$/").ok).toBe(false);
    });

    it("a pattern that does not compile is refused with the engine's message", () => {
        const result = check("/(a$/");
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toMatch(/regular expression|group/i);
        expect(check("/[a$/").ok).toBe(false);
        expect(check("/a)$/").ok).toBe(false);
    });
});

describe("patterns: the checker looks at structure, not at characters", () => {
    it.each(["date", "time", "title", "notedate"])("refuses the reserved group name %s", (name) => {
        const result = check(src(`(?<${name}>\\d+)$`));
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toContain(name);
    });

    it("accepts a group name that only contains a reserved one", () => {
        expect(check(src(String.raw`(?<dateish>\d+)$`)).ok).toBe(true);
    });

    it("an escaped $ is not the end anchor; neither is one inside a class", () => {
        expect(check(src(String.raw`a\$`)).ok).toBe(false);
        expect(check(src(String.raw`a[$]`)).ok).toBe(false);
        expect(check(src(String.raw`a\\$`)).ok).toBe(true); // an escaped backslash, then the anchor
        expect(check(src(String.raw`a\$$`)).ok).toBe(true); // a literal $, then the anchor
    });

    it("a quantifier inside a class or after an escape is not counted", () => {
        // `[+*]` and `\*` hold no quantifier: four of those would be refused if they were counted.
        expect(check(src(String.raw`[+*][+*][+*][+*]\*\+\?$`)).ok).toBe(true);
        expect(check(src(String.raw`(?:[+*]x)+$`)).ok).toBe(true);
    });

    it("refuses an alternation inside a repeated group, at any depth", () => {
        expect(check(src(String.raw`(?:a|b)+$`)).ok).toBe(false);
        expect(check(src(String.raw`(?:x(?:a|b))+$`)).ok).toBe(false);
        expect(check(src(String.raw`(?:a|b){2}$`)).ok).toBe(false);
        // Not repeated: fine, also under `?`.
        expect(check(src(String.raw`(?:a|b)?c$`)).ok).toBe(true);
    });

    it("`?` does not make a group repeatable, `{n,m}` with m > 1 does", () => {
        expect(check(src(String.raw`(a+)?b$`)).ok).toBe(true);
        expect(check(src(String.raw`(a+){1,2}b$`)).ok).toBe(false);
        expect(check(src(String.raw`(a+){0,1}b$`)).ok).toBe(true);
    });

    it("any quantifier inside a repeated group is refused, a fixed {n} too (ADR-0008 wording)", () => {
        expect(check(src(String.raw`(?:\d{2}:){2}\d{2}$`)).ok).toBe(false);
        expect(check(src(String.raw`\d{2}:\d{2}:\d{2}$`)).ok).toBe(true); // the unrolled form
    });

    it("counts unbounded quantifiers across groups: 2 pass, 3 do not", () => {
        expect(check(src(String.raw`\w+\s+$`)).ok).toBe(true);
        expect(check(src(String.raw`\w+\s+\d+$`)).ok).toBe(false);
        expect(check(src(String.raw`(\w+)(\s*)(\d{3,})$`)).ok).toBe(false);
        expect(check(src(String.raw`\w+?\s+?\d+?$`)).ok).toBe(false); // lazy changes nothing
    });

    it("a bounded count that covers the whole window counts as unbounded", () => {
        expect(check(src(String.raw`\w{0,64}\w{0,64}\w{0,64}$`)).ok).toBe(false);
        expect(check(src(String.raw`\w{0,5}\w{0,5}\w{0,5}a$`)).ok).toBe(true);
    });

    // Gap in the ADR (found by the checker pass): `?` and `{n,m}` below 64 are bounded, so "at most 2 unbounded
    // quantifiers" does not limit them, yet overlapping ones backtrack as badly (a?^16 = 21 ms, \w{0,10}^5 = 308 ms).
    it.each([
        ["a? x11", String.raw`a?a?a?a?a?a?a?a?a?a?a?b$`],
        ["a? x20", "a?".repeat(20) + "b$"],
        ["\\w{0,10} x5", String.raw`\w{0,10}\w{0,10}\w{0,10}\w{0,10}\w{0,10}!$`],
        ["\\w{0,3} x6", String.raw`\w{0,3}\w{0,3}\w{0,3}\w{0,3}\w{0,3}\w{0,3}!$`],
        ["a? x5 + \\w+ (1 unbounded, 32 choices)", String.raw`a?a?a?a?a?\w+!$`],
        ["a? x3 + \\w+\\w+ (2 unbounded, 8 choices)", String.raw`a?a?a?\w+\w+!$`],
        ["\\w{0,10} x2 + \\w+\\w+", String.raw`\w{0,10}\w{0,10}\w+\w+!$`],
        ["a{1,32} x3 (a group makes no difference)", String.raw`(?:ab){1,32}(?:cd){1,32}(?:ef){1,32}!$`],
    ])("refuses overlapping bounded quantifiers: %s", (_label, body) => {
        const result = check(src(body));
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toMatch(/optional or ranged/);
    });

    it.each([
        ["a? x10", "a?".repeat(10) + "b$"],
        ["\\w{0,31} x2", String.raw`\w{0,31}\w{0,31}!$`],
        ["\\w{0,3} x5", String.raw`\w{0,3}\w{0,3}\w{0,3}\w{0,3}\w{0,3}!$`],
        ["a? x4 + \\w+ (16)", String.raw`a?a?a?a?\w+!$`],
        ["a? x2 + \\w+\\w+ (4)", String.raw`a?a?\w+\w+!$`],
        ["dates and times", String.raw`(\d{1,2})\/(\d{1,2})\/(\d{2,4})$`],
    ])("accepts at the limit: %s, and it stays far from a blow-up (25 ms bound, see above)", (_label, body) => {
        expect(check(src(body))).toEqual({ ok: true });
        const { re } = compiled(src(body));
        for (const text of ["a".repeat(64), "w".repeat(64), "1/".repeat(32), "a".repeat(63) + "!"]) {
            const exec = (): void => {
                re.lastIndex = 0;
                re.exec(text);
            };
            for (let i = 0; i < 5; i++) exec();
            const start = performance.now();
            for (let i = 0; i < 20; i++) exec();
            expect((performance.now() - start) / 20, `${body} on ${text.slice(0, 8)}`).toBeLessThan(25);
        }
    });

    it("refuses \\k<name> backreferences and \\10-style ones", () => {
        expect(check(src(String.raw`(?<a>x)\k<a>$`)).ok).toBe(false);
        expect(check(src(String.raw`(x)\10$`)).ok).toBe(false);
        expect(check(src(String.raw`\0x$`)).ok).toBe(true); // NUL, not a backreference
    });

    it("refuses negative lookahead and any quantifier in a lookbehind", () => {
        expect(check(src(String.raw`x(?!y)$`)).ok).toBe(false);
        expect(check(src(String.raw`(?<!x?)y$`)).ok).toBe(false);
        expect(check(src(String.raw`(?<=a|b)y$`)).ok).toBe(true);
        expect(check(src(String.raw`(?<!x)y$`)).ok).toBe(true);
    });

    it("refuses every way to match the empty string", () => {
        for (const body of [String.raw`a?$`, String.raw`(a|)$`, String.raw`\b$`, String.raw`(?<= )$`, String.raw`(?:a*b?)$`, "$"]) {
            expect(check(src(body)).ok, body).toBe(false);
        }
        expect(check(src(String.raw`a?b$`)).ok).toBe(true);
    });

    it("handles \\p{...}, \\u{...} and \\xHH without losing its place", () => {
        expect(check(src(String.raw`\p{L}+x$`, "u")).ok).toBe(true);
        expect(check(src(String.raw`\u{1F600}x$`, "u")).ok).toBe(true);
        expect(check(src(String.raw`\x41B\cJ$`)).ok).toBe(true);
    });

    it("refuses syntax it does not understand rather than guessing", () => {
        expect(check(src(String.raw`(?i:a)b$`)).ok).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// The gate and the rule list
// ---------------------------------------------------------------------------

describe("patterns: one gate, no bypass (S-009 lesson)", () => {
    it("a refused source never yields a rule, whatever the rest of the rule says", () => {
        for (const [, source] of MUST_REFUSE) {
            const result = compileRule(rule(source));
            expect(result.ok, source).toBe(false);
        }
    });

    it("compileRule takes anything data.json can hold", () => {
        for (const junk of [null, undefined, 42, "x", [], {}, { id: "a" }, { id: "a", source: 1 }, { id: "a", source: "/a$/", replacement: 5 }]) {
            expect(compileRule(junk).ok, JSON.stringify(junk)).toBe(false);
        }
        expect(compileRule({ id: "", source: "/a$/", replacement: "x" }).ok).toBe(false);
        expect(compileRule({ id: "a", source: "/a$/", replacement: "x", mode: "later" }).ok).toBe(false);
        expect(compileRule({ id: "a", source: "/a$/", replacement: "x", group: 3 }).ok).toBe(false);
    });

    it("a missing mode defaults to instant (the ADR default)", () => {
        const result = compileRule({ id: "a", source: "/a$/", replacement: "x" });
        expect(result.ok && result.rule.mode).toBe("instant");
    });

    it("the replacement is capped at 10 000 characters", () => {
        expect(compileRule(rule("/a$/", "x".repeat(MAX_PATTERN_REPLACEMENT))).ok).toBe(true);
        const over = compileRule(rule("/a$/", "x".repeat(MAX_PATTERN_REPLACEMENT + 1)));
        expect(over.ok).toBe(false);
    });

    it("an own property is read, an inherited one is not (S-004/S-008 style)", () => {
        const polluted = Object.create({ id: "a", source: "/a$/", replacement: "x" }) as object;
        expect(compileRule(polluted).ok).toBe(false);
    });

    it("compiles a source once: rules with the same source share the RegExp", () => {
        const a = compiled("/same(\\d)$/");
        const b = compiled("/same(\\d)$/");
        expect(a.re).toBe(b.re);
        expect(compiled("/other(\\d)$/").re).not.toBe(a.re);
    });

    it("matching never compiles: the hot path only runs the stored RegExp", () => {
        const original = globalThis.RegExp;
        const spy = vi.fn((...args: ConstructorParameters<typeof RegExp>) => new original(...args));
        const r = compiled("/hot(\\d)$/");
        // Anything that built a RegExp now would be seen through this stand-in.
        vi.stubGlobal("RegExp", spy);
        try {
            expect(matchPatterns("a hot1", [r], "separator")).not.toBeNull();
        } finally {
            vi.unstubAllGlobals();
        }
        expect(spy).not.toHaveBeenCalled();
    });
});

describe("patterns: compilePatternRules", () => {
    it("a failing rule is disabled alone, with its reason; the others keep working", () => {
        const set = compilePatternRules([
            rule("/a(\\d)$/", "A", { id: "good1" }),
            rule(src(String.raw`(a+)+$`), "B", { id: "bad" }),
            rule("/b(\\d)$/", "C", { id: "good2" }),
        ]);
        expect(set.rules.map((r) => r.id)).toEqual(["good1", "good2"]);
        expect(set.errors).toHaveLength(1);
        expect(set.errors[0]).toMatchObject({ id: "bad" });
        expect(set.errors[0]?.reason).toMatch(/repeated group/i);
    });

    it("skips rules that are switched off, without compiling them or reporting them", () => {
        const set = compilePatternRules([
            rule(src(String.raw`(a+)+$`), "x", { id: "off", enabled: false }),
            rule("/a$/", "x", { id: "on" }),
        ]);
        expect(set.rules.map((r) => r.id)).toEqual(["on"]);
        expect(set.errors).toEqual([]);
    });

    it("an enabled flag that is not exactly true leaves the rule off", () => {
        expect(compilePatternRules([{ id: "a", source: "/a$/", replacement: "x" }]).rules).toEqual([]);
        expect(compilePatternRules([{ id: "a", source: "/a$/", replacement: "x", enabled: "yes" }]).rules).toEqual([]);
    });

    it("skips rules of a disabled group, keeps ungrouped and other groups", () => {
        const set = compilePatternRules(
            [
                rule("/a$/", "x", { id: "g1", group: "off" }),
                rule("/b$/", "x", { id: "g2", group: "on" }),
                rule("/c$/", "x", { id: "g3" }),
            ],
            ["off"],
        );
        expect(set.rules.map((r) => r.id)).toEqual(["g2", "g3"]);
    });

    it("uses only the first 100 rules and names the rest", () => {
        const many = Array.from({ length: 103 }, (_, i) => rule(`/k${i}$/`, "x", { id: `r${i}` }));
        const set = compilePatternRules(many);
        expect(set.rules).toHaveLength(100);
        expect(set.errors.map((e) => e.id)).toEqual(["r100"]);
        expect(set.errors[0]?.reason).toContain("100");
        expect(set.errors[0]?.reason).toContain("3 more");
    });

    it("a huge list is cut at 100 with one error, not one per rule", () => {
        const many = Array.from({ length: 5000 }, (_, i) => rule(`/k${i % 90}$/`, "x", { id: `r${i}` }));
        const set = compilePatternRules(many);
        expect(set.rules).toHaveLength(100);
        expect(set.errors).toHaveLength(1);
    });

    it("exactly 100 rules all work", () => {
        const many = Array.from({ length: 100 }, (_, i) => rule(`/k${i}$/`, "x", { id: `r${i}` }));
        const set = compilePatternRules(many);
        expect(set.rules).toHaveLength(100);
        expect(set.errors).toEqual([]);
    });

    it("garbage input gives no rules and no crash", () => {
        for (const junk of [undefined, null, "rules", 5, {}, []]) {
            expect(compilePatternRules(junk)).toBe(NO_PATTERNS);
        }
        const set = compilePatternRules([null, 7, "x", rule("/a$/", "x", { id: "ok" })]);
        expect(set.rules.map((r) => r.id)).toEqual(["ok"]);
        expect(set.errors.map((e) => e.id)).toEqual(["#1", "#2", "#3"]);
    });

    it("reports which modes are present", () => {
        const both = compilePatternRules([rule("/a$/", "x", { id: "i" }), rule("/b$/", "x", { id: "s", mode: "separator" })]);
        expect(both.hasInstant && both.hasSeparator).toBe(true);
        const instantOnly = compilePatternRules([rule("/a$/")]);
        expect(instantOnly.hasInstant).toBe(true);
        expect(instantOnly.hasSeparator).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

describe("patterns: matchPatterns", () => {
    it("returns the start, numbered captures and named captures of a match", () => {
        const m = matchOf(String.raw`/(\d+)\/(?<den>\d+)$/`, "so 1/23");
        expect(m.index).toBe(3);
        expect(m.captures).toEqual(["1/23", "1", "23"]);
        expect(m.named.get("den")).toBe("23");
    });

    it("a group that did not take part is undefined", () => {
        const m = matchOf(String.raw`/a(b)?c(?<n>d)?$/`, "ac");
        expect(m.captures).toEqual(["ac", undefined, undefined]);
        expect(m.named.has("n")).toBe(true);
        expect(m.named.get("n")).toBeUndefined();
    });

    it("the first enabled rule in list order wins", () => {
        const first = compiled("/x(\\d)$/", "first");
        const second = { ...compiled("/\\d$/", "second"), id: "r2" };
        expect(matchPatterns("x1", [first, second], "separator")?.rule.replacement).toBe("first");
        expect(matchPatterns("x1", [second, first], "separator")?.rule.replacement).toBe("second");
    });

    it("only rules of the asked mode are tried", () => {
        const instant = compiled("/a$/", "i", "instant");
        const separator = compiled("/a$/", "s", "separator");
        expect(matchPatterns("a", [instant, separator], "separator")?.rule.replacement).toBe("s");
        expect(matchPatterns("a", [separator, instant], "instant")?.rule.replacement).toBe("i");
        expect(matchPatterns("a", [instant], "separator")).toBeNull();
    });

    it("the match must end at the end of the text (cat|dog$ does not take `cat xyz`)", () => {
        const r = compiled("/cat|dog$/", "x");
        expect(matchPatterns("cat xyz", [r], "separator")).toBeNull();
        expect(matchPatterns("a cat", [r], "separator")?.index).toBe(2); // every alternative is anchored
        expect(matchPatterns("a dog", [r], "separator")?.index).toBe(2);
    });

    it("the end check does not rely on the pattern: a rule whose RegExp has no $ still cannot match mid-text", () => {
        // Hand-built stand-in for a bug in the wrap: `index + length === tail.length` alone must stop it.
        const loose: CompiledRule = { ...compiled("/cat$/"), re: /cat/ };
        expect(matchPatterns("cat xyz", [loose], "separator")).toBeNull();
        expect(matchPatterns("a cat", [loose], "separator")?.index).toBe(2);
        const empty: CompiledRule = { ...compiled("/cat$/"), re: /x*/ };
        expect(matchPatterns("abc", [empty], "separator")).toBeNull();
    });

    it("does not match when the text only ends with part of the pattern's reach", () => {
        const r = compiled("/(\\d+)\\/(\\d+)$/");
        expect(matchPatterns("1/2 and", [r], "separator")).toBeNull();
        expect(matchPatterns("1/2", [r], "separator")).not.toBeNull();
    });

    it("looks only at the last 64 characters and reports the start in the whole text", () => {
        const long = "z".repeat(200) + " mtg Bob";
        const m = matchPatterns(long, [compiled("/mtg (\\w+)$/")], "separator");
        expect(m?.index).toBe(201);
        expect(m?.captures[1]).toBe("Bob");
        // A match that starts more than 64 characters back is out of reach.
        const far = "mtg " + "w".repeat(80);
        expect(matchPatterns(far, [compiled("/mtg (\\w+)$/")], "separator")).toBeNull();
        // 64 exactly is in reach, 65 is not.
        expect(matchPatterns("x" + "w".repeat(63), [compiled("/x(\\w+)$/")], "separator")).not.toBeNull();
        expect(matchPatterns("x" + "w".repeat(64), [compiled("/x(\\w+)$/")], "separator")).toBeNull();
    });

    it("^ means line start: a window cut from a longer line cannot say, so such rules are skipped", () => {
        const r = compiled("/^-- $/");
        expect(matchPatterns("-- ", [r], "separator")?.index).toBe(0);
        expect(matchPatterns("x".repeat(70) + "-- ", [r], "separator")).toBeNull();
        expect(matchPatterns("a-- ", [r], "separator")).toBeNull();
    });

    it("lookbehind sees the context inside the window", () => {
        const r = compiled(String.raw`/(?<= )--$/`, "—");
        expect(matchPatterns("a --", [r], "separator")?.index).toBe(2);
        expect(matchPatterns("a--", [r], "separator")).toBeNull();
    });

    it("no rules, no text, no match", () => {
        expect(matchPatterns("abc", [], "separator")).toBeNull();
        expect(matchPatterns("", [compiled("/a$/")], "separator")).toBeNull();
    });

    it("keeps working when the same rule list is used again (no lastIndex state)", () => {
        const r = compiled("/a(\\d)$/");
        for (let i = 0; i < 4; i++) expect(matchPatterns("a1", [r], "separator")).not.toBeNull();
    });

    it("an astral character at the cut does not break the match", () => {
        const text = "😀".repeat(40) + "x1";
        expect(matchPatterns(text, [compiled("/x(\\d)$/")], "separator")?.captures[1]).toBe("1");
    });
});

// ---------------------------------------------------------------------------
// Replacement
// ---------------------------------------------------------------------------

describe("patterns: replacement", () => {
    const apply = (source: string, text: string, replacement: string, c: ExpandContext = ctx) =>
        applyPatternReplacement(matchOf(source, text, replacement), c);

    it("{{0}} is the whole match, {{1}}..{{9}} the numbered groups, {{name}} the named ones", async () => {
        const out = await apply(String.raw`/(\d+)\/(?<den>\d+)$/`, "1/23", "[{{0}}|{{1}}|{{2}}|{{den}}]");
        expect(out.text).toBe("[1/23|1|23|23]");
    });

    it("a group that did not take part gives an empty string", async () => {
        const out = await apply(String.raw`/a(b)?c(?<n>d)?$/`, "ac", "<{{1}}{{n}}{{0}}>");
        expect(out.text).toBe("<ac>");
    });

    it("a number with no such group is empty, a name with no such group stays literal", async () => {
        const out = await apply("/a(b)$/", "ab", "{{5}}|{{nope}}|{{10}}|{{ 1 }}");
        expect(out.text).toBe("|{{nope}}|{{10}}|{{ 1 }}");
    });

    it("the same capture can be used several times", async () => {
        const out = await apply("/x(\\d)$/", "x7", "{{1}}+{{1}}={{1}}{{1}}");
        expect(out.text).toBe("7+7=77");
    });

    it("a replacement with no capture refs is the plain pipeline (cursor included)", async () => {
        const out = await apply("/fn$/", "fn", "function $|() {}");
        expect(out.text).toBe("function () {}");
        expect(out.cursorDelta).toBe("function ".length);
    });

    // ---- the sentinel rules: red tests of ADR-0008 ----

    it("a capture before $| puts the caret after the captured text", async () => {
        const out = await apply("/mtg (\\w+)$/", "mtg Bob", "Meeting with {{1}}: $|");
        expect(out.text).toBe("Meeting with Bob: ");
        expect(out.cursorDelta).toBe("Meeting with Bob: ".length);
    });

    it("a capture before $1 and $2 shifts every field offset and the final stop", async () => {
        const out = await apply("/mtg (\\w+)$/", "mtg Alexander", "Meeting with {{1}} at $1 about $2.$|");
        const text = "Meeting with Alexander at  about .";
        expect(out.text).toBe(text);
        expect(out.fields).toEqual([text.indexOf("at ") + 3, text.indexOf("about ") + 6]);
        expect(out.finalDelta).toBe(text.length);
        expect(out.cursorDelta).toBe(text.length);
    });

    it("fields written before the capture keep their offsets, the ones after it move", async () => {
        const out = await apply("/x(\\d{3})$/", "x123", "$1-{{1}}-$2");
        expect(out.text).toBe("-123-");
        expect(out.fields).toEqual([0, "-123-".length]);
    });

    it("a capture right at a field offset: the field sits before the captured text", async () => {
        const out = await apply("/x(\\d{3})$/", "x123", "A $1{{1}}$2");
        expect(out.text).toBe("A 123");
        expect(out.fields).toEqual([2, 5]);
    });

    it("keeps the visit order and docOrder of the fields", async () => {
        const out = await apply("/x(\\d)$/", "x9", "{{1}} $2 $1");
        expect(out.text).toBe("9  ");
        expect(out.fields).toEqual([3, 2]);
        expect(out.docOrder).toEqual([1, 0]);
    });

    it("a single $1 is the caret, shifted by the capture", async () => {
        const out = await apply("/x(\\d)$/", "x9", "[{{1}}$1]");
        expect(out.text).toBe("[9]");
        expect(out.cursorDelta).toBe(2);
        expect(out.fields).toBeUndefined();
    });

    it("a captured $1 is text, not a field (and a real $1 next to it still is)", async () => {
        const out = await apply("/x(\\S+)$/", "x$1", "{{1}} $1 $2");
        expect(out.text).toBe("$1  ");
        expect(out.fields).toEqual(["$1 ".length, "$1  ".length]);
    });

    it("a captured $| , $clipboard, $date and {{date}} stay literal", async () => {
        const clipboard = vi.fn(async () => "CLIP");
        const withClip: ExpandContext = { ...ctx, readClipboard: clipboard };
        for (const captured of ["$|", "$clipboard", "$date", "$time", "{{date}}", "{{date:YYYY}}", "$filename", "\\$1"]) {
            const out = await apply("/x(\\S+)$/", `x${captured}`, "<{{1}}>", withClip);
            expect(out.text, captured).toBe(`<${captured}>`);
            expect(out.cursorDelta, captured).toBeUndefined();
            expect(out.fields, captured).toBeUndefined();
        }
        expect(clipboard).not.toHaveBeenCalled();
    });

    it("variables in the replacement itself still work around a capture", async () => {
        const out = await apply("/x(\\d)$/", "x5", "{{1}} on $date at $time ({{date}})");
        expect(out.text).toBe("5 on 2025-09-02 at 10:11 (2025-09-02)");
    });

    it("{{date}} is the date, not a group (the name is reserved)", async () => {
        const out = await apply("/x(\\d)$/", "x5", "{{date}} {{1}}");
        expect(out.text).toBe("2025-09-02 5");
    });

    it("a capture written next to a variable does not change how the variable reads", async () => {
        const out = await apply("/x(\\d)$/", "x5", "$date{{1}}$time{{1}}");
        expect(out.text).toBe("2025-09-02" + "5" + "10:11" + "5");
    });

    it("multi-line captures and replacements keep offsets in characters", async () => {
        const out = await apply("/x(\\S+)$/", "xabc", "{{1}}\n{{1}}\n$1 $2");
        expect(out.text).toBe("abc\nabc\n ");
        expect(out.fields).toEqual([8, 9]);
    });

    it("a replacement that already holds the sentinel characters is not misread", async () => {
        const out = await apply("/x(\\d)$/", "x7", "|{{1}}|");
        expect(out.text).toBe("|7|");
        // Four refs use four sentinels; a replacement that holds U+E100 and U+E103 shifts the range.
        const many = await apply("/x(\\d)(\\d)?(?<n>\\d)?$/", "x123", "\uE100{{0}}{{1}}{{2}}{{n}}\uE103");
        expect(many.text).toBe("\uE100x123123\uE103");
    });

    it("a clipboard or file name holding the sentinel character cannot forge a capture", async () => {
        // With one ref the sentinel is U+E100.
        const hostile: ExpandContext = { ...ctx, filename: "ab.md", readClipboard: async () => "cd" };
        const out = await apply("/x(\\d)$/", "x7", "{{1}}|$filename|$clipboard", hostile);
        expect(out.text).toBe("7|ab.md|cd");
    });

    it("{{date:FMT}} output holding the sentinel character cannot forge a capture", async () => {
        const hostile: ExpandContext = { ...ctx, formatDate: () => "" };
        const out = await apply("/x(\\d)$/", "x7", "{{1}}{{date:ZZ}}", hostile);
        expect(out.text).toBe("7");
    });
});

// ---------------------------------------------------------------------------
// Checker round 1 (ADR-0008 amendments)
// ---------------------------------------------------------------------------

describe("patterns: escapes are read by the flags (S-015)", () => {
    // Without `u`, \u{1,} / \p{1,} / \P{1,} are one letter and the quantifier {1,}. The parser used to swallow them as
    // one atom, so a pattern with real nested quantifiers looked harmless (and hung `exec` for seconds).
    it.each([
        ["\\u{1,}", String.raw`(\u{1,})+$`],
        ["\\p{1,}", String.raw`(\p{1,})+$`],
        ["\\P{1,}", String.raw`(\P{1,})+$`],
    ])("%s without u is a letter and a quantifier: a repeated group around it is refused", (_label, body) => {
        const result = check(src(body));
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toMatch(/repeated group/i);
    });

    it("counts the quantifier of \\u{1,} without u, so four of them hit the cap of two", () => {
        expect(check(src(String.raw`\u{1,}\u{1,}x$`))).toEqual({ ok: true });
        const three = check(src(String.raw`\u{1,}\u{1,}\u{1,}x$`));
        expect(three.ok).toBe(false);
        if (!three.ok) expect(three.reason).toMatch(/unbounded/);
    });

    it("under u the same text is a brace escape: one atom, not a quantifier", () => {
        // \u{1F600} and \p{L} are single atoms, so three of them with a quantifier each are 3 unbounded, but the
        // braces add none.
        expect(check(src(String.raw`\u{1F600}\u{1F600}\u{1F600}\u{1F600}x$`, "u"))).toEqual({ ok: true });
        expect(check(src(String.raw`(\p{L}+)+$`, "u")).ok).toBe(false);
        expect(check(src(String.raw`(\p{L}\p{L})+$`, "u"))).toEqual({ ok: true }); // the braces are no quantifier
        expect(check(src(String.raw`\p{L}+\p{L}+\p{L}+$`, "u")).ok).toBe(false);
        expect(check(src(String.raw`\p{L}+\p{L}+x$`, "u"))).toEqual({ ok: true });
    });

    it("\\uHHHH and \\xHH are one atom only when all their hex digits are there", () => {
        expect(check(src(String.raw`\u0041+\x41+$`))).toEqual({ ok: true });
        // `\u12` is `u`, `1`, `2` without u: the {3,} belongs to `2`, and there are three unbounded quantifiers.
        expect(check(src(String.raw`\u12{3,}\w+\s+$`)).ok).toBe(false);
    });

    it("\\c takes the next character only when it is an ASCII letter", () => {
        // `\cJ` is one atom: two unbounded quantifiers.
        expect(check(src(String.raw`\cJ+\cJ+x$`))).toEqual({ ok: true });
        // `\c` before a non-letter is a literal backslash, and `c` is its own atom: four real unbounded quantifiers.
        const four = check(src(String.raw`.*.*\c*\c*x$`));
        expect(four.ok).toBe(false);
        if (!four.ok) expect(four.reason).toMatch(/unbounded/);
        expect(check(src(String.raw`\c1+\c1+\c1+$`)).ok).toBe(false);
    });

    it("a group name written with an escape is refused (it can hide a reserved one)", () => {
        for (const body of [String.raw`(?<\u0064ate>a)b$`, String.raw`(?<d\u{61}te>a)b$`, String.raw`(?<na\u006de>a)b$`]) {
            const result = check(src(body));
            expect(result.ok, body).toBe(false);
            if (!result.ok) expect(result.reason, body).toMatch(/group name/i);
        }
        expect(check(src(String.raw`(?<name>a)b$`))).toEqual({ ok: true });
    });
});

describe("patterns: alternation is a choice point (S-015)", () => {
    it("a group with k alternatives multiplies the budget by k", () => {
        // 1 unbounded allows 16: four 2-way groups are 16, five are 32.
        expect(check(src(String.raw`(?:a|b)(?:c|d)(?:e|f)(?:g|h)\w+x$`))).toEqual({ ok: true });
        const five = check(src(String.raw`(?:a|b)(?:c|d)(?:e|f)(?:g|h)(?:i|j)\w+x$`));
        expect(five.ok).toBe(false);
        if (!five.ok) expect(five.reason).toMatch(/optional or ranged/);
    });

    it("an empty alternative counts like any other", () => {
        expect(check(src("(?:a|)".repeat(10) + "x$"))).toEqual({ ok: true }); // 1024: the limit
        expect(check(src("(?:a|)".repeat(11) + "x$")).ok).toBe(false);
    });

    it("alternation under ? multiplies too", () => {
        expect(check(src(String.raw`(?:a|b|c)?\w+x$`))).toEqual({ ok: true }); // 3 * 2 = 6 <= 16
        expect(check(src(String.raw`(?:a|b|c)?(?:d|e|f)?\w+x$`)).ok).toBe(false); // 36 > 16
    });

    it("a single alternative, or a top-level alternation, adds no choice of its own", () => {
        expect(check(src("(a)".repeat(40) + "x$"))).toEqual({ ok: true });
        expect(check(src(String.raw`cat|dog|bird|fish|mouse|horse$`))).toEqual({ ok: true });
    });
});

describe("patterns: instant rules are stricter (owner, 2026-11-18)", () => {
    it.each([
        [String.raw`\w+\s+$`],
        [String.raw`(\d+)\/(\d+)$`],
        [String.raw`[+-]?\d+(?:\.\d+)?$`],
        [String.raw`\w+x\w*$`],
    ])("%s: two unbounded quantifiers pass for a separator rule and are refused for an instant one", (body) => {
        expect(check(src(body), "separator")).toEqual({ ok: true });
        const result = check(src(body), "instant");
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toMatch(/at most 1 unbounded/i);
        if (!result.ok) expect(result.reason).toContain("After a separator");
    });

    it("one unbounded quantifier is fine for an instant rule, and so are bounded ones", () => {
        for (const body of [String.raw`\w+x$`, "-->$", "<<$", String.raw`mtg (\w+)$`, String.raw`(\d{1,2})x$`, String.raw`(?:ab)+$`]) {
            expect(check(src(body), "instant"), body).toEqual({ ok: true });
        }
    });

    it("the source is cached once, but the mode limit is applied every time (no cross-mode leak)", () => {
        const body = String.raw`\d+\s+q9$`;
        expect(check(src(body), "separator")).toEqual({ ok: true });
        expect(check(src(body), "instant").ok).toBe(false);
        expect(check(src(body), "separator")).toEqual({ ok: true });
        const body2 = String.raw`\d+\s+q8$`;
        expect(check(src(body2), "instant").ok).toBe(false); // refused first
        expect(check(src(body2), "separator")).toEqual({ ok: true });
    });

    it("compileRule applies the rule's own mode, and a missing mode is instant", () => {
        const body = src(String.raw`(\d+)\/(\d+)$`);
        const instant = compileRule(rule(body, "x", { mode: "instant" }));
        expect(instant.ok).toBe(false);
        if (!instant.ok) expect(instant.reason).toContain("After a separator");
        expect(compileRule(rule(body, "x", { mode: "separator" })).ok).toBe(true);
        expect(compileRule({ id: "a", source: body, replacement: "x" }).ok).toBe(false);
    });

    it("compilePatternRules disables the instant rule alone and names the way out", () => {
        const set = compilePatternRules([
            rule(src(String.raw`(\d+)\/(\d+)$`), "x", { id: "frac", mode: "instant" }),
            rule(src(String.raw`(\d+)\/(\d+)$`), "x", { id: "frac2", mode: "separator" }),
            rule("/-->$/", "x", { id: "arrow", mode: "instant" }),
        ]);
        expect(set.rules.map((r) => r.id)).toEqual(["frac2", "arrow"]);
        expect(set.errors).toHaveLength(1);
        expect(set.errors[0]).toMatchObject({ id: "frac" });
        expect(set.errors[0]?.reason).toContain("After a separator");
    });
});

describe("patterns: canEndWith (which typed characters can end a match)", () => {
    const can = (body: string, ch: string, flags = ""): boolean => canEndWith(compiled(src(body, flags)), ch);

    it.each([
        ["-->$", ">", true],
        ["-->$", "-", false],
        ["-->$", "x", false],
        [String.raw`(\d+)\/(\d+)$`, "5", true],
        [String.raw`(\d+)\/(\d+)$`, "/", false],
        [String.raw`(\d+)\/(\d+)$`, "a", false],
        [String.raw`\.\.\.$`, ".", true],
        [String.raw`\.\.\.$`, "x", false],
        [String.raw`[^a]$`, "b", true],
        [String.raw`[^a]$`, "a", false],
        [String.raw`mtg (\w+)$`, "_", true],
        [String.raw`mtg (\w+)$`, " ", false],
        [String.raw`x\^(\d)$`, "7", true],
        [String.raw`x\^(\d)$`, "x", false],
        [String.raw`(?<= )--$`, "-", true],
        [String.raw`(?<= )--$`, " ", false],
        [String.raw`hello\b$`, "o", true],
        [String.raw`hello\b$`, "h", false],
    ])("/%s/ ends with %j: %s", (body, ch, expected) => {
        expect(can(body, ch)).toBe(expected);
    });

    it("an optional last atom lets the one before it end the match too", () => {
        expect(can(String.raw`a(b)?$`, "a")).toBe(true);
        expect(can(String.raw`a(b)?$`, "b")).toBe(true);
        expect(can(String.raw`a(b)?$`, "c")).toBe(false);
        expect(can(String.raw`ab?c?$`, "a")).toBe(true);
        expect(can(String.raw`ab?c?$`, "d")).toBe(false);
    });

    it("alternation is the union of its branches, an empty branch passes the question on", () => {
        expect(can("foo|bar$", "o")).toBe(true);
        expect(can("foo|bar$", "r")).toBe(true);
        expect(can("foo|bar$", "f")).toBe(false);
        expect(can(String.raw`x(?:a|b)$`, "b")).toBe(true);
        expect(can(String.raw`x(?:a|b)$`, "x")).toBe(false);
        expect(can(String.raw`x(?:a|)$`, "x")).toBe(true);
        expect(can(String.raw`x(?:a|)$`, "a")).toBe(true);
        expect(can(String.raw`x(?:a|)$`, "q")).toBe(false);
    });

    it("a repeated or optional group ends with whatever its last atoms end with", () => {
        expect(can(String.raw`(?:ab)+$`, "b")).toBe(true);
        expect(can(String.raw`(?:ab)+$`, "a")).toBe(false);
        expect(can(String.raw`x(?:yz)?$`, "z")).toBe(true);
        expect(can(String.raw`x(?:yz)?$`, "x")).toBe(true);
        expect(can(String.raw`x(?:yz)?$`, "y")).toBe(false);
    });

    it("follows the flags: i folds case, u reads \\p{...}", () => {
        expect(can("ABC$", "c", "i")).toBe(true);
        expect(can("ABC$", "C", "i")).toBe(true);
        expect(can("ABC$", "c")).toBe(false);
        expect(can(String.raw`\p{L}$`, "é", "u")).toBe(true);
        expect(can(String.raw`\p{L}$`, "1", "u")).toBe(false);
    });

    it("a rule with no end set answers yes (not computable means any)", () => {
        expect(canEndWith({ ...compiled("/a$/"), endTest: null }, "z")).toBe(true);
    });

    it("matchPatterns does not run an instant rule whose end set excludes the typed character", () => {
        const re = /-->$/g;
        const exec = vi.spyOn(re, "exec");
        const r: CompiledRule = { ...compiled("/-->$/", "x", "instant"), re };
        expect(matchPatterns("a-x", [r], "instant")).toBeNull();
        expect(exec).not.toHaveBeenCalled();
        expect(matchPatterns("a-->", [r], "instant")?.index).toBe(1);
        expect(exec).toHaveBeenCalledTimes(1);
    });

    it("a separator rule is tried whatever the last character is (it is not typed at the caret)", () => {
        const re = /(\d+)$/g;
        const exec = vi.spyOn(re, "exec");
        const r: CompiledRule = { ...compiled(String.raw`/(\d+)$/`, "x", "separator"), re };
        matchPatterns("ab", [r], "separator");
        expect(exec).toHaveBeenCalledTimes(1);
    });
});

describe("patterns: one order for all rules", () => {
    const dots = compiled(String.raw`/\.\.\.$/`, "…", "instant");
    const bracket = { ...compiled(String.raw`/(\w+)\.\.$/`, "[{{1}}]", "separator"), id: "b" };

    it("rules are tried top to bottom whatever their mode, the first match wins", () => {
        const texts = { atCaret: "foo...", beforeSeparator: "foo.." };
        expect(matchPatternsInOrder(texts, [dots, bracket])?.rule.replacement).toBe("…");
        expect(matchPatternsInOrder(texts, [bracket, dots])?.rule.replacement).toBe("[{{1}}]");
    });

    it("an instant rule reads the tail ending at the caret, a separator rule the tail before the separator", () => {
        const hit = matchPatternsInOrder({ atCaret: "foo...", beforeSeparator: "foo.." }, [dots]);
        expect(hit).toMatchObject({ index: 3, end: 6 });
        const sep = matchPatternsInOrder({ atCaret: "foo...", beforeSeparator: "foo.." }, [bracket]);
        expect(sep).toMatchObject({ index: 0, end: 5 });
        expect(sep?.captures[1]).toBe("foo");
    });

    it("without a separator typed only instant rules run, without a caret text only separator rules", () => {
        expect(matchPatternsInOrder({ atCaret: "foo..." }, [bracket, dots])?.rule.replacement).toBe("…");
        expect(matchPatternsInOrder({ atCaret: "foo.." }, [bracket])).toBeNull();
        expect(matchPatternsInOrder({ beforeSeparator: "foo..." }, [dots])).toBeNull();
        expect(matchPatternsInOrder({}, [dots, bracket])).toBeNull();
    });

    it("a rule that does not match falls through to the next one, in any order", () => {
        const arrow = compiled("/-->$/", "→", "instant");
        expect(matchPatternsInOrder({ atCaret: "a -->", beforeSeparator: "a --" }, [dots, bracket, arrow])?.rule.replacement).toBe("→");
    });

    it("matchPatterns reports where the match ends", () => {
        expect(matchPatterns("see 1/2", [compiled(String.raw`/(\d+)\/(\d+)$/`)], "separator")).toMatchObject({ index: 4, end: 7 });
    });
});

describe("patterns: the window keeps one character of context", () => {
    it("a lookbehind sees the character before a cut window, not a false line start", () => {
        const r = compiled(String.raw`/(?<!k)(y{63});$/`);
        expect(matchPatterns("k" + "y".repeat(63) + ";", [r], "separator")).toBeNull();
        // The control: the same line with another letter in front does match, from the window start.
        expect(matchPatterns("j" + "y".repeat(63) + ";", [r], "separator")?.index).toBe(1);
    });

    it("\\b does not see a false start: a word cut by the window is not replaced", () => {
        const r = compiled(String.raw`/\b(\w+);$/`);
        expect(matchPatterns("w".repeat(70) + ";", [r], "separator")).toBeNull();
        expect(matchPatterns("x ".repeat(5) + "w".repeat(10) + ";", [r], "separator")?.captures[1]).toBe("w".repeat(10));
        // A word that fits in the window, whatever precedes it, still matches.
        expect(matchPatterns("w".repeat(70) + " " + "v".repeat(5) + ";", [r], "separator")?.captures[1]).toBe("vvvvv");
    });

    it("a match may still start at the first character of the window", () => {
        expect(matchPatterns("z" + "y".repeat(63), [compiled("/(y{63})$/")], "separator")?.index).toBe(1);
        // 64 characters long and the whole line: nothing is cut, `^` works.
        expect(matchPatterns("a".repeat(64), [compiled("/^a{64}$/")], "separator")?.index).toBe(0);
    });

    it("a match cannot start before the window (the context character is only for looking)", () => {
        // 65 characters: the pattern needs all 65, which is out of reach, even though the context char is there.
        expect(matchPatterns("a".repeat(65), [compiled("/a{65}$/")], "separator")).toBeNull();
    });
});

describe("patterns: deviations from plain RegExp stay pinned", () => {
    it("/cat|dog$/ on `cat cat` takes the second cat (the (?:...)$ wrap)", () => {
        const m = matchPatterns("cat cat", [compiled("/cat|dog$/")], "separator");
        expect(m?.index).toBe(4);
        expect(m?.end).toBe(7);
    });

    it("/^.*abc$/ does not match a line the window cut, but does match a line that fits", () => {
        const r = compiled("/^.*abc$/");
        expect(matchPatterns("x".repeat(70) + "abc", [r], "separator")).toBeNull();
        expect(matchPatterns("x".repeat(10) + "abc", [r], "separator")?.index).toBe(0);
    });

    it("^ inside a lookbehind cannot see the false start of a cut window either", () => {
        const r = compiled(String.raw`/(?<=^x)y+$/`);
        // The window's context character is an `x` at what looks like the line start.
        expect(matchPatterns("q".repeat(4) + "x" + "y".repeat(64), [r], "separator")).toBeNull();
        expect(matchPatterns("xyy", [r], "separator")?.index).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// The net under the corpus: random accepted patterns must not be able to hang
// ---------------------------------------------------------------------------

/**
 * Why this shape: a JS `exec` cannot be interrupted from the same thread, so a test that runs a hanging pattern
 * hangs the suite. `node:vm` with `timeout` runs the script under a watchdog that terminates it (irregexp checks
 * for the interrupt while it backtracks), so a pattern the gate wrongly accepts shows up as a failing test after
 * one second, not as a stuck run. No child process, no worker, no flaky kill timers; the generator is seeded, so
 * a failure names a pattern that reproduces.
 */
describe("patterns: no accepted pattern can hang (seeded, randomized)", () => {
    function mulberry32(seed: number): () => number {
        let a = seed;
        return () => {
            a = (a + 0x6d2b79f5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    const ATOMS = ["a", "b", "x", "u", "c", String.raw`\w`, String.raw`\d`, String.raw`\s`, ".", "[ab]", "[^a]", String.raw`\.`, String.raw`\u{1,}`, String.raw`\p{1,}`, String.raw`\c`, String.raw`\u0061`, String.raw`\x61`];
    const QUANTS = ["", "", "", "?", "*", "+", "{1,3}", "{0,5}", "{2,}", "{1,10}", "{2}", "??", "+?", "{0,40}"];

    function generate(rand: () => number): string {
        const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)] as T;
        const sequence = (depth: number): string => {
            const length = 1 + Math.floor(rand() * (depth === 0 ? 7 : 3));
            let out = "";
            for (let i = 0; i < length; i++) out += term(depth);
            // The known hangs are one term repeated (`(?:a|aa)` x24): copy a term a few times, at the top level.
            if (depth === 0 && rand() < 0.5) out += term(1).repeat(2 + Math.floor(rand() * 30));
            if (depth === 0 && rand() < 0.5) out += term(0);
            return out;
        };
        const alternatives = (depth: number): string => {
            const count = rand() < 0.35 ? 2 + Math.floor(rand() * 3) : 1;
            const parts: string[] = [];
            for (let i = 0; i < count; i++) parts.push(rand() < 0.12 ? "" : sequence(depth));
            return parts.join("|");
        };
        const term = (depth: number): string => {
            if (depth < 2 && rand() < 0.3) return `${pick(["(", "(?:"])}${alternatives(depth + 1)})${pick(QUANTS)}`;
            return pick(ATOMS) + pick(QUANTS);
        };
        const body = rand() < 0.1 ? alternatives(0) : sequence(0);
        return `${body}$`;
    }

    const ADVERSARIAL = [
        "a".repeat(63) + "!",
        "a".repeat(64),
        "a".repeat(63) + "x",
        "ab".repeat(32),
        "aab".repeat(21) + "!",
        "w".repeat(63) + "!",
        "1".repeat(63) + "x",
        " ".repeat(63) + "x",
        "u".repeat(63) + "!",
        "c".repeat(63) + "!",
        "\\".repeat(31) + "c".repeat(32) + "!",
        "a".repeat(32) + "x" + "a".repeat(31) + "!",
        "x".repeat(64),
    ];

    it("every accepted random pattern finishes on adversarial 64-character lines", () => {
        const rand = mulberry32(0x5115);
        const context = createContext({ re: /x/, text: "" });
        const script = new Script("re.lastIndex = 0; re.exec(text)");
        let accepted = 0;
        for (let i = 0; i < 4000; i++) {
            const body = generate(rand);
            const flags = rand() < 0.15 ? "i" : "";
            const result = compileRule(rule(`/${body}/${flags}`, "x", { mode: "separator" }));
            if (!result.ok) continue;
            accepted++;
            context.re = result.rule.re;
            for (const text of ADVERSARIAL) {
                context.text = text;
                // The time bound: throws ERR_SCRIPT_EXECUTION_TIMEOUT after 1 s (a blow-up takes seconds to minutes,
                // an accepted pattern microseconds). No wall-clock assertion on top: that would only add flakes.
                try {
                    script.runInContext(context, { timeout: 1000 });
                } catch (err) {
                    throw new Error(`/${body}/${flags} hung on ${JSON.stringify(text.slice(0, 20))}...: ${String(err)}`, { cause: err });
                }
            }
        }
        // The test must not be vacuous: a good share of the random patterns passes the gate.
        expect(accepted).toBeGreaterThan(300);
    }, 60_000);
});
