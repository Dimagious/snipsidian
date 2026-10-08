import { describe, it, expect } from "vitest";
import { textSnippetsDataToSnippets } from "./text-snippets";

/** Build a data.json text from a raw `snippets_file` plus overrides. */
function data(file: string, extra: Record<string, unknown> = {}): string {
    return JSON.stringify({ snippets_file: file, ...extra });
}

describe("textSnippetsDataToSnippets: basics", () => {
    it("imports simple pairs with default markers", () => {
        const r = textSnippetsDataToSnippets(data("brb : be right back\nomw : on my way"));
        expect(r.snippets).toEqual({ brb: "be right back", omw: "on my way" });
        expect(r.skipped).toEqual([]);
        expect(r.warnings).toEqual([]);
    });

    it("keeps ` : ` inside the replacement (joined back, not truncated)", () => {
        const r = textSnippetsDataToSnippets(data("time : Meeting : 10:00 : room 4"));
        expect(r.snippets).toEqual({ time: "Meeting : 10:00 : room 4" });
    });

    it("splits only on the exact ' : ' (a colon without spaces is not a separator)", () => {
        const r = textSnippetsDataToSnippets(data("a:b\nc :d\ne: f"));
        expect(r.snippets).toEqual({});
        expect(r.skipped.map((s) => s.reason)).toEqual([
            "no ' : ' separator",
            "no ' : ' separator",
            "no ' : ' separator",
        ]);
    });

    it("drops empty and whitespace-only lines silently", () => {
        const r = textSnippetsDataToSnippets(data("\n\na : b\n   \n\nc : d\n"));
        expect(r.snippets).toEqual({ a: "b", c: "d" });
        expect(r.skipped).toEqual([]);
    });

    it("handles CRLF line endings", () => {
        const r = textSnippetsDataToSnippets(data("a : one\r\nb : two\r\n"));
        expect(r.snippets).toEqual({ a: "one", b: "two" });
    });

    it("ignores unrelated fields", () => {
        const r = textSnippetsDataToSnippets(data("a : b", { mySetting: 1, other: { x: 1 } }));
        expect(r.snippets).toEqual({ a: "b" });
    });

    it("returns an empty result when neither snippets_file nor snippets exist", () => {
        const r = textSnippetsDataToSnippets("{}");
        expect(r).toEqual({ snippets: {}, skipped: [], warnings: [] });
    });

    it("normalizes the trigger (trim + colon strip)", () => {
        const r = textSnippetsDataToSnippets(data("  :todo:  : - [ ] task"));
        expect(r.snippets).toEqual({ todo: "- [ ] task" });
    });
});

describe("textSnippetsDataToSnippets: records and newline marker", () => {
    it("joins a record continued after $nl$ + raw newline into a multi-line replacement", () => {
        const r = textSnippetsDataToSnippets(data("sig : Best,$nl$\nDima$nl$\nSnipsy\nnext : x"));
        expect(r.snippets).toEqual({ sig: "Best,\nDima\nSnipsy", next: "x" });
    });

    it("turns an inline $nl$ (no raw newline) into a newline", () => {
        const r = textSnippetsDataToSnippets(data("two : a$nl$b"));
        expect(r.snippets).toEqual({ two: "a\nb" });
    });

    it("a $nl$ followed by a raw newline yields ONE newline, not two", () => {
        const r = textSnippetsDataToSnippets(data("x : a$nl$\nb"));
        expect(r.snippets["x"]).toBe("a\nb");
    });

    it("an ordinary record boundary is never part of the replacement", () => {
        const r = textSnippetsDataToSnippets(data("a : one\nb : two"));
        expect(r.snippets["a"]).toBe("one");
    });

    it("a trailing $nl$ at end of file still produces a record", () => {
        const r = textSnippetsDataToSnippets(data("a : line$nl$"));
        expect(r.snippets).toEqual({ a: "line\n" });
    });

    it("honours a custom newline marker (and does not treat $nl$ as special)", () => {
        const r = textSnippetsDataToSnippets(
            data("a : x<br>\ny\nb : p$nl$q", { newlineSymbol: "<br>" }),
        );
        expect(r.snippets).toEqual({ a: "x\ny", b: "p$nl$q" });
    });

    it("escapes regex metacharacters in a custom marker", () => {
        const r = textSnippetsDataToSnippets(data("a : x[.*]y", { newlineSymbol: "[.*]" }));
        expect(r.snippets).toEqual({ a: "x\ny" });
    });
});

