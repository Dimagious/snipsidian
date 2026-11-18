import { describe, it, expect, vi } from "vitest";
import {
    applyPatternReplacement,
    checkPattern,
    compilePatternRules,
    compileRule,
    matchPatterns,
    MAX_PATTERN_REPLACEMENT,
    NO_PATTERNS,
    type CompiledRule,
    type PatternMatch,
} from "./patterns";
import type { ExpandContext, PatternRule } from "./types";

const ctx: ExpandContext = { isInCode: false, isInMath: false, isInFrontmatter: false, now: new Date("2025-09-02T10:11:12") };

/** `/body/` or a full source. */
const src = (body: string, flags = ""): string => `/${body}/${flags}`;

function rule(source: string, replacement = "x", extra: Partial<PatternRule> = {}): PatternRule {
    return { id: "r1", source, replacement, enabled: true, mode: "instant", ...extra };
}

function compiled(source: string, replacement = "x", mode: PatternRule["mode"] = "instant"): CompiledRule {
    const result = compileRule(rule(source, replacement, { mode }));
    if (!result.ok) throw new Error(`expected ${source} to compile: ${result.reason}`);
    return result.rule;
}

function matchOf(source: string, text: string, replacement = "x"): PatternMatch {
    const hit = matchPatterns(text, [compiled(source, replacement)], "instant");
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
];

describe("patterns: S-015 corpus", () => {
    it.each(MUST_REFUSE)("refuses %s with a readable reason", (_label, source) => {
        const result = checkPattern(source);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reason).toMatch(/^[A-Z]/);
            expect(result.reason.length).toBeGreaterThan(10);
        }
    });

    it.each(MUST_ACCEPT)("accepts %s", (_label, source) => {
        expect(checkPattern(source)).toEqual({ ok: true });
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
        const result = checkPattern(source);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toMatch(expected);
    });

    // Timing (ADR-0008): every accepted pattern stays under 1 ms on 64-char adversarial input.
    it("every accepted corpus pattern runs under 1 ms on adversarial 64-char strings", () => {
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
        ];
        const runs = 50;
        for (const [label, source] of MUST_ACCEPT) {
            const { re } = compiled(source);
            for (const text of adversarial) {
                for (let i = 0; i < 5; i++) re.exec(text); // warm up
                const start = performance.now();
                for (let i = 0; i < runs; i++) re.exec(text);
                const perRun = (performance.now() - start) / runs;
                expect(perRun, `${label} on ${text.slice(0, 12)}...`).toBeLessThan(1);
            }
        }
    });
});

describe("patterns: source format and flags", () => {
    it("takes i and u as written, and does not add u (\\: throws under u)", () => {
        expect(checkPattern("/abc$/i")).toEqual({ ok: true });
        expect(checkPattern("/abc$/u")).toEqual({ ok: true });
        expect(checkPattern("/abc$/iu")).toEqual({ ok: true });
        expect(checkPattern(src(String.raw`\:abc$`))).toEqual({ ok: true });
        const withU = checkPattern(src(String.raw`\:abc$`, "u"));
        expect(withU.ok).toBe(false);
        expect(compiled(src(String.raw`\:abc$`)).re.flags).toBe("");
    });

    it.each(["g", "y", "m", "s", "d", "v"])("refuses the flag %s", (flag) => {
        const result = checkPattern(src("a$", flag));
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toContain(`"${flag}"`);
    });

    it("refuses a repeated flag, a missing slash and an empty body", () => {
        expect(checkPattern("/a$/ii").ok).toBe(false);
        expect(checkPattern("a$").ok).toBe(false);
        expect(checkPattern("/a$").ok).toBe(false);
        expect(checkPattern("//").ok).toBe(false);
        expect(checkPattern("").ok).toBe(false);
    });

    it("the i flag matches case-insensitively", () => {
        expect(matchPatterns("hello MTG bob", [compiled("/mtg (\\w+)$/i")], "instant")?.captures[1]).toBe("bob");
    });

    it("body over 200 characters is refused, exactly 200 is not", () => {
        const ok = "a".repeat(198) + "$"; // 199
        const edge = "a".repeat(199) + "$"; // 200
        const over = "a".repeat(200) + "$"; // 201
        expect(checkPattern(src(ok)).ok).toBe(true);
        expect(checkPattern(src(edge)).ok).toBe(true);
        const result = checkPattern(src(over));
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toContain("200");
    });

    it("a huge source is refused without being parsed", () => {
        expect(checkPattern("/" + "a".repeat(1_000_000) + "$/").ok).toBe(false);
    });

    it("a pattern that does not compile is refused with the engine's message", () => {
        const result = checkPattern("/(a$/");
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toMatch(/regular expression|group/i);
        expect(checkPattern("/[a$/").ok).toBe(false);
        expect(checkPattern("/a)$/").ok).toBe(false);
    });
});

