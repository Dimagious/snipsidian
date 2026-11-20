import { describe, it, expect, vi, type MockInstance } from "vitest";
import { createContext, Script } from "node:vm";
import {
    applyPatternReplacement,
    safePatternReplacement,
    checkPattern,
    canEndWith,
    matchPatternsInOrder,
    compilePatternRules,
    compileRule,
    matchPatterns,
    KEYSTROKE_BUDGET_MS,
    LOOKBEHIND_ATOM_LIMIT,
    MAX_PATTERN_REPLACEMENT,
    NO_PATTERNS,
    PATTERN_TAIL_LIMIT,
    patternHealth,
    RULE_COMPILE_LIMIT_MS,
    RULE_SLOW_MS,
    RULE_SLOW_RETRIES,
    RULE_SLOW_STRIKES,
    RULE_STRIKE_WINDOW,
    switchedOffRules,
    type CompiledRule,
    type PatternMatch,
} from "./patterns";
import { expand, expandInstant } from "./expand";
import type { ExpandContext, PatternMode, PatternRule } from "./types";

const ctx: ExpandContext = { isInCode: false, isInMath: false, isInFrontmatter: false, now: new Date("2025-09-02T10:11:12") };

/** The separator limits (the lenient ones) unless a mode is given; instant rules are stricter. */
const check = (source: string, mode: PatternMode = "separator") => checkPattern(source, mode);

/** `/body/` or a full source. */
const src = (body: string, flags = ""): string => `/${body}/${flags}`;

/** A high half not followed by a low one, or a low half not preceded by a high one. */
const hasLoneSurrogate = (text: string): boolean => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text);

function rule(source: string, replacement = "x", extra: Partial<PatternRule> = {}): PatternRule {
    return { id: "r1", source, replacement, enabled: true, mode: "instant", ...extra };
}

function compiled(source: string, replacement = "x", mode: PatternRule["mode"] = "separator"): CompiledRule {
    const result = compileRule(rule(source, replacement, { mode }));
    if (!result.ok) throw new Error(`expected ${source} to compile: ${result.reason}`);
    return result.rule;
}

/**
 * Runs `re.exec(text)` under a `node:vm` watchdog: a JS `exec` cannot be interrupted from the same thread, but the
 * script `timeout` terminates it (irregexp checks for the interrupt while it backtracks). A pattern that is too slow
 * fails the test with ERR_SCRIPT_EXECUTION_TIMEOUT instead of hanging the suite, and the test asserts no wall-clock
 * time of its own (that only adds flakes).
 */
const execContext = createContext({ re: /x/, text: "" });
const execScript = new Script("re.lastIndex = 0; re.exec(text)");
function execWithin(re: RegExp, text: string, timeout = 1500): void {
    execContext.re = re;
    execContext.text = text;
    execScript.runInContext(execContext, { timeout });
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

    // Accepted patterns do not blow up on adversarial 64-char strings. Under a vm watchdog (1.5 s, see `execWithin`),
    // not a stopwatch: a backtracking blow-up takes seconds to minutes, so the watchdog tells it from a slow machine.
    // No "under 1 ms" promise (ADR-0008, round 2): polynomial cost is the runtime guard's job.
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
        for (const [label, source] of MUST_ACCEPT) {
            const { re } = compiled(source);
            for (const text of adversarial) {
                expect(() => execWithin(re, text), `${label} on ${text.slice(0, 12)}...`).not.toThrow();
            }
        }
    });
});

