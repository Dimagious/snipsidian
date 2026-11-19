import { describe, it, expect } from "vitest";
import { convertEspansoRegex } from "./espanso-regex";
import { checkPattern } from "../engine/patterns";

/**
 * ADR-0008, Imports: the Espanso `regex:` to pattern-rule conversion. Every case that is accepted is also run
 * through the real gate (`checkPattern`), so a source built here is one the engine takes in the mode it names.
 */

function ok(regex: string, replacement = "x"): { source: string; mode: string; note?: string } {
    const r = convertEspansoRegex(regex, replacement);
    if (!r.ok) throw new Error(`expected a conversion, got a refusal: ${r.reason}`);
    expect(checkPattern(r.source, r.mode).ok).toBe(true);
    return r;
}

function refused(regex: string, replacement = "x"): string {
    const r = convertEspansoRegex(regex, replacement);
    if (r.ok) throw new Error(`expected a refusal, got ${r.source}`);
    return r.reason;
}

describe("convertEspansoRegex: the dialect", () => {
    it("writes (?P<name> as (?<name> and keeps the rest of the body", () => {
        expect(ok(String.raw`:(?P<word>\w+)-(?P<n>\d)`, "{{word}}{{n}}").source).toBe(String.raw`/:(?<word>\w+)-(?<n>\d)$/`);
    });

    it("leaves a literal (?P< inside a class or after a backslash alone", () => {
        // `\(?P<` is an escaped paren, not a group; the class holds the characters ( ? P <.
        expect(ok(String.raw`\(?P<x`).source).toBe(String.raw`/\(?P<x$/`);
        expect(ok(String.raw`[(?P<]x`).source).toBe(String.raw`/[(?P<]x$/`);
    });

    it("appends the closing $ when the body has none", () => {
        expect(ok("abc").source).toBe("/abc$/");
    });

    it("keeps a trailing $ that is already an anchor, also after an escaped backslash", () => {
        expect(ok("abc$").source).toBe("/abc$/");
        expect(ok(String.raw`abc\\$`).source).toBe(String.raw`/abc\\$/`);
    });

    it("an escaped \\$ at the end is a dollar sign, not an anchor: the anchor is appended", () => {
        expect(ok(String.raw`cost\$`).source).toBe(String.raw`/cost\$$/`);
        // three backslashes: an escaped backslash, then an escaped dollar sign
        expect(ok(String.raw`a\\\$`).source).toBe(String.raw`/a\\\$$/`);
    });

    it("a leading (?i) becomes the flag i", () => {
        expect(ok("(?i)hello").source).toBe("/hello$/i");
        expect(ok("(?i)(?P<a>x)", "{{a}}").source).toBe("/(?<a>x)$/i");
    });

    it("refuses any other inline flag, named", () => {
        for (const regex of ["a(?i)b", "(?s)a", "(?i:a)b", "(?-i)a", "(?ix)a", "(?i)(?s)a"]) {
            expect(refused(regex)).toContain("inline flag");
        }
    });

    it("refuses class syntax JS would read differently: [[:alpha:]], nested classes, &&, --, ~~, a ] first", () => {
        for (const regex of ["[[:alpha:]]x", "[a-z&&[^b]]x", "[a&&b]x", "[a--b]x", "[a~~b]x", "[]a]x", "[^]a]x"]) {
            expect(refused(regex)).toContain("character class");
        }
    });

    it("accepts the ordinary class forms next to those: ranges, negation, an escaped ] and - at the edge", () => {
        expect(ok("[a-z]x").source).toBe("/[a-z]x$/");
        expect(ok("[^a-z]x").source).toBe("/[^a-z]x$/");
        expect(ok(String.raw`[\]a]x`).source).toBe(String.raw`/[\]a]x$/`);
        expect(ok("[a-]x").source).toBe("/[a-]x$/");
    });
});