describe("textSnippetsDataToSnippets: markers", () => {
    it("maps the first $end$ to $|", () => {
        const r = textSnippetsDataToSnippets(data("link : [[$end$]]"));
        expect(r.snippets).toEqual({ link: "[[$|]]" });
        expect(r.warnings).toEqual([]);
    });

    it("removes a second $end$ and warns", () => {
        const r = textSnippetsDataToSnippets(data("two : a$end$b$end$c"));
        expect(r.snippets).toEqual({ two: "a$|bc" });
        expect(r.warnings).toEqual([
            { trigger: "two", message: "extra cursor markers removed, only the first is kept" },
        ]);
    });

    it("maps $pst$ to $clipboard", () => {
        const r = textSnippetsDataToSnippets(data("cp : [$pst$](url)"));
        expect(r.snippets).toEqual({ cp: "[$clipboard](url)" });
    });

    it("with no end marker, maps the FIRST $tb$ to $| and removes the rest (warns)", () => {
        const r = textSnippetsDataToSnippets(data("form : Name: $tb$ Age: $tb$ City: $tb$"));
        expect(r.snippets).toEqual({ form: "Name: $| Age:  City: " });
        expect(r.warnings).toEqual([{ trigger: "form", message: "tab stops removed" }]);
    });

    it("a single $tb$ and no end marker becomes the cursor", () => {
        const r = textSnippetsDataToSnippets(data("one : a$tb$b"));
        expect(r.snippets).toEqual({ one: "a$|b" });
        expect(r.warnings).toEqual([{ trigger: "one", message: "tab stops removed" }]);
    });

    it("with both end and stop markers, the end marker is the cursor and ALL stops are removed", () => {
        const r = textSnippetsDataToSnippets(data("both : $tb$A$end$B$tb$"));
        expect(r.snippets).toEqual({ both: "A$|B" });
        expect(r.warnings).toEqual([{ trigger: "both", message: "tab stops removed" }]);
    });

    it("a custom stop marker also becomes the cursor when there is no end marker", () => {
        const r = textSnippetsDataToSnippets(data("c : x##y##z", { stopSymbol: "##" }));
        expect(r.snippets).toEqual({ c: "x$|yz" });
    });

    it("applies all markers together in one replacement, order-independent", () => {
        const r = textSnippetsDataToSnippets(
            data("all : $tb$A$nl$\n$pst$$end$B$end$"),
        );
        expect(r.snippets).toEqual({ all: "A\n$clipboard$|B" });
        expect(r.warnings.map((w) => w.message).sort()).toEqual([
            "extra cursor markers removed, only the first is kept",
            "tab stops removed",
        ]);
    });

    it("reads custom end/paste/stop markers from data.json", () => {
        const r = textSnippetsDataToSnippets(
            data("a : [[@@]] % ## ~~", {
                endSymbol: "@@",
                pasteSymbol: "%",
                stopSymbol: "##",
                newlineSymbol: "~~",
            }),
        );
        expect(r.snippets).toEqual({ a: "[[$|]] $clipboard  \n" });
        expect(r.warnings).toEqual([{ trigger: "a", message: "tab stops removed" }]);
    });

    it("falls back to defaults for empty or wrong-typed markers", () => {
        const r = textSnippetsDataToSnippets(
            data("a : x$end$y", { endSymbol: "", newlineSymbol: 5, pasteSymbol: null }),
        );
        expect(r.snippets).toEqual({ a: "x$|y" });
    });

    it("does not re-scan produced text: a custom stop marker equal to a placeholder piece stays safe", () => {
        const r = textSnippetsDataToSnippets(data("a : $pst$|", { stopSymbol: "|" }));
        // `|` is the stop marker (-> cursor, no end marker); the produced
        // `$clipboard` is not re-scanned.
        expect(r.snippets).toEqual({ a: "$clipboard$|" });
    });

    it("leaves Snipsy placeholder syntax already in the text untouched", () => {
        const r = textSnippetsDataToSnippets(data("d : today $date and $1 and $|"));
        expect(r.snippets).toEqual({ d: "today $date and $1 and $|" });
        expect(r.warnings).toEqual([]);
    });
});

