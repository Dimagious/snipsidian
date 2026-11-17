import { describe, it, expect } from "vitest";
import {
    findInvisibleTriggerChar,
    isBadTrigger,
    matchesTriggerCharset,
    normalizeTrigger,
    TRIGGER_CHARSET_RE,
} from "./triggers";

describe("triggers.normalizeTrigger", () => {
    it("trims whitespace", () => {
        expect(normalizeTrigger("  fn  ")).toBe("fn");
    });

    it("strips leading colons (Espanso convention)", () => {
        expect(normalizeTrigger(":todo")).toBe("todo");
        expect(normalizeTrigger("::nested")).toBe("nested");
    });

    it("strips trailing colons (Espanso `:foo:` convention)", () => {
        expect(normalizeTrigger("smile:")).toBe("smile");
        expect(normalizeTrigger("fire::")).toBe("fire");
    });

    it("strips both ends — `:foo:` becomes `foo`", () => {
        expect(normalizeTrigger(":smile:")).toBe("smile");
        expect(normalizeTrigger(":fire:")).toBe("fire");
        expect(normalizeTrigger("  :heart:  ")).toBe("heart");
    });

    it("leaves interior colons alone (rare, but valid e.g. `ns:trigger`)", () => {
        expect(normalizeTrigger("ns:trigger")).toBe("ns:trigger");
        expect(normalizeTrigger(":ns:trigger:")).toBe("ns:trigger");
    });

    it("returns empty string for pure-colon input", () => {
        expect(normalizeTrigger(":::")).toBe("");
        expect(normalizeTrigger("")).toBe("");
    });
});

describe("triggers.isBadTrigger", () => {
    it("rejects empty or triggers containing separators/punctuation", () => {
        expect(isBadTrigger("")).toBe(true);
        expect(isBadTrigger("a b")).toBe(true);   // space
        expect(isBadTrigger("a.b")).toBe(true);   // dot
        expect(isBadTrigger("a/b")).toBe(true);   // slash
        expect(isBadTrigger("a\\b")).toBe(true);  // backslash
        expect(isBadTrigger("$x")).toBe(true);    // placeholder syntax
        expect(isBadTrigger("(")).toBe(true);
        expect(isBadTrigger("a:b")).toBe(true);   // colon in middle
    });
    it("accepts simple word-like triggers (latin or unicode letters)", () => {
        expect(isBadTrigger("ab")).toBe(false);
        expect(isBadTrigger("пр")).toBe(false);   // cyrillic is allowed
        expect(isBadTrigger("_ab")).toBe(false);  // underscore ok
        expect(isBadTrigger("a1")).toBe(false);
    });
    it("accepts triggers starting with colon", () => {
        expect(isBadTrigger(":plot")).toBe(false);
        expect(isBadTrigger(":scene")).toBe(false);
        expect(isBadTrigger(":character")).toBe(false);
        expect(isBadTrigger(":email")).toBe(false);
    });
    // B-171: symbol triggers; also fixes `--` (valid in the catalog) being un-editable.
    it("accepts hyphen and symbol triggers (B-171)", () => {
        for (const ok of ["--", "a-b", "->", "<-", "<->", "=>", "<=", ">=", "+-", "~=", "<<", ">>", "&x", "*x", "^2", "-x", ":->", "||"]) {
            expect(isBadTrigger(ok), ok).toBe(false);
        }
    });
    it("rejects single structural chars - + * > | but not multi-char forms", () => {
        for (const bad of ["-", "+", "*", ">", "|"]) expect(isBadTrigger(bad), bad).toBe(true);
        for (const ok of ["--", "->", ">=", "<->", "**"]) expect(isBadTrigger(ok), ok).toBe(false);
    });
    it("still rejects separators, slash, backslash and $ mixed with symbols", () => {
        for (const bad of ["->/", "<\\=", "$->", "- >", "->.", "a:b->"]) {
            expect(isBadTrigger(bad), bad).toBe(true);
        }
    });
});

describe("triggers.TRIGGER_CHARSET_RE", () => {
    it("accepts the documented charset", () => {
        for (const ok of ["->", "--", "<->", ":smile", "a_b", "ABC123", "&x", "*x", "|", ">=", "-x", "~=", "+-", "^2"]) {
            expect(TRIGGER_CHARSET_RE.test(ok), ok).toBe(true);
        }
    });
    it("rejects /, backslash, $, whitespace, separators and non-ASCII", () => {
        for (const bad of ["a/b", "a\\b", "$x", "a b", "a.b", "a,b", "(", "a'b", "пр", "", "a\n"]) {
            expect(TRIGGER_CHARSET_RE.test(bad), JSON.stringify(bad)).toBe(false);
        }
    });
});

describe("triggers.matchesTriggerCharset", () => {
    it("defaults to the ASCII allowlist (allowUnicodeLetters is off)", () => {
        expect(matchesTriggerCharset("abc")).toBe(true);
        expect(matchesTriggerCharset("прив")).toBe(false);
        expect(matchesTriggerCharset("café")).toBe(false);
        expect(matchesTriggerCharset("прив", false)).toBe(false);
    });

    it("accepts Unicode letters, marks and digits when opted in", () => {
        expect(matchesTriggerCharset("прив", true)).toBe(true);
        expect(matchesTriggerCharset("cafe\u0301", true)).toBe(true);
        expect(matchesTriggerCharset("a\u0903", true)).toBe(true); // spacing mark
    });

    it.each([
        "\u115F", "\u1160", "\u3164", "\uFFA0", "\u17B4", "\u17B5", "\u{16FE4}",
        "\u0301", "\u0301a", "a\u20DD", "a\u034F", "a\uFE0F", "a\u180B", "a\u{E0100}",
        "a\u180F", "a\u{E01EF}", "a\u{1107F}", "a\u{1BC9D}", "a\u{13440}",
    ])("rejects invisible or mark-led %j when opted in", (t) => {
        expect(matchesTriggerCharset(t, true)).toBe(false);
    });
});

describe("triggers.findInvisibleTriggerChar", () => {
    it("names the first invisible code point", () => {
        expect(findInvisibleTriggerChar("a\u200Cb")).toBe("U+200C");
        expect(findInvisibleTriggerChar("a\u200Db")).toBe("U+200D");
        expect(findInvisibleTriggerChar("a\u3164")).toBe("U+3164");
        expect(findInvisibleTriggerChar("a\u{16FE4}")).toBe("U+16FE4");
        expect(findInvisibleTriggerChar("a\u{1107F}")).toBe("U+1107F");
    });

    it("falls back to any format character", () => {
        expect(findInvisibleTriggerChar("при\u00ADвет")).toBe("U+00AD");
        expect(findInvisibleTriggerChar("a\u200Bb")).toBe("U+200B");
        expect(findInvisibleTriggerChar("a\u2060")).toBe("U+2060");
        expect(findInvisibleTriggerChar("a\u202E")).toBe("U+202E");
    });

    it("returns null for visible triggers", () => {
        expect(findInvisibleTriggerChar("прив")).toBeNull();
        expect(findInvisibleTriggerChar("cafe\u0301")).toBeNull();
    });
});
