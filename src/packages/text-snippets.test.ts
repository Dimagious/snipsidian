import { describe, it, expect } from "vitest";
import { textSnippetsDataToSnippets } from "./text-snippets";
import { codeRanges, countTabstops } from "../engine/placeholders";

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

    it("B-243: $tb$ markers become $1, $2, ... in order of appearance", () => {
        const r = textSnippetsDataToSnippets(data("form : Name: $tb$ Age: $tb$ City: $tb$"));
        expect(r.snippets).toEqual({ form: "Name: $1 Age: $2 City: $3" });
        expect(r.warnings).toEqual([]);
    });

    it("a single $tb$ and no end marker becomes $1 (the caret), no warning", () => {
        const r = textSnippetsDataToSnippets(data("one : a$tb$ b"));
        expect(r.snippets).toEqual({ one: "a$1 b" });
        expect(r.warnings).toEqual([]);
    });

    it("stops and an end marker: stops are fields, $end$ is the final stop", () => {
        const r = textSnippetsDataToSnippets(data("both : $tb$ A $tb$ B$end$"));
        expect(r.snippets).toEqual({ both: "$1 A $2 B$|" });
        expect(r.warnings).toEqual([]);
    });

    it("a single stop next to an end marker warns: Snipsy ignores one field", () => {
        const r = textSnippetsDataToSnippets(data("both : $tb$ A$end$"));
        expect(r.snippets).toEqual({ both: "$1 A$|" });
        expect(r.warnings).toEqual([
            { trigger: "both", message: "single tab stop ignored, cursor goes to the end marker" },
        ]);
    });

    it("keeps nine stops and removes the rest with a warning", () => {
        const record = `n : ${Array.from({ length: 11 }, (_, i) => `s${i} $tb$ `).join("")}`;
        const r = textSnippetsDataToSnippets(data(record));
        expect(r.snippets.n).toContain("s8 $9 ");
        expect(r.snippets.n).toContain("s9  s10  ");
        expect(r.snippets.n).not.toContain("$10");
        expect(r.warnings).toEqual([{ trigger: "n", message: "more than 9 tab stops, the extra ones removed" }]);
    });

    it("a stop Snipsy would not read as a field: the first becomes the cursor, the others are removed, numbering stays gap-free", () => {
        const r = textSnippetsDataToSnippets(data("g : a$tb$b $tb$ c $tb$.5 \\$tb$ d $tb$"));
        expect(r.snippets).toEqual({ g: "a$|b $1 c .5 \\ d $2" });
        expect(r.warnings).toEqual([{ trigger: "g", message: "tab stop next to text or a backslash removed" }]);
    });

    it("regression: removing a glued stop re-judges its neighbour ($tb$$tb$abc$end$ leaves no `$1abc`)", () => {
        const r = textSnippetsDataToSnippets(data("a : $tb$$tb$abc$end$"));
        expect(r.snippets).toEqual({ a: "abc$|" });
        expect(r.warnings.map((w) => w.message)).toEqual(["tab stop next to text or a backslash removed"]);
    });

    it("two glued stops: the first is the cursor, the second removed, and the stop before them stays a field", () => {
        const r = textSnippetsDataToSnippets(data("a : $tb$ x $tb$ab$tb$cd $tb$"));
        expect(r.snippets).toEqual({ a: "$1 x $|abcd $2" });
    });

    it("a chain of stops glued to text is removed from the right, with an overflow of ten ahead of it", () => {
        const stops = "$tb$ ".repeat(9);
        const r = textSnippetsDataToSnippets(data(`o : ${stops}$tb$$tb$abc$end$`));
        expect(r.snippets.o).toBe("$1 $2 $3 $4 $5 $6 $7 $8 $9 abc$|");
    });

    it("never emits a $N that the engine would not read as a field", () => {
        // [record, literal $N the source itself holds inside code]
        const records: Array<[string, number]> = [
            ["$tb$$tb$abc$end$", 0],
            ["$tb$$tb$abc", 0],
            ["$tb$$tb$.5 $tb$", 0],
            ["\\$tb$$tb$ x", 0],
            ["$tb$ ".repeat(12) + "$tb$z", 0],
            ["a$tb$b$tb$c$tb$d $tb$ $tb$", 0],
            ["```js$nl$console.log($tb$)$nl$```", 0],
            ["```$tb$$nl$$end$$nl$```", 0],
            ["`$tb$` and $tb$", 0],
            ["use `git $tb$` then $tb$ and $tb$", 0],
            ["`$5` $tb$ $tb$ `$tb$`", 1],
            ["$tb$ $tb$ ```$nl$$tb$$nl$```$nl$$tb$", 0],
        ];
        for (const [i, [record, literalInCode]] of records.entries()) {
            const out = textSnippetsDataToSnippets(data(`t${i} : ${record}`)).snippets[`t${i}`] ?? "";
            const ranges = codeRanges(out);
            const inCode = (at: number): boolean => ranges.some(([from, to]) => at >= from && at < to);
            const hits = [...out.matchAll(/\$[1-9]/g)].map((m) => m.index ?? 0);
            expect(countTabstops(out), out).toBe(hits.filter((at) => !inCode(at)).length);
            expect(hits.filter(inCode).length, out).toBe(literalInCode);
        }
    });

    it("regression: a stop inside a fenced code block is not numbered (the first is the cursor, as at base)", () => {
        const r = textSnippetsDataToSnippets(data("f : ```js$nl$console.log($tb$)$nl$```"));
        expect(r.snippets.f).toBe("```js\nconsole.log($|)\n```");
        expect(r.warnings).toEqual([]);
    });

    it("regression: a lone stop in code with an end marker is removed with a code warning, not 'single tab stop ignored'", () => {
        const r = textSnippetsDataToSnippets(data("f : ```$tb$$nl$$end$$nl$```"));
        expect(r.snippets.f).toBe("```\n$|\n```");
        expect(r.warnings.map((w) => w.message)).toEqual(["tab stop inside code removed"]);
    });

    it("regression: a stop inside inline code is not numbered", () => {
        const a = textSnippetsDataToSnippets(data("a : `$tb$` and $tb$"));
        expect(a.snippets.a).toBe("`$|` and $1");
        const b = textSnippetsDataToSnippets(data("b : use `git $tb$` then $tb$ and $tb$"));
        expect(b.snippets.b).toBe("use `git $|` then $1 and $2");
        expect(b.warnings).toEqual([]);
    });

    it("a second stop in code (cursor already taken) is removed with a code warning", () => {
        const r = textSnippetsDataToSnippets(data("c : `$tb$` `$tb$` $tb$ $tb$"));
        expect(r.snippets.c).toBe("`$|` `` $1 $2");
        expect(r.warnings.map((w) => w.message)).toEqual(["tab stop inside code removed"]);
    });

    it("with an end marker an unreadable stop is removed (the end marker keeps the cursor)", () => {
        const r = textSnippetsDataToSnippets(data("g : a$tb$b $tb$ c$end$"));
        expect(r.snippets).toEqual({ g: "ab $1 c$|" });
        expect(r.warnings.map((w) => w.message)).toEqual([
            "tab stop next to text or a backslash removed",
            "single tab stop ignored, cursor goes to the end marker",
        ]);
    });

    it("regression: a lone $tb$ glued to text still becomes the cursor (a$tb$b -> a$|b)", () => {
        const r = textSnippetsDataToSnippets(data("one : a$tb$b"));
        expect(r.snippets).toEqual({ one: "a$|b" });
        expect(r.warnings).toEqual([]);
    });

    it("regression: custom stop markers glued to text keep the cursor (x##y##z -> x$|yz)", () => {
        const r = textSnippetsDataToSnippets(data("c : x##y##z", { stopSymbol: "##" }));
        expect(r.snippets).toEqual({ c: "x$|yz" });
        expect(r.warnings).toEqual([{ trigger: "c", message: "tab stop next to text or a backslash removed" }]);
    });

    it("a literal $5 next to stop markers is escaped, not turned into a field", () => {
        const r = textSnippetsDataToSnippets(data("p : Price $5, name $tb$"));
        expect(r.snippets).toEqual({ p: "Price \\$5, name $1" });
        expect(r.warnings).toEqual([
            { trigger: "p", message: "literal $1 to $9 escaped (\\$N) so it stays text next to tab stops" },
        ]);
    });

    it("a literal $N is left alone when the record has no stop markers (and an escaped one stays)", () => {
        expect(textSnippetsDataToSnippets(data("p : Price $5")).snippets).toEqual({ p: "Price $5" });
        const r = textSnippetsDataToSnippets(data("q : cost \\$5 and $tb$ $tb$"));
        expect(r.snippets).toEqual({ q: "cost \\$5 and $1 $2" });
        expect(r.warnings).toEqual([]);
    });

    it("a stop-marker stand-in character inside the data is not a stop", () => {
        const r = textSnippetsDataToSnippets(data("s : a\uE004b $tb$ $tb$"));
        expect(r.snippets).toEqual({ s: "ab $1 $2" });
    });

    it("adjacent stops are both fields", () => {
        const r = textSnippetsDataToSnippets(data("adj : [$tb$$tb$]"));
        expect(r.snippets).toEqual({ adj: "[$1$2]" });
    });

    it("a custom stop marker also becomes fields", () => {
        const r = textSnippetsDataToSnippets(data("c : x ## y ## z", { stopSymbol: "##" }));
        expect(r.snippets).toEqual({ c: "x $1 y $2 z" });
    });

    it("applies all markers together in one replacement, order-independent", () => {
        const r = textSnippetsDataToSnippets(
            data("all : $tb$ A$nl$\n$pst$$end$B$end$"),
        );
        expect(r.snippets).toEqual({ all: "$1 A\n$clipboard$|B" });
        expect(r.warnings.map((w) => w.message).sort()).toEqual([
            "extra cursor markers removed, only the first is kept",
            "single tab stop ignored, cursor goes to the end marker",
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
        expect(r.snippets).toEqual({ a: "[[$|]] $clipboard $1 \n" });
        expect(r.warnings).toEqual([
            { trigger: "a", message: "single tab stop ignored, cursor goes to the end marker" },
        ]);
    });

    it("falls back to defaults for empty or wrong-typed markers", () => {
        const r = textSnippetsDataToSnippets(
            data("a : x$end$y", { endSymbol: "", newlineSymbol: 5, pasteSymbol: null }),
        );
        expect(r.snippets).toEqual({ a: "x$|y" });
    });

    it("does not re-scan produced text: a custom stop marker equal to a placeholder piece stays safe", () => {
        const r = textSnippetsDataToSnippets(data("a : $pst$|", { stopSymbol: "|" }));
        // `|` is the stop marker (-> `$1`, a single field); the produced
        // `$clipboard` is not re-scanned.
        expect(r.snippets).toEqual({ a: "$clipboard$1" });
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

    it("keeps the parser's error as the cause of the invalid JSON error", () => {
        let thrown: unknown;
        try {
            textSnippetsDataToSnippets("{not json");
        } catch (err) {
            thrown = err;
        }
        expect((thrown as Error).cause).toBeInstanceOf(SyntaxError);
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