describe("textSnippetsDataToSnippets: duplicates", () => {
    it("last wins and the earlier one is reported", () => {
        const r = textSnippetsDataToSnippets(data("a : first\nb : x\na : second"));
        expect(r.snippets).toEqual({ a: "second", b: "x" });
        expect(r.skipped).toEqual([{ trigger: "a", reason: "duplicate trigger, later one kept" }]);
    });

    it("treats `:a` and `a` as the same trigger after normalization", () => {
        const r = textSnippetsDataToSnippets(data(":a : one\na : two"));
        expect(r.snippets).toEqual({ a: "two" });
        expect(r.skipped).toHaveLength(1);
    });

    it("a dropped duplicate's warnings do not leak into the report", () => {
        const r = textSnippetsDataToSnippets(data("a : x$tb$\na : y"));
        expect(r.snippets).toEqual({ a: "y" });
        expect(r.warnings).toEqual([]);
    });
});

describe("textSnippetsDataToSnippets: skips", () => {
    it("reports a line without ' : ' with a preview label", () => {
        const r = textSnippetsDataToSnippets(data("just text here\nok : fine"));
        expect(r.snippets).toEqual({ ok: "fine" });
        expect(r.skipped).toEqual([{ trigger: "just text here", reason: "no ' : ' separator" }]);
    });

    it("truncates a long no-separator label", () => {
        const r = textSnippetsDataToSnippets(data("x".repeat(200)));
        expect(r.skipped[0]?.trigger.length).toBeLessThanOrEqual(41);
    });

    it("skips triggers with spaces, with a reason, without failing the rest", () => {
        const r = textSnippetsDataToSnippets(data("two words : x\ngood : y"));
        expect(r.snippets).toEqual({ good: "y" });
        expect(r.skipped).toHaveLength(1);
        expect(r.skipped[0]?.trigger).toBe("two words");
        expect(r.skipped[0]?.reason).toContain("spaces");
    });

    it("skips separators, '/', '$' and non-ASCII triggers", () => {
        const r = textSnippetsDataToSnippets(
            data("a.b : 1\na/b : 2\n$x : 3\nпривет : 4\ncafé : 5\nok : 6"),
        );
        expect(r.snippets).toEqual({ ok: "6" });
        expect(r.skipped.map((s) => s.trigger)).toEqual(["a.b", "a/b", "$x", "привет", "café"]);
    });

    it("skips a lone structural symbol but accepts multi-char symbol triggers", () => {
        const r = textSnippetsDataToSnippets(data("- : a\n-> : arrow\n>= : ge"));
        expect(r.snippets).toEqual({ "->": "arrow", ">=": "ge" });
        expect(r.skipped).toHaveLength(1);
        expect(r.skipped[0]?.reason).toContain("Markdown");
    });

    it("skips a trigger longer than 50 characters", () => {
        const r = textSnippetsDataToSnippets(data(`${"a".repeat(51)} : x\n${"b".repeat(50)} : y`));
        expect(Object.keys(r.snippets)).toEqual(["b".repeat(50)]);
        expect(r.skipped[0]?.reason).toContain("50");
    });

    it("skips the upstream default sample record, but only on an exact match", () => {
        const sample = "snippets : It is an obsidian plugin, that replaces your selected text.";
        const r = textSnippetsDataToSnippets(data(`${sample}\nreal : x`));
        expect(r.snippets).toEqual({ real: "x" });
        expect(r.skipped).toEqual([
            { trigger: "snippets", reason: "sample snippet from the Text Snippets plugin" },
        ]);
        const edited = textSnippetsDataToSnippets(data("snippets : my own text"));
        expect(edited.snippets).toEqual({ snippets: "my own text" });
        const other = textSnippetsDataToSnippets(
            data("sn : It is an obsidian plugin, that replaces your selected text."),
        );
        expect(Object.keys(other.snippets)).toEqual(["sn"]);
    });

    it("labels an empty trigger by its replacement, not a leading ': '", () => {
        const r = textSnippetsDataToSnippets(data(" : hello"));
        expect(r.skipped[0]?.trigger.startsWith(":")).toBe(false);
        expect(r.skipped[0]?.trigger).toContain("hello");
    });

    it("skips an empty trigger and an empty replacement", () => {
        const r = textSnippetsDataToSnippets(data(" : x\nempty : \nonlytb : $tb$"));
        expect(r.snippets).toEqual({});
        expect(r.skipped.map((s) => s.reason)).toEqual([
            "empty trigger",
            "empty replacement",
            "empty replacement",
        ]);
    });

    it("skips a replacement over the install limit", () => {
        const r = textSnippetsDataToSnippets(data(`big : ${"x".repeat(10001)}\nok : y`));
        expect(r.snippets).toEqual({ ok: "y" });
        expect(r.skipped[0]?.reason).toContain("10000");
    });
});