describe("patterns: the checker looks at structure, not at characters", () => {
    it.each(["date", "time", "title", "notedate"])("refuses the reserved group name %s", (name) => {
        const result = checkPattern(src(`(?<${name}>\\d+)$`));
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toContain(name);
    });

    it("accepts a group name that only contains a reserved one", () => {
        expect(checkPattern(src(String.raw`(?<dateish>\d+)$`)).ok).toBe(true);
    });

    it("an escaped $ is not the end anchor; neither is one inside a class", () => {
        expect(checkPattern(src(String.raw`a\$`)).ok).toBe(false);
        expect(checkPattern(src(String.raw`a[$]`)).ok).toBe(false);
        expect(checkPattern(src(String.raw`a\\$`)).ok).toBe(true); // an escaped backslash, then the anchor
        expect(checkPattern(src(String.raw`a\$$`)).ok).toBe(true); // a literal $, then the anchor
    });

    it("a quantifier inside a class or after an escape is not counted", () => {
        // `[+*]` and `\*` hold no quantifier: four of those would be refused if they were counted.
        expect(checkPattern(src(String.raw`[+*][+*][+*][+*]\*\+\?$`)).ok).toBe(true);
        expect(checkPattern(src(String.raw`(?:[+*]x)+$`)).ok).toBe(true);
    });

    it("refuses an alternation inside a repeated group, at any depth", () => {
        expect(checkPattern(src(String.raw`(?:a|b)+$`)).ok).toBe(false);
        expect(checkPattern(src(String.raw`(?:x(?:a|b))+$`)).ok).toBe(false);
        expect(checkPattern(src(String.raw`(?:a|b){2}$`)).ok).toBe(false);
        // Not repeated: fine, also under `?`.
        expect(checkPattern(src(String.raw`(?:a|b)?c$`)).ok).toBe(true);
    });

    it("`?` does not make a group repeatable, `{n,m}` with m > 1 does", () => {
        expect(checkPattern(src(String.raw`(a+)?b$`)).ok).toBe(true);
        expect(checkPattern(src(String.raw`(a+){1,2}b$`)).ok).toBe(false);
        expect(checkPattern(src(String.raw`(a+){0,1}b$`)).ok).toBe(true);
    });

    it("any quantifier inside a repeated group is refused, a fixed {n} too (ADR-0008 wording)", () => {
        expect(checkPattern(src(String.raw`(?:\d{2}:){2}\d{2}$`)).ok).toBe(false);
        expect(checkPattern(src(String.raw`\d{2}:\d{2}:\d{2}$`)).ok).toBe(true); // the unrolled form
    });

    it("counts unbounded quantifiers across groups: 2 pass, 3 do not", () => {
        expect(checkPattern(src(String.raw`\w+\s+$`)).ok).toBe(true);
        expect(checkPattern(src(String.raw`\w+\s+\d+$`)).ok).toBe(false);
        expect(checkPattern(src(String.raw`(\w+)(\s*)(\d{3,})$`)).ok).toBe(false);
        expect(checkPattern(src(String.raw`\w+?\s+?\d+?$`)).ok).toBe(false); // lazy changes nothing
    });

    it("a bounded count that covers the whole window counts as unbounded", () => {
        expect(checkPattern(src(String.raw`\w{0,64}\w{0,64}\w{0,64}$`)).ok).toBe(false);
        expect(checkPattern(src(String.raw`\w{0,5}\w{0,5}\w{0,5}a$`)).ok).toBe(true);
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
        const result = checkPattern(src(body));
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
    ])("accepts at the limit: %s, and it stays under 1 ms", (_label, body) => {
        expect(checkPattern(src(body))).toEqual({ ok: true });
        const { re } = compiled(src(body));
        for (const text of ["a".repeat(64), "w".repeat(64), "1/".repeat(32), "a".repeat(63) + "!"]) {
            for (let i = 0; i < 5; i++) re.exec(text);
            const start = performance.now();
            for (let i = 0; i < 20; i++) re.exec(text);
            expect((performance.now() - start) / 20, `${body} on ${text.slice(0, 8)}`).toBeLessThan(1);
        }
    });

    it("refuses \\k<name> backreferences and \\10-style ones", () => {
        expect(checkPattern(src(String.raw`(?<a>x)\k<a>$`)).ok).toBe(false);
        expect(checkPattern(src(String.raw`(x)\10$`)).ok).toBe(false);
        expect(checkPattern(src(String.raw`\0x$`)).ok).toBe(true); // NUL, not a backreference
    });

    it("refuses negative lookahead and any quantifier in a lookbehind", () => {
        expect(checkPattern(src(String.raw`x(?!y)$`)).ok).toBe(false);
        expect(checkPattern(src(String.raw`(?<!x?)y$`)).ok).toBe(false);
        expect(checkPattern(src(String.raw`(?<=a|b)y$`)).ok).toBe(true);
        expect(checkPattern(src(String.raw`(?<!x)y$`)).ok).toBe(true);
    });

    it("refuses every way to match the empty string", () => {
        for (const body of [String.raw`a?$`, String.raw`(a|)$`, String.raw`\b$`, String.raw`(?<= )$`, String.raw`(?:a*b?)$`, "$"]) {
            expect(checkPattern(src(body)).ok, body).toBe(false);
        }
        expect(checkPattern(src(String.raw`a?b$`)).ok).toBe(true);
    });

    it("handles \\p{...}, \\u{...} and \\xHH without losing its place", () => {
        expect(checkPattern(src(String.raw`\p{L}+x$`, "u")).ok).toBe(true);
        expect(checkPattern(src(String.raw`\u{1F600}x$`, "u")).ok).toBe(true);
        expect(checkPattern(src(String.raw`\x41B\cJ$`)).ok).toBe(true);
    });

    it("refuses syntax it does not understand rather than guessing", () => {
        expect(checkPattern(src(String.raw`(?i:a)b$`)).ok).toBe(false);
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
            expect(matchPatterns("a hot1", [r], "instant")).not.toBeNull();
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
        expect(matchPatterns("x1", [first, second], "instant")?.rule.replacement).toBe("first");
        expect(matchPatterns("x1", [second, first], "instant")?.rule.replacement).toBe("second");
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
        expect(matchPatterns("cat xyz", [r], "instant")).toBeNull();
        expect(matchPatterns("a cat", [r], "instant")?.index).toBe(2); // every alternative is anchored
        expect(matchPatterns("a dog", [r], "instant")?.index).toBe(2);
    });

    it("the end check does not rely on the pattern: a rule whose RegExp has no $ still cannot match mid-text", () => {
        // Hand-built stand-in for a bug in the wrap: `index + length === tail.length` alone must stop it.
        const loose: CompiledRule = { ...compiled("/cat$/"), re: /cat/ };
        expect(matchPatterns("cat xyz", [loose], "instant")).toBeNull();
        expect(matchPatterns("a cat", [loose], "instant")?.index).toBe(2);
        const empty: CompiledRule = { ...compiled("/cat$/"), re: /x*/ };
        expect(matchPatterns("abc", [empty], "instant")).toBeNull();
    });

    it("does not match when the text only ends with part of the pattern's reach", () => {
        const r = compiled("/(\\d+)\\/(\\d+)$/");
        expect(matchPatterns("1/2 and", [r], "instant")).toBeNull();
        expect(matchPatterns("1/2", [r], "instant")).not.toBeNull();
    });

    it("looks only at the last 64 characters and reports the start in the whole text", () => {
        const long = "z".repeat(200) + " mtg Bob";
        const m = matchPatterns(long, [compiled("/mtg (\\w+)$/")], "instant");
        expect(m?.index).toBe(201);
        expect(m?.captures[1]).toBe("Bob");
        // A match that starts more than 64 characters back is out of reach.
        const far = "mtg " + "w".repeat(80);
        expect(matchPatterns(far, [compiled("/mtg (\\w+)$/")], "instant")).toBeNull();
        // 64 exactly is in reach, 65 is not.
        expect(matchPatterns("x" + "w".repeat(63), [compiled("/x(\\w+)$/")], "instant")).not.toBeNull();
        expect(matchPatterns("x" + "w".repeat(64), [compiled("/x(\\w+)$/")], "instant")).toBeNull();
    });

    it("^ means line start: a window cut from a longer line cannot say, so such rules are skipped", () => {
        const r = compiled("/^-- $/");
        expect(matchPatterns("-- ", [r], "instant")?.index).toBe(0);
        expect(matchPatterns("x".repeat(70) + "-- ", [r], "instant")).toBeNull();
        expect(matchPatterns("a-- ", [r], "instant")).toBeNull();
    });

    it("lookbehind sees the context inside the window", () => {
        const r = compiled(String.raw`/(?<= )--$/`, "—");
        expect(matchPatterns("a --", [r], "instant")?.index).toBe(2);
        expect(matchPatterns("a--", [r], "instant")).toBeNull();
    });

    it("no rules, no text, no match", () => {
        expect(matchPatterns("abc", [], "instant")).toBeNull();
        expect(matchPatterns("", [compiled("/a$/")], "instant")).toBeNull();
    });

    it("keeps working when the same rule list is used again (no lastIndex state)", () => {
        const r = compiled("/a(\\d)$/");
        for (let i = 0; i < 4; i++) expect(matchPatterns("a1", [r], "instant")).not.toBeNull();
    });

    it("an astral character at the cut does not break the match", () => {
        const text = "😀".repeat(40) + "x1";
        expect(matchPatterns(text, [compiled("/x(\\d)$/")], "instant")?.captures[1]).toBe("1");
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