describe("convertEspansoRegex: {{name}} in the replacement", () => {
    it("maps {{name}} 1:1 when the regex has that named group", () => {
        const r = ok(String.raw`(?P<who>\w+)!`, "hi {{who}}");
        expect(r.source).toBe(String.raw`/(?<who>\w+)!$/`);
    });

    it("also accepts a group already written (?<name>", () => {
        expect(ok(String.raw`(?<who>\w+)!`, "hi {{who}}").source).toBe(String.raw`/(?<who>\w+)!$/`);
    });

    it("refuses {{1}}: Espanso has no numbered references, in Snipsy it would mean group 1", () => {
        expect(refused(String.raw`(\w+)!`, "{{1}}")).toContain("{{1}}");
    });

    it("refuses {{name}} that is no group of the regex", () => {
        expect(refused(String.raw`(?P<a>\w+)!`, "{{a}} {{b}}")).toContain("{{b}}");
    });

    it("a group named clipboard is refused: {{clipboard}} is the built-in", () => {
        expect(refused(String.raw`(?P<clipboard>\w+)!`, "{{clipboard}}")).toContain("clipboard");
    });

    it("refuses every {{...}} that Espanso reads as a variable but is not exactly {{name}} of a group", () => {
        const g = String.raw`(?P<name>\w+)!`;
        expect(refused(g, "Hello {{ name }}")).toContain("{{ name }}");
        expect(refused(g, "Hello {{name }}")).toContain("{{name }}");
        expect(refused(g, "{{ other }}")).toContain("{{ other }}");
        expect(refused(g, "{{name.sub}}")).toContain("{{name.sub}}");
        expect(refused(g, "{{ clipboard }}")).toContain("{{ clipboard }}");
        expect(refused(g, "{{ 1 }}")).toContain("{{ 1 }}");
        expect(refused(String.raw`(?P<имя>\w+)!`, "{{имя}}")).toContain("{{имя}}");
    });

    it("the exact {{name}} still works next to text that merely has braces", () => {
        expect(ok(String.raw`(?P<name>\w+)!`, "Hello {{name}} {x} {{ }}").source).toBe(String.raw`/(?<name>\w+)!$/`);
    });

    it("a replacement with no references needs no groups", () => {
        expect(ok("abc", "plain text $|").source).toBe("/abc$/");
    });
});

describe("convertEspansoRegex: mode", () => {
    it("imports as instant when the pattern passes the instant gate", () => {
        const r = ok(String.raw`:(?P<w>\w+):`, "[{{w}}]");
        expect(r.mode).toBe("instant");
        expect(r.note).toBeUndefined();
    });

    it("falls back to After a separator, and says why, when only the instant limit is broken", () => {
        const r = ok(String.raw`(\d+)/(\d+)`);
        expect(r.mode).toBe("separator");
        expect(r.note).toBe(
            "Imported as After a separator: an instant rule can have at most 1 open-ended repeat (*, + or {n,}), this pattern has 2.",
        );
    });

    it("refuses what neither mode takes: three open-ended repeats", () => {
        expect(refused(String.raw`\w+\s\w+\s\w+`)).toBe("Use at most 2 open-ended repeats (*, + or {n,}). This one has 3.");
    });
});

describe("convertEspansoRegex: refusals are named with the Patterns page's sentence", () => {
    it("Unicode property escapes", () => {
        expect(refused(String.raw`\p{L}+x`)).toBe("Unicode property classes like \\p{L} aren't supported yet. Use \\w or a range such as [а-яё].");
        expect(refused(String.raw`[\p{L}]x`)).toContain("Unicode property classes");
    });

    it("lookahead", () => {
        expect(refused("x(?=y)")).toBe("Lookahead like (?=x) isn't supported. Nothing follows the caret yet.");
    });

    it("a backreference", () => {
        expect(refused(String.raw`(a)\1`)).toBe("Backreferences like \\1 aren't supported.");
    });

    it("a nested quantifier", () => {
        expect(refused("(a+)+")).toContain("A repeated group can't hold a repeat or a choice");
    });

    it("an escape the engine reads differently (\\A)", () => {
        expect(refused(String.raw`\Aabc`)).toContain("isn't supported");
    });

    it("a reserved group name", () => {
        expect(refused(String.raw`(?P<date>\d)`, "{{date}}")).toContain('"date" is reserved');
    });

    it("a pattern that can match nothing", () => {
        expect(refused("a*")).toContain("empty text");
    });

    it("a body over the 200 character limit", () => {
        expect(refused("a".repeat(250))).toBe("Keep the pattern to 200 characters. This one has 251.");
    });

    it("a replacement over the 10 000 character limit, by the same gate that guards the stored rule", () => {
        expect(refused("abc", "x".repeat(10_001))).toContain("10000");
    });

    it("a replacement with half an emoji", () => {
        expect(refused("abc", "\ud83d")).toContain("half of an emoji");
    });
});