describe("patterns: source format and flags", () => {
    it("takes i as written and never adds u (`g` is only there for lastIndex, the window's context char)", () => {
        expect(check("/abc$/")).toEqual({ ok: true });
        expect(check("/abc$/i")).toEqual({ ok: true });
        expect(check(src(String.raw`\:abc$`))).toEqual({ ok: true });
        expect(compiled(src(String.raw`\:abc$`)).re.flags).toBe("g");
        expect(compiled("/abc$/i").re.flags).toBe("gi");
    });

    // Round 7 (owner, 2026-11-18): under `u` V8 compiles adjacent short ranged terms slowly (the checker measured
    // ~38 ms per exec for `\S{1,4}` x5 plus a tail, 100 such rules 8.6 s over 100 keystrokes), and only under `u`.
    // The flag is refused in iteration 1.
    const U_REASON = "The u flag isn't supported in patterns yet. Emoji still work as plain text, outside [ ].";

    it.each(["u", "iu", "ui"])("refuses the u flag (/%s), in both modes, with the same sentence-case reason", (flags) => {
        for (const mode of ["separator", "instant"] as const) {
            expect(check(src("abc$", flags), mode), `${flags} ${mode}`).toMatchObject({ ok: false, reason: U_REASON });
        }
        expect(U_REASON).not.toMatch(/[\u2013\u2014]/);
        expect(compileRule(rule(src("abc$", flags)))).toEqual({ ok: false, reason: U_REASON });
        expect(compilePatternRules([rule(src("abc$", flags))]).rules).toEqual([]);
    });

    it.each([
        ["the round 7 shape, \\S{1,4} x5 under u", String.raw`\S{1,4}\S{1,4}\S{1,4}\S{1,4}\S{1,4}\d\dzq$`, "u"],
        ["the round 7 shape, [^emoji]{1,4} x4 under iu", "[^😀𝒜]{1,4}".repeat(4) + String.raw`\d\dzq$`, "iu"],
        ["a round 6 astral class under iu", "[^😀𐀀𠀀𰀀]{1,4}-\\d{2}-\\d{2}zq$", "iu"],
        ["a round 5 property class under iu", String.raw`\p{L}{1,4}-\d{2}-\d{2}$`, "iu"],
        ["\\u{...} under u", String.raw`\u{1F600}x$`, "u"],
    ])("refuses %s for the flag, whatever the body", (_label, body, flags) => {
        expect(check(src(body, flags))).toMatchObject({ ok: false, reason: U_REASON });
    });

    it.each(["g", "y", "m", "s", "d", "v"])("refuses the flag %s", (flag) => {
        const result = check(src("a$", flag));
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toBe(`The flag "${flag}" is not supported. Only i is.`);
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
    ])("accepts at the limit: %s, and it stays far from a blow-up (vm watchdog, see above)", (_label, body) => {
        expect(check(src(body))).toEqual({ ok: true });
        const { re } = compiled(src(body));
        for (const text of ["a".repeat(64), "w".repeat(64), "1/".repeat(32), "a".repeat(63) + "!"]) {
            expect(() => execWithin(re, text), `${body} on ${text.slice(0, 8)}`).not.toThrow();
        }
    });

    it("refuses \\k<name> backreferences and \\10-style ones", () => {
        expect(check(src(String.raw`(?<a>x)\k<a>$`)).ok).toBe(false);
        expect(check(src(String.raw`(x)\10$`)).ok).toBe(false);
        expect(check(src(String.raw`\0x$`)).ok).toBe(true); // NUL, not a backreference
    });

    it("refuses \\1-\\9 inside a class: legacy octal there, which the parser does not model", () => {
        for (const digit of ["1", "5", "8", "9"]) {
            const result = check(src(`[\\${digit}]$`));
            expect(result.ok, `[\\${digit}]`).toBe(false);
            if (!result.ok) expect(result.reason, digit).toMatch(/isn't supported/);
        }
        expect(check(src(String.raw`[\0]$`)).ok).toBe(true); // NUL stays fine
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

    it("handles \\uHHHH and \\xHH without losing its place, and refuses \\u{...} (a letter and a quantifier without u)", () => {
        expect(check(src(String.raw`\u0061+x$`)).ok).toBe(true);
        expect(check(src(String.raw`\x41B$`)).ok).toBe(true);
        expect(check(src(String.raw`\u{61}+x$`)).ok).toBe(false);
        expect(check(src(String.raw`\u{1F600}x$`)).ok).toBe(false);
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

    it("B-204: {{title}} in a pattern replacement is the note's name, next to a capture", async () => {
        const out = await apply("/x(\\d)$/", "x7", "[{{1}}|{{title}}]", { ...ctx, basename: "Plan" });
        expect(out.text).toBe("[7|Plan]");
    });

    it("B-204 / B-218: a name or note date that holds a capture sentinel cannot forge one", async () => {
        const evil = String.fromCharCode(0xe100);
        const out = await apply("/x(\\d)$/", "x7", "{{1}} {{title}} {{notedate:Y}}", {
            ...ctx,
            basename: `a${evil}b`,
            formatNoteDate: () => `c${evil}d`,
        });
        expect(out.text).toBe("7 ab cd");
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

describe("patterns: escapes are an allowlist (S-015, round 2)", () => {
    // Round 1: without `u`, \u{1,} / \p{1,} / \P{1,} are one letter and the quantifier {1,}, and the parser used to
    // swallow them as one atom. Round 2: instead of modelling every Annex B form (legacy octal, \c, identity
    // escapes of letters), the parser refuses what it does not model exactly.
    it.each([
        ["\\u{1,} without u", String.raw`(\u{1,})+$`, ""],
        ["\\p{1,} without u", String.raw`(\p{1,})+$`, ""],
        ["\\P{1,} without u", String.raw`(\P{1,})+$`, ""],
        ["\\p{L} without u", String.raw`\p{L}$`, ""],
        ["\\u12 (incomplete)", String.raw`\u12$`, ""],
        ["\\u123 (incomplete)", String.raw`a\u123$`, ""],
        ["\\x4 (incomplete)", String.raw`a\x4$`, ""],
        ["\\c before a letter", String.raw`\cJ$`, ""],
        ["\\c before a non-letter", String.raw`.*.*\c*\c*x$`, ""],
        ["\\c at the end of a class", String.raw`[\c]x$`, ""],
        ["legacy octal \\041", String.raw`\041$`, ""],
        ["legacy octal \\00", String.raw`a\00$`, ""],
        ["legacy octal in a class", String.raw`[\041]$`, ""],
        ["\\a (identity escape of a letter)", String.raw`\a$`, ""],
        ["\\e", String.raw`\e$`, ""],
        ["\\k without a name", String.raw`\k$`, ""],
        ["\\B in a class", String.raw`[\B]$`, ""],
        ["a surrogate pair of escapes", String.raw`\uD83D\uDE00$`, ""],
        ["a lone surrogate escape", String.raw`a\uDE00$`, ""],
    ])("refuses %s", (_label, body, flags) => {
        const result = check(src(body, flags));
        expect(result.ok, body).toBe(false);
        if (!result.ok) expect(result.reason, body).toMatch(/^[A-Z]/);
    });

    it("names the escape in the reason", () => {
        const reason = (body: string): string => {
            const result = check(src(body));
            return result.ok ? "accepted" : result.reason;
        };
        expect(reason(String.raw`a\041$`)).toBe("This escape isn't supported in patterns: \\041");
        expect(reason(String.raw`\cJ$`)).toBe("This escape isn't supported in patterns: \\c");
        expect(reason(String.raw`\e$`)).toBe("This escape isn't supported in patterns: \\e");
    });

    it("still accepts the escapes the parser models exactly", () => {
        for (const body of [
            String.raw`\d\D\w\W\s\S$`,
            String.raw`\n\r\t\f\v$`,
            String.raw`a\0$`, // NUL: \0 not followed by a digit
            String.raw`\x41\u0041$`,
            String.raw`\.\*\+\?\^\$\|\(\)\[\]\{\}\\\/$`,
            String.raw`\:\-\#\@\_$`, // identity escapes of non-letters, without u
            String.raw`[\d\-\.\]\x41\u0041\b]$`,
            String.raw`\bword\b$`,
        ]) {
            expect(check(src(body)), body).toEqual({ ok: true });
        }
        expect(check(src(String.raw`[\x61b]\\p$`))).toEqual({ ok: true }); // `\\p` is a backslash and a letter
    });

    it("keeps the backreference reason for \\1..\\9 and \\k<name>", () => {
        for (const body of [String.raw`(a)\1$`, String.raw`(x)\10$`, String.raw`(?<a>x)\k<a>$`]) {
            const result = check(src(body));
            expect(result.ok, body).toBe(false);
            if (!result.ok) expect(result.reason, body).toMatch(/backreference/i);
        }
    });

    it("\\u{...} is refused: without u it is a letter and a quantifier, and the flag that reads it is refused", () => {
        for (const body of [String.raw`\u{1F600}$`, String.raw`(\u{61}+)+$`, String.raw`\u{61$`, String.raw`a\u{}$`]) {
            const result = check(src(body));
            expect(result.ok, body).toBe(false);
        }
        expect(check(src(String.raw`\u{1F600}$`))).toMatchObject({ ok: false, reason: "This escape isn't supported in patterns: \\u" });
    });

    // The bug class this closes: the parser read `\041` as `\0` + `4` + `1`, so the end-character test said the match
    // could only end with `1` while V8 matches "!" (U+0021).
    it("regression: /\\041$/ is refused, not read as \\0, 4, 1 (the end test would have said no to \"!\")", () => {
        expect(compileRule(rule(src(String.raw`\041$`), "x", { mode: "instant" })).ok).toBe(false);
        expect(new RegExp("(?:\\041)$").test("a!")).toBe(true); // V8 does match
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

describe("patterns: lookbehind is capped (S-015, round 2)", () => {
    it(`allows ${String(LOOKBEHIND_ATOM_LIMIT)} atoms in all lookbehinds together, refuses the ninth`, () => {
        expect(LOOKBEHIND_ATOM_LIMIT).toBe(8);
        expect(check(src(String.raw`(?<=abcdefgh)x$`))).toEqual({ ok: true });
        const nine = check(src(String.raw`(?<=abcdefghi)x$`));
        expect(nine.ok).toBe(false);
        if (!nine.ok) expect(nine.reason).toMatch(/lookbehind/i);
    });

    it("counts across lookbehinds, across alternatives and in nested groups", () => {
        expect(check(src(String.raw`(?<=abcd)(?<!efgh)x$`))).toEqual({ ok: true });
        expect(check(src(String.raw`(?<=abcd)(?<!efghi)x$`)).ok).toBe(false);
        expect(check(src(String.raw`(?<=abcd|efgh)x$`))).toEqual({ ok: true });
        expect(check(src(String.raw`(?<=abcd|efghi)x$`)).ok).toBe(false);
        expect(check(src(String.raw`(?<=a(?:bcde)f)x$`))).toEqual({ ok: true }); // 7 terms: a, the group, b-e, f
        expect(check(src(String.raw`(?<=a(?:bcdefgh))x$`)).ok).toBe(false); // 9 terms: a, the group, b-h
    });

    it("an anchor inside a lookbehind costs one, atoms outside lookbehinds cost nothing", () => {
        expect(check(src(String.raw`(?<=^abcdefg)x$`))).toEqual({ ok: true });
        expect(check(src(String.raw`(?<=^abcdefgh)x$`)).ok).toBe(false);
        expect(check(src(String.raw`abcdefghijklmnop(?<=ab)x$`))).toEqual({ ok: true });
    });

    it("the existing refusal for a quantifier inside a lookbehind stays", () => {
        const result = check(src(String.raw`(?<=a+)x$`));
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toMatch(/quantifier/i);
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

describe("patterns: Unicode property escapes are refused (S-015, round 5)", () => {
    // V8 compiles a property class on the first non-Latin-1 `exec`, during typing, and one `\p{L}{1,4}` next to a short
    // tail took 90-430 ms there, non-monotonically in the quantifier, the tail and the property: a count cannot bound
    // it (round 4 tried), so none is accepted. The cheap constructs (\w, ., [^a], [а-яё], small astral classes) stay.
    const REASON =
        "Unicode property classes like \\p{L} aren't supported in patterns yet. Use \\w or a range such as [а-яё] instead.";
    const pat = (body: string, flags = ""): string => src(body + "$", flags);

    it.each([
        ["a single \\p{L}", String.raw`\p{L}x`],
        ["a single \\P{L}", String.raw`\P{L}x`],
        ["a script", String.raw`\p{Script=Cyrillic}x`],
        ["a long property name", String.raw`\p{Lowercase_Letter}x`],
        ["inside a class", String.raw`[\p{L}]x`],
        ["inside a negated class", String.raw`[^\p{L}]x`],
        ["\\P inside a class", String.raw`[a\P{N}]x`],
        ["inside a group", String.raw`(?:\p{L}|b)x`],
        ["inside a lookbehind", String.raw`(?<=\p{L})x`],
        ["inside a negative lookbehind", String.raw`(?<!\P{L})x`],
        ["the last atom before $", String.raw`x\p{L}`],
        ["a quantified one", String.raw`\p{L}+x`],
        // The shapes the checker measured at 90-430 ms on the first non-Latin-1 exec.
        ["round 5: \\p{L}{1,4}-\\d{2}-\\d{2}", String.raw`\p{L}{1,4}-\d{2}-\d{2}`],
        ["round 5: \\p{L}{2,4}\\d{4}", String.raw`\p{L}{2,4}\d{4}`],
        ["round 5: \\P{Cn}{1,4}\\w{6}\\P{Cn}{1,4}\\w{6}", String.raw`\P{Cn}{1,4}\w{6}\P{Cn}{1,4}\w{6}`],
        // The round 4 cases (the weighted cap): all of them are refused now, with the same reason.
        ["round 4: four positive", String.raw`\p{L}\p{N}\p{Lu}\p{Ll}z`],
        ["round 4: six consecutive \\P{L} (2 s on the first two-byte exec)", String.raw`\P{L}\P{L}\P{L}\P{L}\P{L}\P{L}z`],
        ["round 4: three negated", String.raw`\P{L}\P{N}\P{Lu}z`],
        ["round 4: \\p{...} in negated classes", String.raw`[^\p{L}][^\p{N}][^\p{Lu}]z`],
        ["round 4: four properties in one class", String.raw`[\p{L}\p{N}\p{Z}\p{P}]z`],
        ["round 4: a repeated group x3", String.raw`(?:\P{L}\P{L}\P{L}){3}z`],
        ["round 4: a quantified atom written out 3 times", String.raw`\p{L}{3}\p{N}z`],
        ["round 4: three positive (was accepted)", String.raw`\p{L}\p{N}\p{Lu}z`],
        // V8's own "Invalid property name" must not reach the person: it is the same mistake.
        ["a property written without braces", String.raw`\pLx`],
        ["a lone backslash-p in a class", String.raw`[\p]x`],
        ["a property of strings (RGI_Emoji)", String.raw`\p{RGI_Emoji}x`],
        ["an unknown property", String.raw`\p{NoSuchProperty}x`],
        ["an unclosed property", String.raw`\P{Lx`],
    ])("refuses %s without u and under i, in both modes", (_label, body) => {
        for (const flags of ["", "i"]) {
            for (const mode of ["separator", "instant"] as const) {
                const result = check(pat(body, flags), mode);
                expect(result.ok, `${body} /${flags} ${mode}`).toBe(false);
                if (!result.ok) expect(result.reason).toBe(REASON);
            }
        }
    });

    it("the escape is refused by the allowlist, before it could mean a letter (the person meant a property class)", () => {
        for (const body of [String.raw`\p{L}x`, String.raw`\P{L}x`, String.raw`[\p{L}]x`, String.raw`(\p{1,})+`, String.raw`\px`]) {
            const result = check(pat(body));
            expect(result.ok, body).toBe(false);
            if (!result.ok) expect(result.reason, body).toBe(REASON);
        }
    });

    it("the reason is sentence case, helps and has no dash", () => {
        expect(REASON).toMatch(/^[A-Z]/);
        expect(REASON).not.toMatch(/[\u2013\u2014]/);
        expect(REASON).toContain("[а-яё]");
    });

    it("an escaped backslash before p is a literal, not a property", () => {
        expect(check(pat(String.raw`\\px`))).toEqual({ ok: true });
        expect(check(pat(String.raw`\\p{L}x`))).toEqual({ ok: true }); // `\\`, `p`, then plain characters
    });

    it("a rule with a property class never compiles, whichever way it gets in", () => {
        const result = compileRule(rule(pat(String.raw`\p{L}{1,4}-\d{2}-\d{2}`, "i")));
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toBe(REASON);
        expect(compilePatternRules([rule(pat(String.raw`\p{L}x`))]).rules).toEqual([]);
    });

    it("the cheap constructs stay accepted: \\w, ., [^a], [а-яё], an emoji as plain text and escapes", () => {
        for (const body of [
            String.raw`\w{1,4}-\d{2}-\d{2}`,
            String.raw`[а-яё]{2,4}\d{4}`,
            String.raw`[^a]{1,4}\w{6}.{1,4}\w{6}`,
            "(?:😀){1,4}abcdef",
            "😀x{1,4}\\w{6}",
            String.raw`\w\w\w\w\w\w\w\w\w\w\w\w[^a-z][^a-z][^a-z][^a-z][а-яё]{2}z`,
        ]) {
            for (const flags of ["", "i"]) expect(check(pat(body, flags)), `${body} /${flags}`).toEqual({ ok: true });
        }
    });

    // Why this replaces round 4's "first exec at the limit" test: that test existed because property classes could still
    // be accepted. None can now, the `u` flag and astral characters in a class are refused too (the round 7 blocks
    // below). What is left is a cheap smoke guard: the constructs the checker swept, with a ranged quantifier and a 6-character tail, run their first
    // two-byte exec under the 1.5 s watchdog. It cannot measure V8's compile cost in a fresh process (the process
    // shares compiled code and nothing here is timed), so it catches only a blow-up of seconds, not a regression of
    // milliseconds; that is what the refusal above and the runtime guard are for.
    it("the first two-byte exec of the non-property constructs the checker swept stays under the watchdog", () => {
        const atoms = [String.raw`\w`, ".", "[^a]", "[а-яё]", "(?:😀)", String.raw`\W`, String.raw`\S`, "[^a-z]"];
        const lines = ["я1", "я".repeat(63) + "1", "я1".repeat(32), "😀".repeat(31) + "я1"];
        let n = 0;
        for (const atom of atoms) {
            for (const q of ["{1,4}", "{2,4}"]) {
                for (const flags of ["", "i"]) {
                    // A distinct literal at the end keeps V8's own compile cache from sharing the regex between runs.
                    const letter = String.fromCharCode(97 + (n++ % 26)) + String.fromCharCode(97 + Math.floor(n / 26));
                    const bodies = [
                        `${atom}${q}-\\d{2}-\\d{2}${letter}`,
                        `${atom}${q}\\d{4}${letter}`,
                        `${atom}${q}\\w{6}${atom}${q}\\w{6}${letter}`,
                    ];
                    for (const body of bodies) {
                        const { re } = compiled(pat(body, flags));
                        for (const text of lines) {
                            expect(() => execWithin(re, text), `${body} /${flags} on ${text.slice(0, 4)}`).not.toThrow();
                            re.lastIndex = 0;
                        }
                    }
                }
            }
        }
    });

    it("checking and compiling a new source never runs it (no compile-time exec)", () => {
        const exec = vi.spyOn(RegExp.prototype, "exec");
        try {
            const marker = String.raw`neverrun(\d+)\w$`;
            expect(check(src(marker))).toEqual({ ok: true });
            const r = compiled(src(String.raw`compiled(\d+)\w\Wx$`));
            const ownRuns = exec.mock.contexts.filter((c) => c === r.re || (c instanceof RegExp && c.source.includes("neverrun")));
            expect(ownRuns).toEqual([]);
        } finally {
            exec.mockRestore();
        }
    });
});

describe("patterns: no astral character inside a class (S-015, round 7)", () => {
    // Without `u`, an astral character is two code units, so `[^😀]` is "not a high half" or "not a low half" and
    // matches each half alone: a match could start or end between the halves. Classes stay BMP-only; an emoji is
    // plain text outside `[ ]`.
    const REASON =
        "Emoji and other characters outside the basic plane can't go inside [ ] yet. Write them as plain text instead.";
    const pat = (body: string, flags = ""): string => src(body + "$", flags);

    it.each([
        ["a positive class", "[😀😁]x"],
        ["a negated class", "[^😀]x"],
        ["a range of emoji", "[😀-😅]x"],
        ["a class with an emoji after BMP members", "[a-z😀]x"],
        ["an astral character from another plane", "[𝒜b]x"],
        ["inside a group", "(?:[😀])x"],
        ["inside a lookbehind", "(?<=[😀])x"],
        ["a quantified class", "[^😀]{1,4}x"],
    ])("refuses %s", (_label, body) => {
        for (const flags of ["", "i"]) {
            for (const mode of ["separator", "instant"] as const) {
                const result = check(pat(body, flags), mode);
                expect(result.ok, `${body} /${flags} ${mode}`).toBe(false);
                if (!result.ok) expect(result.reason, body).toBe(REASON);
            }
        }
    });

    it("says what to do, in sentence case with no dash", () => {
        expect(check(pat("[^😀]x"))).toMatchObject({ ok: false, reason: REASON });
        expect(REASON).toMatch(/^[A-Z]/);
        expect(REASON).not.toMatch(/[\u2013\u2014]/);
    });

    it("a lone surrogate written as a character in a class is refused as well", () => {
        expect(check(pat(`[a${String.fromCharCode(0xd83d)}b]x`))).toMatchObject({ ok: false, reason: REASON });
        expect(check(pat(`[a${String.fromCharCode(0xde00)}]x`))).toMatchObject({ ok: false, reason: REASON });
    });

    it("a surrogate escape in a class is refused by the escape allowlist", () => {
        for (const body of [String.raw`[\uD83D]x`, String.raw`[\uDE00]x`, String.raw`[\uD83D\uDE00]x`]) {
            const result = check(pat(body));
            expect(result.ok, body).toBe(false);
            if (!result.ok) expect(result.reason, body).toMatch(/^This escape isn't supported in patterns: \\u/);
        }
    });

    it("an emoji outside a class stays legal, quantified or not", () => {
        expect(check(pat("😀x"))).toEqual({ ok: true });
        expect(check(pat(":smile:"))).toEqual({ ok: true });
        expect(check(pat("a(?:😀){1,4}"))).toEqual({ ok: true });
        expect(check(pat("(?:😀|😁)x"))).toEqual({ ok: true });
        expect(check(pat("😀", "i"))).toEqual({ ok: true });
    });

    it("BMP classes, class escapes and Cyrillic ranges stay legal", () => {
        for (const body of [String.raw`[а-яё]{1,4}x`, String.raw`[\d\w\s\x41\u0042\-]x`, "[^a-z]x", "[a-]x", "[-a]x", "[^]x"]) {
            expect(check(pat(body)), body).toEqual({ ok: true });
        }
    });

    it("a refused rule never compiles, whichever way it gets in", () => {
        expect(compileRule(rule(pat("[^😀]{1,4}x")))).toEqual({ ok: false, reason: REASON });
        expect(compilePatternRules([rule(pat("[😀]x"))]).rules).toEqual([]);
    });

    it("a class that would have been cheap or expensive under u is refused all the same (the round 6 repro, now for its content)", () => {
        const many = Array.from({ length: 24 }, (_, i) => String.fromCodePoint(0x10000 + i * 0x400 + 7)).join("");
        expect(check(pat(`[^${many}]{1,4}-\\d{2}-\\d{2}zq`, "i"))).toMatchObject({ ok: false, reason: REASON });
    });
});

describe("patterns: a match never splits an emoji (S-015, round 7)", () => {
    // Without `u`, `.`, `[^a]` and `\S` match a single surrogate half. A match that starts on a low half, or whose text
    // ends on a high half, would leave a lone surrogate behind when the plan replaces it.
    /** What the editor would do with a match: replace `[index, end)` of the text with the replacement. */
    const applied = (text: string, source: string, mode: PatternMode): string | null => {
        const m = matchPatterns(text, [compiled(source, "<R>", mode)], mode);
        return m ? text.slice(0, m.index) + "<R>" + text.slice(m.end) : null;
    };

    it("the checker's case: /(.)x$/ on an emoji followed by x does not match (it would start on the low half)", () => {
        for (const mode of ["separator", "instant"] as const) {
            expect(matchPatterns("😀x", [compiled("/(.)x$/", "y", mode)], mode), mode).toBeNull();
        }
    });

    it.each([
        ["a dot", "/(.)x$/"],
        ["a negated class", "/([^a])x$/"],
        ["a \\S", String.raw`/(\S)x$/`],
        ["a quantified dot", "/(.{1,2})x$/"],
        ["a \\W", String.raw`/(\W)x$/`],
    ])("%s cannot start on the low half of an emoji before the match, in both modes", (_label, source) => {
        for (const mode of ["separator", "instant"] as const) {
            for (const before of ["😀", "a😀", "😀😁", "я😀", "x".repeat(70) + "😀"]) {
                const text = before + "x";
                const m = matchPatterns(text, [compiled(source, "y", mode)], mode);
                if (!m) continue;
                // A match starting after the emoji is fine; one starting on its low half is not.
                const out = text.slice(0, m.index) + "y";
                expect(hasLoneSurrogate(out), `${source} ${mode} on ${JSON.stringify(text)}`).toBe(false);
            }
        }
    });

    it("a match that starts after the emoji is untouched", () => {
        expect(applied("😀 ax", String.raw`/(\S)x$/`, "separator")).toBe("😀 <R>");
        expect(applied("😀x", "/😀x$/", "separator")).toBe("<R>");
        expect(applied("a😀b1", String.raw`/b(\d)$/`, "separator")).toBe("a😀<R>");
    });

    it("an emoji inside the match is replaced whole, a plain-text emoji rule works", () => {
        expect(applied("hi :smile:", "/:smile:$/", "separator")).toBe("hi <R>");
        expect(applied("a 😀x", "/😀x$/", "instant")).toBe("a <R>");
        // The emoji is repeated through a group (a quantifier right after it is refused, round 8).
        expect(applied("😀😀x", "/((?:😀)+)x$/", "separator")).toBe("<R>");
    });

    it("a text that ends between the halves of an emoji is skipped without running the regex (no orphan high half)", () => {
        const high = "😀".charAt(0);
        for (const mode of ["separator", "instant"] as const) {
            const r = compiled("/(.)$/", "y", mode);
            const re = new RegExp(r.re.source, r.re.flags);
            const exec = vi.spyOn(re, "exec");
            expect(matchPatterns("a" + high, [{ ...r, re }], mode), mode).toBeNull();
            expect(exec).not.toHaveBeenCalled();
            // The complete pair does match: the rule fires once the emoji is whole (both halves, the low one last).
            const whole = matchPatterns("a😀", [r], mode);
            if (whole) expect(hasLoneSurrogate("a😀".slice(0, whole.index) + "y")).toBe(false);
        }
    });

    it("a dot rule on text with emoji before it never leaves a lone surrogate in the note, instant and separator", () => {
        const sources = ["/(.)$/", "/([^a])$/", String.raw`/(\S)$/`, "/(.)x$/", "/(.{1,3})x$/", String.raw`/(\w|.)x$/`];
        const texts = ["😀", "a😀", "😀x", "a😀x", "😀😁x", "😀 x", "x😀".repeat(3), "я😀x", "😀".repeat(40) + "x", "x".repeat(66) + "😀x"];
        for (const source of sources) {
            for (const mode of ["separator", "instant"] as const) {
                for (const text of texts) {
                    const out = applied(text, source, mode);
                    if (out === null) continue;
                    expect(hasLoneSurrogate(out), `${source} ${mode} on ${JSON.stringify(text)} -> ${JSON.stringify(out)}`).toBe(false);
                }
            }
        }
    });

    it("the window start never splits a pair either (round 2, unchanged)", () => {
        const m = matchPatterns("😀" + "y".repeat(63), [compiled("/[^]{62}$/")], "separator");
        expect(m?.index).toBe(3);
    });
});

describe("patterns: a capture never holds half an emoji (S-015, round 8)", () => {
    /** The line after the editor replaced the match with its replacement; `null` when nothing expands. */
    async function lineAfter(text: string, source: string, replacement: string, mode: PatternMode): Promise<string | null> {
        const m = matchPatterns(text, [compiled(source, replacement, mode)], mode);
        if (!m) return null;
        const out = await safePatternReplacement(m, ctx);
        return out ? text.slice(0, m.index) + out.text + text.slice(m.end) : null;
    }

    const REPROS: ReadonlyArray<readonly [string, string, string]> = [
        ["/(.)(.)x$/", "{{1}}", "😀x"],
        ["/(.)(.)x$/", "{{2}}{{1}}", "😀x"],
        ["/(?<a>.)(?<b>.)$/", "{{b}}{{a}}", "😀"],
        [String.raw`/(\S+)\S$/`, "{{1}}", "hi😀"],
        [String.raw`/(\w+)(.)(.)$/`, "{{1}}{{3}}", "ab😀"],
        ["/:(.)(.*)$/", "{{1}}", "x :😀abc"],
        ["/x(.)?(.)$/", "{{2}}", "x😀"],
        ["/(.)+$/", "{{1}}", "ab😀"],
        [String.raw`/(\W)(\W)$/`, "{{2}}{{1}}", "😀"],
    ];

    it.each(REPROS)("%s with %s on %j never writes a lone surrogate, in both modes", async (source, replacement, text) => {
        for (const mode of ["separator", "instant"] as const) {
            const line = await lineAfter(text, source, replacement, mode);
            if (line !== null) expect(hasLoneSurrogate(line), `${mode}: ${JSON.stringify(line)}`).toBe(false);
        }
    });

    it("layer one: a rule whose capture would be half an emoji does not match at all", () => {
        for (const mode of ["separator", "instant"] as const) {
            expect(matchPatterns("😀x", [compiled("/(.)(.)x$/", "{{1}}", mode)], mode), mode).toBeNull();
            expect(matchPatterns("hi😀", [compiled(String.raw`/(\S+)\S$/`, "{{1}}", mode)], mode), mode).toBeNull();
        }
    });

    it("whole emoji in captures still expand, in order", async () => {
        expect(await lineAfter("😀😁x", "/(.{2})(.{2})x$/", "{{2}}{{1}}!", "separator")).toBe("😁😀!");
        expect(await lineAfter("ab😀", String.raw`/(\w+)(\W{2})$/`, "{{1}}-{{2}}", "separator")).toBe("ab-😀");
        expect(await lineAfter("x 12", String.raw`/(?<n>\d+)$/`, "<{{n}}>", "instant")).toBe("x <12>");
    });

    it("a half-emoji capture the replacement never uses does not stop the rule (round 9)", async () => {
        // `(\S)` holds the high half of the first emoji, but the replacement is plain text: the whole match is clean.
        for (const mode of ["separator", "instant"] as const) {
            expect(await lineAfter("😀hi.up", String.raw`/(\S)\S*\.up$/`, "UP", mode), mode).toBe("UP");
            expect(await lineAfter("😀hi.up", String.raw`/(?<c>\S)\S*\.up$/`, "UP {{zz}}", mode), mode).toBe("UP {{zz}}");
            // The same capture, referenced by number or by name, still drops the match.
            expect(await lineAfter("😀hi.up", String.raw`/(\S)\S*\.up$/`, "{{1}}", mode), mode).toBeNull();
            expect(await lineAfter("😀hi.up", String.raw`/(?<c>\S)\S*\.up$/`, "{{c}}", mode), mode).toBeNull();
        }
    });

    it("the whole match must not start or end between the halves of an emoji, referenced or not (round 9)", () => {
        for (const mode of ["separator", "instant"] as const) {
            expect(matchPatterns("😀x", [compiled("/.x$/", "Y", mode)], mode), mode).toBeNull();
            expect(matchPatterns("😀x", [compiled("/\\S+$/", "Y", mode)], mode)?.index, mode).toBe(0);
        }
    });

    it("layer two: a match whose capture is half an emoji (built by hand) yields no replacement", async () => {
        const base = matchOf("/(.)x$/", "bx", "{{1}}");
        const high = "😀".charAt(0);
        const low = "😀".charAt(1);
        for (const bad of [high, low, "a" + high, low + "a", "😀" + high]) {
            expect(await safePatternReplacement({ ...base, captures: ["bx", bad] }, ctx), JSON.stringify(bad)).toBeNull();
        }
        expect(await safePatternReplacement({ ...base, captures: ["bx", "😀"] }, ctx)).toEqual({ text: "😀" });
    });

    it("layer two: a range that would leave a lone half at either edge yields no replacement", async () => {
        const high = "😀".charAt(0);
        const make = (text: string, index: number): PatternMatch => ({ ...matchOf("/(.)x$/", "bx", "y"), text, index, end: text.length });
        // Starts on the low half of a pair: the high half stays behind.
        expect(await safePatternReplacement(make("😀x", 1), ctx)).toBeNull();
        // Ends on a high half: the low half is left to follow.
        expect(await safePatternReplacement(make("a" + high, 0), ctx)).toBeNull();
        // After a whole pair, or on plain text, it is fine.
        expect(await safePatternReplacement(make("😀x", 2), ctx)).toEqual({ text: "y" });
        expect(await safePatternReplacement(make("abx", 0), ctx)).toEqual({ text: "y" });
    });

    it("a clipboard or replacement text with a lone half is not inserted", async () => {
        const high = "😀".charAt(0);
        const m = matchOf("/x$/", "x", "[$clipboard]");
        const out = await safePatternReplacement(m, { ...ctx, readClipboard: async () => high });
        expect(out).toBeNull();
    });

    it("expand() gives no plan for a half-emoji capture, in both modes", async () => {
        const delimiters = [" "];
        for (const mode of ["separator", "instant"] as const) {
            const r = compiled("/(.)(.)x$/", "{{1}}", mode);
            const plan = await expand({ textBefore: "😀x", textAfter: "", lastTyped: " ", sepCh: 3 }, {}, ctx, delimiters, [r], true);
            expect(plan, mode).toBeNull();
        }
        const ok = await expand({ textBefore: "ab😀x", textAfter: "", lastTyped: " ", sepCh: 5 }, {}, ctx, delimiters, [compiled(String.raw`/(\w+)(.{2})x$/`, "{{2}}{{1}}", "separator")], false);
        expect(ok?.insert).toBe("😀ab");
    });

    // Round 10: the check covers every key the replacement uses, named ones and each of several.
    it("layer one: a named reference, and the second of two, are checked too", () => {
        for (const mode of ["separator", "instant"] as const) {
            expect(matchPatterns("😀hi.up", [compiled(String.raw`/(?<c>\S)\S*\.up$/`, "{{c}}", mode)], mode), `named ${mode}`).toBeNull();
            expect(matchPatterns("a😀.x", [compiled(String.raw`/(a)(\S)\S\.x$/`, "{{1}}{{2}}", mode)], mode), `second ${mode}`).toBeNull();
        }
    });

    const applyPlan = (line: string, plan: { fromCh: number; toCh: number; insert: string } | null): string => (plan ? line.slice(0, plan.fromCh) + plan.insert + line.slice(plan.toCh) : line);

    it("a rule dropped for a half-emoji named or second capture falls through to the next rule, in both modes", async () => {
        const cases = [
            { text: "😀hi.up", rules: [String.raw`/(?<c>\S)\S*\.up$/`, "{{c}}", "/\\.up$/", "UP"], out: "😀hiUP" },
            { text: "a😀.x", rules: [String.raw`/(a)(\S)\S\.x$/`, "{{1}}{{2}}", "/\\.x$/", "X"], out: "a😀X" },
        ] as const;
        for (const { text, rules, out } of cases) {
            // Separator rules, through expand() on a typed space.
            const set = [compiled(rules[0], rules[1], "separator"), compiled(rules[2], rules[3], "separator")];
            const plan = await expand({ textBefore: text, textAfter: "", lastTyped: " ", sepCh: text.length }, {}, ctx, [" "], set, false);
            expect(plan, `separator ${text}`).not.toBeNull();
            expect(applyPlan(text, plan), `separator ${text}`).toBe(out);
            // Instant rules: the first match (after the null one) is the second rule.
            const iset = [compiled(rules[0], rules[1], "instant"), compiled(rules[2], rules[3], "instant")];
            const hit = matchPatterns(text, iset, "instant");
            expect(hit?.rule.replacement, `instant ${text}`).toBe(rules[3]);
            const iplan = hit ? await expandInstant(text, ctx, hit) : null;
            expect(iplan, `instant ${text}`).not.toBeNull();
            expect(applyPlan(text, iplan), `instant ${text}`).toBe(out);
        }
    });

    // A random accepted rule with capture references on random texts with emoji: the line after the edit never has a lone half.
    it("fuzz: no capture reference ever puts a lone surrogate into the line (seeded, both modes)", async () => {
        const rand = mulberry32(0x8a8a);
        const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)] as T;
        const atoms = [".", String.raw`\S`, String.raw`\W`, String.raw`\w`, "[^a]", "[ab]", "a", "x", "😀", String.raw`\d`, "(?:😀)", "[^]"];
        const quants = ["", "", "?", "*", "+", "{1,3}", "{2}", "{0,2}", "+?"];
        const textChars = ["a", "b", "x", "1", " ", ":", "😀", "😁", "🙏", "я", "😀😁"];
        const refs = ["{{0}}", "{{1}}", "{{2}}", "{{3}}", "{{1}}{{2}}", "{{3}}{{1}}", "{{n}}", "[{{2}}]", "{{1}}{{1}}"];
        let matched = 0;
        let produced = 0;
        for (let i = 0; i < 6000; i++) {
            const parts: string[] = [];
            const length = 1 + Math.floor(rand() * 3);
            for (let j = 0; j < length; j++) {
                const piece = pick(atoms) + pick(quants);
                const r = rand();
                parts.push(r < 0.35 ? `(${piece})` : r < 0.45 ? `(?<n>${piece})` : piece);
            }
            const mode = pick(["instant", "separator"] as const);
            const result = compileRule(rule(`/${parts.join("")}$/${pick(["", "i"])}`, pick(refs), { mode }));
            if (!result.ok) continue;
            for (let k = 0; k < 15; k++) {
                let text = "";
                const n = 1 + Math.floor(rand() * 6);
                for (let c = 0; c < n; c++) text += pick(textChars);
                const m = matchPatterns(text, [result.rule], mode);
                if (!m) continue;
                matched++;
                // Round 9: the whole match is always whole; a capture the replacement does not use may be half (the line check below covers the used ones).
                expect(hasLoneSurrogate(m.captures[0] ?? ""), `/${parts.join("")}$/ ${mode} on ${JSON.stringify(text)}`).toBe(false);
                // Round 10: every key the replacement uses resolves to a capture without a lone half.
                for (const key of m.rule.refs) {
                    const value = /^\d$/.test(key) ? m.captures[Number(key)] : m.named.get(key);
                    expect(hasLoneSurrogate(value ?? ""), `{{${key}}} of /${parts.join("")}$/ ${mode} on ${JSON.stringify(text)}`).toBe(false);
                }
                const out = await safePatternReplacement(m, ctx);
                if (!out) continue;
                produced++;
                const line = text.slice(0, m.index) + out.text + text.slice(m.end);
                expect(hasLoneSurrogate(line), `/${parts.join("")}$/ ${result.rule.replacement} ${mode} on ${JSON.stringify(text)} -> ${JSON.stringify(line)}`).toBe(false);
            }
        }
        expect(matched).toBeGreaterThan(500);
        expect(produced).toBeGreaterThan(300);
    }, 60_000);
});

describe("patterns: a quantifier after an emoji, and an escaped half (S-015, round 8)", () => {
    const QUANTIFIER = "A quantifier (*, +, ?, {n,m}) can't follow an emoji directly. Put the emoji in a group to repeat it, like (?:😀)+.";

    it.each(["/a😀?b$/", "/😀+x$/", "/x😀*$/", "/😀{2}$/", "/😀{1,3}x$/", "/😀+?x$/", "/a😀🙏?$/"])("%s is refused with the group hint", (source) => {
        for (const mode of ["separator", "instant"] as const) {
            expect(check(source, mode), `${source} ${mode}`).toMatchObject({ ok: false, reason: QUANTIFIER });
        }
    });

    it("an emoji in a group can be repeated, and an emoji with no quantifier after it is fine", () => {
        for (const source of ["/(?:😀)+x$/", "/a(?:😀)?b$/", "/(😀){2}$/", "/😀x+$/", "/😀{x$/", "/😀😁x$/"]) {
            expect(check(source), source).toEqual({ ok: true });
        }
    });

    it("an emoji alternation under a quantifier gets a hint that does not point at [ ]", () => {
        const result = check("/(?:😀|🙏)+x$/");
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reason).toContain("(?:😀|🙏)");
            expect(result.reason).not.toContain("[ab]");
        }
        // The same group without the quantifier is accepted, and the old hint stays for ordinary alternations.
        expect(check("/(?:😀|🙏)x$/")).toEqual({ ok: true });
        const plain = check("/(?:a|b)+x$/");
        expect(plain.ok === false && plain.reason.includes("[ab]")).toBe(true);
    });

    it.each([
        ["an escaped high half outside a class", "/\\\uD83Dx$/"],
        ["an escaped low half outside a class", "/\\\uDE00x$/"],
        ["an escaped lone half inside a class", "/[\\\uD83D]x$/"],
        ["an escaped emoji", "/\\😀x$/"],
        ["an escaped emoji inside a class", "/[\\😀]x$/"],
    ])("%s is refused", (_label, source) => {
        for (const mode of ["separator", "instant"] as const) {
            expect(check(source, mode).ok, `${source} ${mode}`).toBe(false);
        }
        expect(compilePatternRules([rule(source)]).rules).toEqual([]);
    });

    it("an escaped emoji after a bad range still names the escape, not the range (round 9)", () => {
        // `[z-a\😀]` fails `new RegExp` with "Range out of order": the escaped-emoji reason is the useful one.
        for (const source of ["/[z-a\\😀]$/", "/x[z-a\\😀]$/"]) {
            expect(check(source), source).toMatchObject({ ok: false, reason: "A backslash can't go before an emoji. Write the emoji as plain text." });
        }
    });

    it.each([["\uD83D"], ["\uD83D$|\uDE00"], ["a\uDE00"], ["ok \uD83D"]])("a replacement with half an emoji (%j) is refused at compile (round 9)", (replacement) => {
        const result = compileRule(rule("/x$/", replacement));
        expect(result).toEqual({ ok: false, reason: "The replacement contains half of an emoji. Paste the emoji again." });
        expect(compilePatternRules([rule("/x$/", replacement)]).errors).toEqual([{ id: "r1", reason: "The replacement contains half of an emoji. Paste the emoji again." }]);
    });

    it("a replacement with whole emoji still compiles", () => {
        expect(compileRule(rule("/x$/", "😀$|🙏")).ok).toBe(true);
    });

    it("escaped symbols and non-surrogate escapes stay legal", () => {
        for (const source of [String.raw`/\.x$/`, String.raw`/[\-a]x$/`, String.raw`/\u0041x$/`, String.raw`/\uFFFFx$/`]) {
            expect(check(source), source).toEqual({ ok: true });
        }
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

    it("follows the i flag: it folds case", () => {
        expect(can("ABC$", "c", "i")).toBe(true);
        expect(can("ABC$", "C", "i")).toBe(true);
        expect(can("ABC$", "c")).toBe(false);
        expect(can("[а-яё]$", "ё", "i")).toBe(true);
        expect(can("[а-яё]$", "1", "i")).toBe(false);
    });

    // Without `u` the typed character is a code unit, and an emoji outside a class is two atoms: its halves.
    it("an emoji as plain text ends with its low half: the rule runs after the second half, not after the first", () => {
        const r = compiled("/:smile:😀$/", "x", "instant");
        const high = "😀".charAt(0);
        const low = "😀".charAt(1);
        expect(canEndWith(r, low)).toBe(true);
        expect(canEndWith(r, high)).toBe(false);
        expect(matchPatterns(":smile:😀", [r], "instant")?.index).toBe(0);
        expect(matchPatterns("x:smile:" + high, [r], "instant")).toBeNull();
    });

    it("an astral last character that no atom can end with is still skipped", () => {
        const r = compiled("/-->$/", "x", "instant");
        const re = new RegExp(r.re.source, r.re.flags);
        const exec = vi.spyOn(re, "exec");
        expect(matchPatterns("a😀", [{ ...r, re }], "instant")).toBeNull();
        expect(exec).not.toHaveBeenCalled();
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

describe("patterns: the window keeps context for lookbehind and \\b", () => {
    it("a lookbehind sees the characters before a cut window, not a false line start", () => {
        const r = compiled(String.raw`/(?<!k)(y{63});$/`);
        expect(matchPatterns("k" + "y".repeat(63) + ";", [r], "separator")).toBeNull();
        // The control: the same line with another letter in front does match, from the window start.
        expect(matchPatterns("j" + "y".repeat(63) + ";", [r], "separator")?.index).toBe(1);
    });

    // Checker round 2: the old window kept ONE context character, so a two-character lookbehind saw only the second.
    it("regression: a multi-character negative lookbehind sees all its characters", () => {
        const r = compiled(String.raw`/(?<!kk)y{64}$/`);
        expect(matchPatterns("kk" + "y".repeat(64), [r], "separator")).toBeNull();
        expect(matchPatterns("jk" + "y".repeat(64), [r], "separator")?.index).toBe(2);
    });

    it("regression: a multi-character positive lookbehind sees all its characters", () => {
        const r = compiled(String.raw`/(?<=ab)y{64}$/`);
        expect(matchPatterns("ab" + "y".repeat(64), [r], "separator")?.index).toBe(2);
        expect(matchPatterns("xb" + "y".repeat(64), [r], "separator")).toBeNull();
    });

    it("a lookbehind of the full atom budget sees all of it", () => {
        const r = compiled(String.raw`/(?<=abcdefgh)y{64}$/`);
        expect(matchPatterns("abcdefgh" + "y".repeat(64), [r], "separator")?.index).toBe(8);
        expect(matchPatterns("abcdefgX" + "y".repeat(64), [r], "separator")).toBeNull();
    });

    it("an emoji in a lookbehind is two terms: 4 emoji fill the budget of 8", () => {
        const r = compiled(String.raw`/(?<=😀😁😂😃)y{64}$/`);
        expect(matchPatterns("😀😁😂😃" + "y".repeat(64), [r], "separator")?.index).toBe(8);
        expect(matchPatterns("😀😁😂😄" + "y".repeat(64), [r], "separator")).toBeNull();
        expect(check(src(String.raw`(?<=😀😁😂😃😄)y$`)).ok).toBe(false);
    });

    // The context before the window may start between the halves of a pair; no accepted lookbehind can read that far.
    it("context split in a pair: the widest lookbehind (8 terms = 8 units) never needs the cut half", () => {
        // 17 units before the 64 y's: the context (16 units back from the window) starts on the emoji's low surrogate.
        const prefix = "😀" + "😁".repeat(7) + "z";
        expect(prefix.length).toBe(LOOKBEHIND_ATOM_LIMIT * 2 + 1);
        const r = compiled(String.raw`/(?<=😁😁😁z)y{64}$/`);
        expect(matchPatterns(prefix + "y".repeat(64), [r], "separator")?.index).toBe(prefix.length);
        // The same lookbehind refuses to see a different character where it looks.
        expect(matchPatterns("😀" + "😁".repeat(6) + "😂z" + "y".repeat(64), [r], "separator")).toBeNull();
        // The widest one: 8 units (a dot, three emoji and `z`), all inside the context.
        const wide = compiled(String.raw`/(?<=.😁😁😁z)y{64}$/`);
        expect(matchPatterns(prefix + "y".repeat(64), [wide], "separator")?.index).toBe(prefix.length);
        // One more term would exceed the budget, and the gate does not allow it.
        expect(check(src(String.raw`(?<=😀😁😁😁z)y$`)).ok).toBe(false);
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

    it("a match cannot start before the window (the context is only for looking)", () => {
        // 65 characters: the pattern needs all 65, which is out of reach, even though the context is there.
        expect(matchPatterns("a".repeat(65), [compiled("/a{65}$/")], "separator")).toBeNull();
    });

    // Round 2: the window never starts between the halves of a surrogate pair.
    it("does not split an emoji at the window start", () => {
        const r = compiled("/[^]{64}$/");
        // 65 code units: the emoji is units 0-1, so the window would start on its low surrogate (index 1).
        const m = matchPatterns("😀" + "y".repeat(63), [r], "separator");
        expect(m).toBeNull(); // moved forward one unit: 63 units are left, so {64} cannot match
    });

    it("moves the window start past a low surrogate and still matches what fits", () => {
        const r = compiled("/[^]{62}$/");
        const m = matchPatterns("😀" + "y".repeat(63), [r], "separator");
        expect(m?.index).toBe(3);
        expect(m?.captures[0]).toBe("y".repeat(62));
        // The same line without a pair at the cut starts exactly at the window.
        expect(matchPatterns("zz" + "y".repeat(63), [compiled("/[^]{64}$/")], "separator")?.index).toBe(1);
    });

    it("a lone low surrogate at the window start is not moved, and a match that would begin with it is dropped (round 8)", () => {
        // No high surrogate before it: nothing to split, so the window starts on it and `[^]{64}` would take it as its
        // first unit. A capture that begins with a lone half is never produced, so there is no match.
        expect(matchPatterns("x\uDE00" + "y".repeat(63), [compiled("/[^]{64}$/")], "separator")).toBeNull();
        expect(matchPatterns("x\uDE00" + "y".repeat(63), [compiled("/[^]{63}$/")], "separator")?.index).toBe(2);
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
// Runtime guard (S-015, round 2): polynomial cost is bounded by time, not by syntax
// ---------------------------------------------------------------------------

describe("patterns: runtime guard (fake clock)", () => {
    /** A clock that moves `step` ms on every read: one `exec` is read twice, so it costs exactly `step`. */
    function steppingClock(initial: number): { clock: () => number; step: number } {
        const state = { step: initial, now: 0, clock: (): number => (state.now += state.step) };
        return state;
    }

    /** A fresh `RegExp` per rule: the compile cache shares one between rules of the same source. */
    function fresh(source: string, mode: PatternMode = "separator", id = "r"): { rule: CompiledRule; exec: MockInstance<RegExp["exec"]> } {
        const base = compiled(source, "x", mode);
        const re = new RegExp(base.re.source, base.re.flags);
        const exec = vi.spyOn(re, "exec");
        return { rule: { ...base, id, re }, exec };
    }

    const set = (...rules: CompiledRule[]) => ({ rules, errors: [], hasInstant: false, hasSeparator: true });

    it("one slow sample does not switch a rule off (a GC pause)", () => {
        const t = steppingClock(RULE_SLOW_MS + 1);
        const { rule } = fresh("/(\\d+)$/");
        matchPatterns("a1", [rule], "separator", t.clock);
        t.step = 0.01;
        for (let i = 0; i < 50; i++) matchPatterns("a" + String(i), [rule], "separator", t.clock);
        expect(switchedOffRules(set(rule))).toEqual([]);
        expect(matchPatterns("a77", [rule], "separator", t.clock)?.captures[1]).toBe("77");
    });

    it("a sample at the threshold is not slow (only more than the threshold is)", () => {
        const { clock } = steppingClock(RULE_SLOW_MS);
        const { rule } = fresh("/(\\d+)$/");
        for (let i = 0; i < 10; i++) matchPatterns("a" + String(i), [rule], "separator", clock);
        expect(switchedOffRules(set(rule))).toEqual([]);
    });

    it("strikes accumulate across keystrokes: the third slow one switches the rule off, with a visible reason", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const { clock } = steppingClock(RULE_SLOW_MS + 1);
        const { rule, exec } = fresh("/(\\d+)$/", "separator", "slow-one");
        for (let i = 0; i < RULE_SLOW_STRIKES - 1; i++) matchPatterns("a" + String(i), [rule], "separator", clock);
        expect(switchedOffRules(set(rule))).toEqual([]);
        matchPatterns("a99", [rule], "separator", clock);
        expect(switchedOffRules(set(rule))).toEqual([
            { id: "slow-one", reason: `Switched off: slow on this note (${String(RULE_SLOW_STRIKES)} times over ${String(RULE_SLOW_MS)} ms).` },
        ]);
        // Off for the session: the regex is not run again, and nothing matches.
        const calls = exec.mock.calls.length;
        expect(matchPatterns("a123", [rule], "separator", clock)).toBeNull();
        expect(exec.mock.calls.length).toBe(calls);
        // One warning, with the rule's id; later keystrokes do not repeat it.
        expect(warn).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(warn.mock.calls[0])).toContain("slow-one");
        warn.mockRestore();
    });

    it("the same text twice is one keystroke (the instant path reads the line twice)", () => {
        const { clock } = steppingClock(RULE_SLOW_MS + 1);
        const { rule } = fresh("/(\\d+)$/");
        for (let i = 0; i < 10; i++) matchPatterns("same1", [rule], "separator", clock);
        expect(switchedOffRules(set(rule))).toEqual([]);
    });

    it("fast rules are never switched off, however many keystrokes", () => {
        const { clock } = steppingClock(0.01);
        const { rule } = fresh("/(\\d+)$/");
        for (let i = 0; i < 2000; i++) matchPatterns("n" + String(i), [rule], "separator", clock);
        expect(switchedOffRules(set(rule))).toEqual([]);
    });

    it("a rule switched off does not stop the others", () => {
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const t = steppingClock(RULE_SLOW_MS + 1);
        const slow = fresh("/(\\d+)$/", "separator", "slow").rule;
        const fast = fresh("/(\\w+)!$/", "separator", "fast").rule;
        for (let i = 0; i < RULE_SLOW_STRIKES; i++) matchPatterns("a" + String(i), [slow], "separator", t.clock);
        t.step = 0.01;
        expect(matchPatterns("a1!", [slow, fast], "separator", t.clock)?.rule.id).toBe("fast");
        vi.restoreAllMocks();
    });

    it("stops trying further rules once the keystroke has spent its budget; later rules do not run", () => {
        const t = steppingClock(RULE_SLOW_MS); // not slow (at the threshold); five rules take 10 ms, over the 8 ms budget
        const rules = ["/aa$/", "/bb$/", "/cc$/", "/dd$/", "/ee$/", "/ff$/"].map((source, i) => fresh(source, "separator", `r${String(i)}`));
        expect(KEYSTROKE_BUDGET_MS).toBe(8);
        expect(matchPatterns("x ff", rules.map((r) => r.rule), "separator", t.clock)).toBeNull();
        expect(rules.map((r) => r.exec.mock.calls.length)).toEqual([1, 1, 1, 1, 1, 0]);
    });

    it("stays within the budget: two 2 ms rules do not stop the third", () => {
        const t = steppingClock(RULE_SLOW_MS);
        const rules = ["/aa$/", "/bb$/", "/cc$/"].map((source, i) => fresh(source, "separator", `r${String(i)}`));
        expect(matchPatterns("x cc", rules.map((r) => r.rule), "separator", t.clock)?.rule.id).toBe("r2");
    });

    it("a rule that matches before the budget runs out still wins", () => {
        const t = steppingClock(RULE_SLOW_MS);
        const rules = ["/aa$/", "/bb$/"].map((source, i) => fresh(source, "separator", `r${String(i)}`));
        expect(matchPatterns("x aa", rules.map((r) => r.rule), "separator", t.clock)?.rule.id).toBe("r0");
    });

    it("applies to matchPatternsInOrder too: both modes share one budget for the call", () => {
        const t = steppingClock(9); // the first rule that runs spends the whole budget
        const rules = [fresh("/aa$/", "instant", "i0"), fresh("/bb$/", "separator", "s0"), fresh("/cc$/", "instant", "i1")];
        const all = rules.map((r) => r.rule);
        // i0 is skipped by its end test (no exec), s0 runs (slow: with its retries) and spends the budget, so i1 is never tried.
        expect(matchPatternsInOrder({ atCaret: "zz cc", beforeSeparator: "zz" }, all, t.clock)).toBeNull();
        expect(rules.map((r) => r.exec.mock.calls.length)).toEqual([0, 1 + RULE_SLOW_RETRIES, 0]);
        // With a cheap clock the same call reaches i1 and matches.
        t.step = 1;
        expect(matchPatternsInOrder({ atCaret: "zz cc", beforeSeparator: "zz" }, all, t.clock)?.rule.id).toBe("i1");
    });

    it("recompiling gives fresh rules: the switch-off is for the compiled set, not for the source", () => {
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const list = [{ id: "r1", source: String.raw`/(\d+)$/`, replacement: "x", enabled: true, mode: "separator" }];
        const first = compilePatternRules(list);
        const t = steppingClock(RULE_SLOW_MS + 1);
        for (let i = 0; i < RULE_SLOW_STRIKES; i++) matchPatterns("a" + String(i), first.rules, "separator", t.clock);
        expect(switchedOffRules(first)).toHaveLength(1);
        const second = compilePatternRules(list);
        expect(switchedOffRules(second)).toEqual([]);
        expect(matchPatterns("a42", second.rules, "separator")?.captures[1]).toBe("42");
        vi.restoreAllMocks();
    });

    // -- Round 3: a slow sample is retried (lazy compilation is not slowness) and strikes decay ----------------------

    /** A clock whose n-th `exec` costs `costs[n]` ms (the last cost repeats). Only `tryRule` reads it, twice per exec. */
    function scriptedClock(costs: readonly number[]): () => number {
        let reads = 0;
        let now = 0;
        return () => {
            const exec = Math.floor(reads++ / 2);
            if (reads % 2 === 1) return now; // start of an exec
            now += costs[Math.min(exec, costs.length - 1)] ?? 0;
            return now; // end of it
        };
    }

    it("slow, slow, fast on the same text is lazy compilation, not slowness: no strike, on any number of keystrokes", () => {
        const { rule, exec } = fresh("/(\\d+)$/");
        // V8 compiles on the 1st exec, again on tier-up and on the first non-Latin-1 input: 3 ms, 3 ms, then microseconds.
        const keystrokes = RULE_SLOW_STRIKES + 2;
        const clock = scriptedClock(Array.from({ length: keystrokes }, () => [3, 3, 0.01]).flat());
        for (let i = 0; i < keystrokes; i++) matchPatterns("a" + String(i), [rule], "separator", clock);
        expect(switchedOffRules(set(rule))).toEqual([]);
        expect(exec).toHaveBeenCalledTimes(3 * keystrokes);
    });

    it("a slow sample is re-run on the same text, at most RULE_SLOW_RETRIES more times", () => {
        expect(RULE_SLOW_RETRIES).toBe(2);
        const { rule, exec } = fresh("/(\\d+)$/");
        matchPatterns("a1", [rule], "separator", scriptedClock([5, 5, 5, 5, 5]));
        expect(exec).toHaveBeenCalledTimes(1 + RULE_SLOW_RETRIES);
        // Every re-run read the same text from the same position.
        expect(new Set(exec.mock.calls.map((c) => c[0]))).toEqual(new Set(["a1"]));
    });

    it("stops re-running as soon as one run is fast; a fast first run is not re-run at all", () => {
        const slowThenFast = fresh("/(\\d+)$/");
        matchPatterns("a1", [slowThenFast.rule], "separator", scriptedClock([5, 0.01]));
        expect(slowThenFast.exec).toHaveBeenCalledTimes(2);
        const fast = fresh("/(\\d+)$/");
        matchPatterns("a1", [fast.rule], "separator", scriptedClock([0.01]));
        expect(fast.exec).toHaveBeenCalledTimes(1);
    });

    it("a rule slow on every run (the fastest of the three is still over the threshold) is switched off after 3 keystrokes", () => {
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const { rule } = fresh("/(\\d+)$/");
        const clock = scriptedClock([RULE_SLOW_MS + 1]);
        for (let i = 0; i < RULE_SLOW_STRIKES - 1; i++) matchPatterns("a" + String(i), [rule], "separator", clock);
        expect(switchedOffRules(set(rule))).toEqual([]);
        matchPatterns("a99", [rule], "separator", clock);
        expect(switchedOffRules(set(rule))).toHaveLength(1);
        vi.restoreAllMocks();
    });

    it("the FASTEST of the runs decides: 5, 4, 3 ms is still slow, 5, 4, 2 ms is not (at the threshold)", () => {
        const slow = fresh("/(\\d+)$/");
        matchPatterns("a1", [slow.rule], "separator", scriptedClock([5, 4, 3]));
        expect(slow.rule.health.strikes).toHaveLength(1);
        const ok = fresh("/(\\d+)$/");
        matchPatterns("a1", [ok.rule], "separator", scriptedClock([5, 4, RULE_SLOW_MS]));
        expect(ok.rule.health.strikes).toHaveLength(0);
    });

    it("the re-runs count against the keystroke budget", () => {
        // Rule 0 takes 3 + 3 + 3 = 9 ms with its re-runs: over the 8 ms budget, so rule 1 is not tried.
        const rules = ["/aa$/", "/bb$/"].map((source, i) => fresh(source, "separator", `r${String(i)}`));
        expect(matchPatterns("x bb", rules.map((r) => r.rule), "separator", scriptedClock([3, 3, 3, 0.01]))).toBeNull();
        expect(rules.map((r) => r.exec.mock.calls.length)).toEqual([1 + RULE_SLOW_RETRIES, 0]);
    });

    it("strikes decay: slow keystrokes far apart (more than RULE_STRIKE_WINDOW runs) never add up", () => {
        const { rule } = fresh("/(\\d+)$/");
        const slow = scriptedClock([RULE_SLOW_MS + 1]);
        const fast = scriptedClock([0.01]);
        let n = 0;
        for (let round = 0; round < 6; round++) {
            matchPatterns("s" + String(n++), [rule], "separator", slow);
            for (let i = 0; i < RULE_STRIKE_WINDOW; i++) matchPatterns("f" + String(n++), [rule], "separator", fast);
        }
        expect(switchedOffRules(set(rule))).toEqual([]);
        expect(rule.health.strikes.length).toBeLessThan(RULE_SLOW_STRIKES);
    });

    it("three slow keystrokes inside the window still switch the rule off, with fast ones in between", () => {
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const { rule } = fresh("/(\\d+)$/");
        const slow = scriptedClock([RULE_SLOW_MS + 1]);
        const fast = scriptedClock([0.01]);
        let n = 0;
        for (let round = 0; round < RULE_SLOW_STRIKES; round++) {
            matchPatterns("s" + String(n++), [rule], "separator", slow);
            // Fast runs in between, few enough that all three slow runs fall inside the last RULE_STRIKE_WINDOW runs.
            if (round < RULE_SLOW_STRIKES - 1) for (let i = 0; i < Math.floor(RULE_STRIKE_WINDOW / 2) - 2; i++) matchPatterns("f" + String(n++), [rule], "separator", fast);
        }
        expect(switchedOffRules(set(rule))).toHaveLength(1);
        vi.restoreAllMocks();
    });

    it("the window edge: the third slow keystroke exactly RULE_STRIKE_WINDOW runs after the first no longer counts the first", () => {
        const { rule } = fresh("/(\\d+)$/");
        const slow = scriptedClock([RULE_SLOW_MS + 1]);
        const fast = scriptedClock([0.01]);
        matchPatterns("s0", [rule], "separator", slow); // run 1
        matchPatterns("s1", [rule], "separator", slow); // run 2
        for (let i = 0; i < RULE_STRIKE_WINDOW - 2; i++) matchPatterns("f" + String(i), [rule], "separator", fast); // runs 3..50
        matchPatterns("s2", [rule], "separator", slow); // run 51: run 1 is 50 runs back, outside "the last 50"
        expect(switchedOffRules(set(rule))).toEqual([]);
        expect(rule.health.strikes).toHaveLength(2);
    });

    it("a skipped rule (end test) is not a run and does not age the strikes", () => {
        const { rule } = fresh("/(\\d+)$/", "instant");
        const slow = scriptedClock([RULE_SLOW_MS + 1]);
        matchPatterns("a1", [rule], "instant", slow);
        for (let i = 0; i < RULE_STRIKE_WINDOW * 2; i++) matchPatterns("a" + String(i) + "z", [rule], "instant", slow); // cannot end with z
        expect(rule.health.runs).toBe(1);
    });

    // -- Round 3: starvation is visible -----------------------------------------------------------------------------

    it("patternHealth: switched-off rules and how many keystrokes the deadline cut", () => {
        const t = steppingClock(RULE_SLOW_MS);
        const rules = ["/aa$/", "/bb$/", "/cc$/", "/dd$/", "/ee$/", "/ff$/"].map((source, i) => fresh(source, "separator", `r${String(i)}`));
        const all = set(...rules.map((r) => r.rule));
        expect(patternHealth(all)).toEqual({ switchedOff: [], deadlineHits: 0 });
        matchPatterns("x ff", all.rules, "separator", t.clock);
        matchPatterns("x ff", all.rules, "separator", t.clock);
        expect(patternHealth(all)).toEqual({ switchedOff: [], deadlineHits: 2 });
    });

    it("the deadline is counted once per cut keystroke, not per skipped rule, and only when a rule was really skipped", () => {
        const t = steppingClock(RULE_SLOW_MS);
        const rules = ["/aa$/", "/bb$/", "/cc$/", "/dd$/", "/ee$/"].map((source, i) => fresh(source, "separator", `r${String(i)}`));
        const all = set(...rules.map((r) => r.rule));
        // Five rules spend exactly 10 ms: the budget is crossed after the last one, nothing was skipped.
        matchPatterns("x ee", all.rules, "separator", t.clock);
        expect(patternHealth(all).deadlineHits).toBe(0);
        // A sixth rule would have been skipped.
        const six = set(...all.rules, fresh("/ff$/", "separator", "r5").rule);
        matchPatterns("x ff", six.rules, "separator", t.clock);
        expect(patternHealth(six).deadlineHits).toBe(1);
    });

    it("a rule that is switched off, or has no text to run on, is not a starved rule", () => {
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const t = steppingClock(9);
        const first = fresh("/aa$/", "separator", "first");
        const off = fresh("/bb$/", "separator", "off");
        off.rule.health.switchedOff = "off";
        const instantOnly = fresh("/cc$/", "instant", "needs-caret");
        matchPatternsInOrder({ beforeSeparator: "zz" }, [first.rule, off.rule, instantOnly.rule], t.clock);
        expect(patternHealth(set(first.rule, off.rule, instantOnly.rule)).deadlineHits).toBe(0);
        vi.restoreAllMocks();
    });

    it("a rule the matcher would skip anyway (an instant end character that cannot end it) is not a starved rule", () => {
        const t = steppingClock(9);
        const first = fresh(String.raw`/(\d+)b$/`, "instant", "first");
        const skipped = fresh(String.raw`/(\d+)!$/`, "instant", "skipped");
        // The first rule runs (the line ends in "b") and spends 9 ms; the second could never end with "b".
        matchPatternsInOrder({ atCaret: "hello ab" }, [first.rule, skipped.rule], t.clock);
        expect(skipped.exec).not.toHaveBeenCalled();
        expect(patternHealth(set(first.rule, skipped.rule)).deadlineHits).toBe(0);
        // The same two rules, but the second can end with the typed character: now it was really cut.
        const cut = fresh(String.raw`/(\d+)b$/`, "instant", "cut");
        matchPatternsInOrder({ atCaret: "hello ab" }, [fresh(String.raw`/(\d+)b$/`, "instant", "a").rule, cut.rule], t.clock);
        expect(patternHealth(set(cut.rule)).deadlineHits).toBe(1);
    });

    it("a rule with ^ on a line longer than the window is not a starved rule either", () => {
        const t = steppingClock(9);
        const first = fresh("/(\\d+)b$/", "separator", "first");
        const bol = fresh("/^(\\d+)b$/", "separator", "bol");
        const long = "x".repeat(PATTERN_TAIL_LIMIT + 5) + "1b";
        matchPatternsInOrder({ beforeSeparator: long }, [first.rule, bol.rule], t.clock);
        expect(patternHealth(set(first.rule, bol.rule)).deadlineHits).toBe(0);
        // On a short line the ^ rule would have run, so skipping it is a cut.
        const shortBol = fresh("/^(\\d+)b$/", "separator", "short");
        matchPatternsInOrder({ beforeSeparator: "xb" }, [fresh("/(\\d+)b$/", "separator", "a").rule, shortBol.rule], t.clock);
        expect(patternHealth(set(shortBol.rule)).deadlineHits).toBe(1);
    });

    it("NO_PATTERNS has a clean bill of health", () => {
        expect(patternHealth(NO_PATTERNS)).toEqual({ switchedOff: [], deadlineHits: 0 });
    });

    // -- Round 6: compile-scale cost on a cold exec switches the rule off at once ----------------------------------------

    describe("compile backstop", () => {
        const reasonOf = (id: string, rules: CompiledRule[]): string | undefined =>
            patternHealth(set(...rules)).switchedOff.find((r) => r.id === id)?.reason;

        it("a first exec over RULE_COMPILE_LIMIT_MS switches the rule off, without a re-run, and says why", () => {
            vi.spyOn(console, "warn").mockImplementation(() => undefined);
            expect(RULE_COMPILE_LIMIT_MS).toBe(50);
            const { rule, exec } = fresh("/(\\d+)$/");
            const hit = matchPatterns("a1", [rule], "separator", scriptedClock([2600, 0.01]));
            // The exec itself was right, so this keystroke still expands.
            expect(hit?.captures[1]).toBe("1");
            expect(exec).toHaveBeenCalledTimes(1);
            expect(reasonOf("r", [rule])).toBe("Switched off: too expensive to compile (2600 ms).");
            expect(patternHealth(set(rule)).switchedOff).toEqual([{ id: "r", reason: "Switched off: too expensive to compile (2600 ms)." }]);
            // From now on the rule is skipped, so it cannot cost another pause.
            matchPatterns("a2", [rule], "separator", scriptedClock([0.01]));
            expect(exec).toHaveBeenCalledTimes(1);
            vi.restoreAllMocks();
        });

        it("a first exec at or under the limit does not switch the rule off (sum of its samples exactly at the limit)", () => {
            const { rule } = fresh("/(\\d+)$/");
            // 50 ms, then two re-runs at 0 ms: the run costs 50 ms in all, which is not over the limit.
            matchPatterns("a1", [rule], "separator", scriptedClock([RULE_COMPILE_LIMIT_MS, 0]));
            expect(switchedOffRules(set(rule))).toEqual([]);
        });

        it("the second exec (tier-up compile) counts as cold too", () => {
            vi.spyOn(console, "warn").mockImplementation(() => undefined);
            const { rule } = fresh("/(\\d+)$/");
            matchPatterns("a1", [rule], "separator", scriptedClock([0.01, 80, 0.01]));
            matchPatterns("a2", [rule], "separator", scriptedClock([80]));
            expect(reasonOf("r", [rule])).toBe("Switched off: too expensive to compile (80 ms).");
            vi.restoreAllMocks();
        });

        // Round 7: a cold run is judged by the SUM of its samples, not its first sample alone.
        it("regression: a cold run of 43.7 ms and a re-run of 48.9 ms is switched off (each under the limit, 92.6 ms in all)", () => {
            vi.spyOn(console, "warn").mockImplementation(() => undefined);
            const { rule, exec } = fresh("/(\\d+)$/");
            const hit = matchPatterns("a1", [rule], "separator", scriptedClock([43.7, 48.9, 0.01]));
            expect(hit?.captures[1]).toBe("1");
            expect(exec).toHaveBeenCalledTimes(3);
            expect(reasonOf("r", [rule])).toBe("Switched off: too expensive to compile (93 ms).");
            // And it is skipped from now on.
            matchPatterns("a2", [rule], "separator", scriptedClock([0.01]));
            expect(exec).toHaveBeenCalledTimes(3);
            vi.restoreAllMocks();
        });

        it("the sum counts on the second and the third exec too, and just over the limit is over", () => {
            vi.spyOn(console, "warn").mockImplementation(() => undefined);
            for (const warmUp of [1, 2]) {
                const { rule } = fresh("/(\\d+)$/");
                const cheap = scriptedClock([0.01]);
                for (let i = 0; i < warmUp; i++) matchPatterns("a" + String(i), [rule], "separator", cheap);
                expect(switchedOffRules(set(rule))).toEqual([]);
                matchPatterns("a9", [rule], "separator", scriptedClock([RULE_COMPILE_LIMIT_MS, 0.5, 0]));
                expect(reasonOf("r", [rule]), `after ${String(warmUp)} cheap runs`).toBe("Switched off: too expensive to compile (51 ms).");
            }
            vi.restoreAllMocks();
        });

        it("a slow first sample whose re-runs are fast and whose sum is under the limit stays on", () => {
            const { rule } = fresh("/(\\d+)$/");
            matchPatterns("a1", [rule], "separator", scriptedClock([30, 5, 0.01]));
            expect(switchedOffRules(set(rule))).toEqual([]);
        });

        // Cold means the run count (1st, 2nd, 3rd exec), not the text: V8 recompiles when the string representation
        // changes, and an ASCII line sliced from a two-byte note is one such case, so no content test can find it.
        it("the third exec is cold whatever the text is; the fourth is not", () => {
            vi.spyOn(console, "warn").mockImplementation(() => undefined);
            const third = fresh("/(\\d+)$/");
            const cheap = scriptedClock([0.01]);
            matchPatterns("a1", [third.rule], "separator", cheap);
            matchPatterns("a2", [third.rule], "separator", cheap);
            matchPatterns("a3", [third.rule], "separator", scriptedClock([120, 0.01]));
            expect(reasonOf("r", [third.rule])).toBe("Switched off: too expensive to compile (120 ms).");

            const fourth = fresh("/(\\d+)$/");
            for (const text of ["a1", "a2", "a3"]) matchPatterns(text, [fourth.rule], "separator", cheap);
            matchPatterns("a4", [fourth.rule], "separator", scriptedClock([120, 0.01]));
            expect(switchedOffRules(set(fourth.rule))).toEqual([]);
            vi.restoreAllMocks();
        });

        it("text beyond Latin-1 is no longer special: a Cyrillic line on the 5th exec is a warm exec", () => {
            const { rule } = fresh("/(\\d+)$/");
            const cheap = scriptedClock([0.01]);
            for (const text of ["a1", "b2", "c3", "d4"]) matchPatterns(text, [rule], "separator", cheap);
            matchPatterns("я1", [rule], "separator", scriptedClock([120, 0.01]));
            expect(switchedOffRules(set(rule))).toEqual([]);
        });

        it("a compile pause is paid once: later Cyrillic execs are not cold", () => {
            const { rule } = fresh("/(\\d+)$/");
            matchPatterns("я1", [rule], "separator", scriptedClock([30, 0.01]));
            matchPatterns("я2", [rule], "separator", scriptedClock([0.01]));
            matchPatterns("я3", [rule], "separator", scriptedClock([0.01]));
            // A warm 60 ms spike (a GC pause) on a normal rule, long after its compiles: the rule stays on.
            matchPatterns("я4", [rule], "separator", scriptedClock([60, 0.01]));
            matchPatterns("я5", [rule], "separator", scriptedClock([60, 0.01]));
            expect(switchedOffRules(set(rule))).toEqual([]);
        });

        it("a normal rule with one 60 ms spike on a later exec stays on (and strikes only the slow-sample rule)", () => {
            const { rule } = fresh("/(\\d+)$/");
            const keystrokes = 10;
            // Exec 7 spikes to 60 ms, re-runs are fast: one slow keystroke is no strike set, let alone a compile cost.
            const costs = Array.from({ length: keystrokes }, (_, i) => (i === 6 ? [60, 0.01] : [0.01])).flat();
            const clock = scriptedClock(costs);
            for (let i = 0; i < keystrokes; i++) matchPatterns("a" + String(i), [rule], "separator", clock);
            expect(switchedOffRules(set(rule))).toEqual([]);
        });

        it("only the rule whose own exec was expensive is switched off", () => {
            vi.spyOn(console, "warn").mockImplementation(() => undefined);
            const a = fresh("/a(\\d+)$/", "separator", "a");
            const b = fresh("/b(\\d+)$/", "separator", "b");
            // Rule a's first exec is cheap, rule b's is the 90 ms one.
            expect(matchPatterns("b9", [a.rule, b.rule], "separator", scriptedClock([0.01, 90, 0.01]))?.rule.id).toBe("b");
            expect(patternHealth(set(a.rule, b.rule)).switchedOff.map((r) => r.id)).toEqual(["b"]);
            vi.restoreAllMocks();
        });

        it("a rule skipped by its end-character test is not run, so it cannot be cold", () => {
            const { rule, exec } = fresh("/(\\d+)$/", "instant");
            matchPatterns("ab", [rule], "instant", scriptedClock([5000]));
            expect(exec).not.toHaveBeenCalled();
            expect(switchedOffRules(set(rule))).toEqual([]);
        });
    });

    it("the default clock is the real one: a normal match works without injecting anything", () => {
        expect(matchPatterns("x 12", [compiled(String.raw`/(\d+)$/`)], "separator")?.captures[1]).toBe("12");
    });

    it("NO_PATTERNS has nothing switched off", () => {
        expect(switchedOffRules(NO_PATTERNS)).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// The net under the corpus: random accepted patterns must not be able to hang
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
    let a = seed;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Why this shape: a JS `exec` cannot be interrupted from the same thread, so a test that runs a hanging pattern
 * hangs the suite. `node:vm` with `timeout` (1.5 s: an accepted pattern takes microseconds, a real blow-up seconds to
 * minutes; the margin keeps a loaded CI box from failing a fast one) runs the script under a watchdog that terminates it (irregexp checks for the interrupt while it
 * backtracks), so a pattern the gate wrongly accepts shows up as a failing test, not as a stuck run. No child
 * process, no worker, no flaky kill timers; the generator is seeded, so a failure names a pattern that reproduces.
 *
 * The generator is weighted toward what hangs: the same alternation group repeated many times (`(?:a|aa)` x24,
 * `(?:a|)` x30), alone and next to unbounded quantifiers, lookbehinds, `i` (case folding), both modes.
 * Mutation check (recorded in the checker report): removing the alternation budget (`boundedChoices *=
 * alts.length`) makes this test fail.
 */
describe("patterns: no accepted pattern can hang (seeded, randomized)", () => {
    const ATOMS = ["a", "b", "x", "u", "c", "k", "s", String.raw`\w`, String.raw`\d`, String.raw`\s`, ".", "[ab]", "[^a]", String.raw`\.`, String.raw`\u0061`, String.raw`\x61`, "ſ", "K"];
    // An emoji as plain text (two atoms without `u`) and a Cyrillic class: what a person may write instead of the refused `u` and astral classes.
    const EXTRA_ATOMS = ["😀", "[а-яё]", String.raw`[a\d]`];
    const QUANTS = ["", "", "", "?", "*", "+", "{1,3}", "{0,5}", "{2,}", "{1,10}", "{2}", "??", "+?", "{0,40}"];
    /** Overlapping alternatives: each way of splitting the input is a different path. */
    const HOT_GROUPS = [
        "(?:a|aa)", "(?:a|)", "(a|ab)", "(?:a|a)", String.raw`(?:\w|\w\w)`, "(?:ab|a|b)", "(?:x|xx|)", String.raw`(?:\s|\s\s)`,
        "(?:[ab]|[ab][ab])", String.raw`(?:\w|)`,
    ];
    const LOOKBEHINDS = ["(?<=ab)", "(?<!k)", String.raw`(?<=\w\w)`, "(?<!kk)", String.raw`(?<=^|\s)`, String.raw`(?<=a|b)`, "(?<=abcdefgh)", "(?<!abcdefghi)"];

    function generate(rand: () => number): string {
        const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)] as T;
        const atoms = [...ATOMS, ...EXTRA_ATOMS];
        const atom = (): string => (rand() < 0.4 ? pick(["a", String.raw`\w`, "[ab]", "."]) : pick(atoms)) + pick(QUANTS);
        const sequence = (depth: number): string => {
            const length = 1 + Math.floor(rand() * (depth === 0 ? 7 : 3));
            let out = "";
            for (let i = 0; i < length; i++) out += term(depth);
            if (depth === 0) {
                // The known hangs are one term repeated: copy a term many times, or a hot alternation group.
                const r = rand();
                if (r < 0.3) out += term(1).repeat(2 + Math.floor(rand() * 30));
                else if (r < 0.7) out += pick(HOT_GROUPS).repeat(2 + Math.floor(rand() * 40)) + (rand() < 0.5 ? "" : atom());
                if (rand() < 0.4) out += pick(LOOKBEHINDS);
                if (rand() < 0.5) out += term(0);
            }
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
            if (rand() < 0.08) return pick(LOOKBEHINDS);
            if (rand() < 0.12) return pick(HOT_GROUPS) + pick(QUANTS);
            return atom();
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
        "a".repeat(32) + "x" + "a".repeat(31) + "!",
        "x".repeat(64),
        // Case folding: the long S, the Kelvin sign, astral characters.
        "ſ".repeat(62) + "a!",
        "x".repeat(63) + "K",
        "k".repeat(63) + "K",
        "😀".repeat(31) + "!",
        "s".repeat(31) + "ſ".repeat(31) + "!",
    ];

    it("every accepted random pattern finishes on adversarial 64-character lines", () => {
        const rand = mulberry32(0x5115);
        let accepted = 0;
        for (let i = 0; i < 6000; i++) {
            const flags = ["", "", "i"][Math.floor(rand() * 3)] ?? "";
            const body = generate(rand);
            const mode = rand() < 0.5 ? "separator" : "instant";
            const result = compileRule(rule(`/${body}/${flags}`, "x", { mode }));
            if (!result.ok) continue;
            accepted++;
            for (const text of ADVERSARIAL) {
                // The time bound: throws ERR_SCRIPT_EXECUTION_TIMEOUT after 1.5 s.
                try {
                    execWithin(result.rule.re, text);
                } catch (err) {
                    throw new Error(`/${body}/${flags} (${mode}) hung on ${JSON.stringify(text.slice(0, 20))}...: ${String(err)}`, { cause: err });
                }
            }
        }
        // The test must not be vacuous: a good share of the random patterns passes the gate.
        expect(accepted).toBeGreaterThan(300);
    }, 120_000);

    it("the generator does produce the shapes that hang when ungated (it is not testing only easy ones)", () => {
        const rand = mulberry32(0x5115);
        let hotRepeated = 0;
        for (let i = 0; i < 6000; i++) {
            rand(); // the flag pick of the test above, to stay on the same sequence
            const body = generate(rand);
            if (HOT_GROUPS.some((g) => body.includes(g.repeat(12)))) hotRepeated++;
        }
        expect(hotRepeated).toBeGreaterThan(100);
    });
});

/**
 * Seeded invariant (round 2): whenever a rule's regex matches at the end of a text, `canEndWith` says the last
 * character can end a match. It catches a parser that disagrees with V8 about where an atom ends (legacy octal
 * `\041` was read as `\0`, `4`, `1`: the end test then excluded "!", which V8 matches).
 */
describe("patterns: canEndWith never excludes a character the regex matches (seeded)", () => {
    const ATOMS = ["a", "b", "A", "k", "1", "!", String.raw`\d`, String.raw`\w`, "[ab]", ".", String.raw`\.`, String.raw`\x41`, String.raw`\u0061`, String.raw`\0`, String.raw`\041`, String.raw`\01`, "4", "[^a]", "ſ", "K", "😀", "[а-яё]", String.raw``];
    const QUANTS = ["", "", "?", "*", "+", "{1,2}"];
    const TEXT_CHARS = ["a", "b", "A", "B", "k", "K", "1", "!", ".", " ", "ſ", "K", "😀", "😁", "\u0000", "é", "s", "S", "\u0001", "4"];

    it("holds for random accepted rules on random texts (both modes, with and without i)", () => {
        const rand = mulberry32(0xc0de);
        const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)] as T;
        let matched = 0;
        for (let i = 0; i < 5000; i++) {
            const flags = pick(["", "i"]);
            const atoms = ATOMS;
            const length = 1 + Math.floor(rand() * 4);
            let body = "";
            for (let j = 0; j < length; j++) {
                body += rand() < 0.15 ? `(?:${pick(atoms)}|${pick(atoms)})${pick(QUANTS)}` : pick(atoms) + pick(QUANTS);
            }
            const result = compileRule(rule(`/${body}$/${flags}`, "x", { mode: pick(["instant", "separator"] as const) }));
            if (!result.ok) continue;
            const r = result.rule;
            for (let k = 0; k < 20; k++) {
                let text = "";
                const n = 1 + Math.floor(rand() * 6);
                for (let c = 0; c < n; c++) text += pick(TEXT_CHARS);
                r.re.lastIndex = 0;
                const m = r.re.exec(text);
                if (!m || m[0].length === 0) continue;
                matched++;
                // A rule ends at a code unit (the `u` flag is refused).
                expect(canEndWith(r, text.charAt(text.length - 1)), `/${body}$/${flags} matches ${JSON.stringify(text)}`).toBe(true);
            }
        }
        expect(matched).toBeGreaterThan(500);
    }, 30_000);

    // Round 7: whatever random accepted rule and text (whole emoji only) come in, a match never starts on a low half
    // or ends on a high half, so replacing it cannot leave a lone surrogate behind.
    it("a match never splits an emoji (random accepted rules, texts with emoji, both modes)", () => {
        const rand = mulberry32(0x5eed);
        const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)] as T;
        const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
        let matched = 0;
        for (let i = 0; i < 4000; i++) {
            const length = 1 + Math.floor(rand() * 3);
            let body = "";
            for (let j = 0; j < length; j++) body += pick(ATOMS) + pick(QUANTS);
            const mode = pick(["instant", "separator"] as const);
            const result = compileRule(rule(`/${body}$/${pick(["", "i"])}`, "x", { mode }));
            if (!result.ok) continue;
            for (let k = 0; k < 20; k++) {
                let text = "";
                const n = 1 + Math.floor(rand() * 6);
                for (let c = 0; c < n; c++) text += pick(TEXT_CHARS);
                const m = matchPatterns(text, [result.rule], mode);
                if (!m) continue;
                matched++;
                const after = text.slice(0, m.index) + "<R>" + text.slice(m.end);
                expect(lone.test(after), `/${body}$/ ${mode} on ${JSON.stringify(text)} -> ${JSON.stringify(after)}`).toBe(false);
            }
        }
        expect(matched).toBeGreaterThan(300);
    }, 30_000);
});