describe("textSnippetsDataToSnippets: prototype keys (S-008)", () => {
    it("imports `constructor`, `toString` and `__proto__` triggers as plain data", () => {
        const r = textSnippetsDataToSnippets(
            data("constructor : c\ntoString : t\n__proto__ : p\nhasOwnProperty : h"),
        );
        expect(Object.getPrototypeOf(r.snippets)).toBe(Object.prototype);
        expect(Object.keys(r.snippets).sort()).toEqual(["__proto__", "constructor", "hasOwnProperty", "toString"]);
        expect(Object.prototype.hasOwnProperty.call(r.snippets, "__proto__")).toBe(true);
        expect(Object.entries(r.snippets).find(([k]) => k === "__proto__")?.[1]).toBe("p");
        expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    });

    it("a repeated `__proto__` trigger is deduplicated, not treated as a prototype write", () => {
        const r = textSnippetsDataToSnippets(data("__proto__ : a\n__proto__ : b"));
        expect(Object.entries(r.snippets)).toEqual([["__proto__", "b"]]);
        expect(r.skipped).toHaveLength(1);
    });
});

describe("textSnippetsDataToSnippets: snippets cache fallback", () => {
    it("uses `snippets` only when snippets_file is absent", () => {
        const r = textSnippetsDataToSnippets(
            JSON.stringify({ snippets: ["a : one", "b : two$end$", "bad line"] }),
        );
        expect(r.snippets).toEqual({ a: "one", b: "two$|" });
        expect(r.skipped).toHaveLength(1);
    });

    it("prefers snippets_file over a stale `snippets` cache", () => {
        const r = textSnippetsDataToSnippets(
            JSON.stringify({ snippets_file: "new : fresh", snippets: ["old : stale"] }),
        );
        expect(r.snippets).toEqual({ new: "fresh" });
    });

    it("an empty snippets_file is the truth: nothing is imported from the cache", () => {
        const r = textSnippetsDataToSnippets(JSON.stringify({ snippets_file: "", snippets: ["old : stale"] }));
        expect(r.snippets).toEqual({});
    });
});

describe("textSnippetsDataToSnippets: malformed input", () => {
    it("throws a clear error on invalid JSON", () => {
        expect(() => textSnippetsDataToSnippets("{not json")).toThrow(/not valid JSON/);
    });

    it("throws when the top level is not an object", () => {
        expect(() => textSnippetsDataToSnippets("[]")).toThrow(/JSON object/);
        expect(() => textSnippetsDataToSnippets("null")).toThrow(/JSON object/);
        expect(() => textSnippetsDataToSnippets('"x"')).toThrow(/JSON object/);
    });

    it("throws when snippets_file is not a string", () => {
        expect(() => textSnippetsDataToSnippets(JSON.stringify({ snippets_file: 5 }))).toThrow(/snippets_file/);
        expect(() => textSnippetsDataToSnippets(JSON.stringify({ snippets_file: ["a : b"] }))).toThrow(/snippets_file/);
    });

    it("throws when the snippets cache is not a list of strings", () => {
        expect(() => textSnippetsDataToSnippets(JSON.stringify({ snippets: "a : b" }))).toThrow(/'snippets'/);
        expect(() => textSnippetsDataToSnippets(JSON.stringify({ snippets: ["a : b", 3] }))).toThrow(/'snippets'/);
    });
});
