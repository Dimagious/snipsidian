import { describe, it, expect } from "vitest";
import { fastestOf } from "../test/helpers";
import {
    applyPlaceholders,
    codeRanges,
    countTabstops,
    escapeLiteralTabstops,
    findFormattedTokens,
    findVariableTokens,
    mapTabstops,
    orderFieldHits,
    orderFields,
    prepareTabstops,
    resolveTabstops,
    scanMarkers,
} from "./placeholders";
import { expand } from "./expand";

describe("applyPlaceholders", () => {
    it("removes $| and returns cursorDelta at its position", async () => {
        const ctx = { isInCode: false, isInMath: false, isInFrontmatter: false, now: new Date("2025-09-02T10:11:12Z") };
        const r = await applyPlaceholders("function $|() {}", ctx);
        expect(r.text).toBe("function () {}");
        expect(r.cursorDelta).toBe("function ".length);
    });

    it("replaces $date and $time", async () => {
        const now = new Date("2025-09-02T10:11:12");
        const ctx = { isInCode: false, isInMath: false, isInFrontmatter: false, now };
        const r = await applyPlaceholders("Today: $date $time", ctx);
        // date: YYYY-MM-DD, time: HH:mm
        expect(r.text).toMatch(/^Today: \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    });

    it("replaces $filename", async () => {
        const ctx = { isInCode: false, isInMath: false, isInFrontmatter: false, now: new Date(), filename: "note.md" };
        const r = await applyPlaceholders("File: $filename", ctx);
        expect(r.text).toBe("File: note.md");
    });

    it("replaces $clipboard if provided, otherwise empties it", async () => {
        const ctx1 = {
            isInCode: false, isInMath: false, isInFrontmatter: false,
            now: new Date(),
            readClipboard: async () => "CLIP"
        };
        const r1 = await applyPlaceholders("X $clipboard Y", ctx1);
        expect(r1.text).toBe("X CLIP Y");

        const ctx2 = { isInCode: false, isInMath: false, isInFrontmatter: false, now: new Date() };
        const r2 = await applyPlaceholders("X $clipboard Y", ctx2);
        expect(r2.text).toBe("X  Y");
    });

    // Regression: F-002 — `$|` was previously located against the raw replacement,
    // before variable substitution. Any length change in a variable to the left
    // of `$|` would desync the cursor. The cursor must point to the marker's
    // position in the FINAL substituted text.
    it("locates $| after substituting $date (cursor lands at end of expanded date)", async () => {
        const now = new Date("2026-05-14T10:11:12");
        const ctx = { isInCode: false, isInMath: false, isInFrontmatter: false, now };
        const r = await applyPlaceholders("$date $|", ctx);
        expect(r.text).toBe("2026-05-14 ");
        expect(r.cursorDelta).toBe("2026-05-14 ".length); // 11 — after the substituted date + space
    });

    it("locates $| after substituting $time", async () => {
        const now = new Date("2026-05-14T07:08:00");
        const ctx = { isInCode: false, isInMath: false, isInFrontmatter: false, now };
        const r = await applyPlaceholders("[$time] $|note", ctx);
        expect(r.text).toBe("[07:08] note");
        // cursor lands before "note" — i.e. at index 8 of the substituted text
        expect(r.cursorDelta).toBe("[07:08] ".length);
    });

    it("locates $| after substituting $filename (incl. empty filename)", async () => {
        const ctx = {
            isInCode: false, isInMath: false, isInFrontmatter: false,
            now: new Date(), filename: "",
        };
        const r = await applyPlaceholders("file=$filename $|done", ctx);
        expect(r.text).toBe("file= done");
        expect(r.cursorDelta).toBe("file= ".length);
    });

    it("locates $| after substituting $clipboard", async () => {
        const ctx = {
            isInCode: false, isInMath: false, isInFrontmatter: false,
            now: new Date(),
            readClipboard: async () => "hello",
        };
        const r = await applyPlaceholders("[$clipboard] $|", ctx);
        expect(r.text).toBe("[hello] ");
        expect(r.cursorDelta).toBe("[hello] ".length);
    });

    it("$| inside a multi-line replacement is resolved against the final text", async () => {
        const ctx = { isInCode: false, isInMath: false, isInFrontmatter: false, now: new Date() };
        const r = await applyPlaceholders("> [!note] \n> $|", ctx);
        expect(r.text).toBe("> [!note] \n> ");
        expect(r.cursorDelta).toBe("> [!note] \n> ".length); // the offset of `$|` in the pre-strip string
    });
});

describe("applyPlaceholders: B-192 tabstops outside wrap", () => {
    const base = { isInCode: false, isInMath: false, isInFrontmatter: false, now: new Date("2025-09-02T10:11:12") };
    const run = (s: string, extra: object = {}) => applyPlaceholders(s, { ...base, ...extra });

    it("[$1](url): caret lands inside the brackets, no literal $1", async () => {
        const r = await run("[$1](url)");
        expect(r.text).toBe("[](url)");
        expect(r.cursorDelta).toBe(1);
    });

    it("catalog-style link, image and heading shapes resolve sensibly", async () => {
        expect((await run("![$1](path)")).cursorDelta).toBe(2);
        expect((await run("### $date $1")).text).toBe("### 2025-09-02 ");
    });

    it("with 2+ tabstops the text is the same and the first field is the fallback caret", async () => {
        const r = await run("a $1 b $2 c $1");
        expect(r.text).toBe("a  b  c ");
        expect(r.cursorDelta).toBe(2);
    });

    it("$| wins over $1; $1 is stripped", async () => {
        const r = await run("x $1 y $| z");
        expect(r.text).toBe("x  y  z");
        expect(r.cursorDelta).toBe("x  y ".length);
    });

    it("$| before $1 still wins", async () => {
        const r = await run("$|a $1 b");
        expect(r.text).toBe("a  b");
        expect(r.cursorDelta).toBe(0);
    });

    it("$10, $1x and $0 are not tabstops", async () => {
        const r = await run("$10 $1x $0");
        expect(r.text).toBe("$10 $1x $0");
        expect(r.cursorDelta).toBeUndefined();
    });

    it("price-like $1.50 stays text, $1. at sentence end is a tabstop", async () => {
        expect((await run("costs $1.50 now")).text).toBe("costs $1.50 now");
        const r = await run("see $1. ok");
        expect(r.text).toBe("see . ok");
        expect(r.cursorDelta).toBe(4);
    });

    it("$date — $1: caret lands after the substituted date (B-011 order)", async () => {
        const r = await run("$date — $1");
        expect(r.text).toBe("2025-09-02 — ");
        expect(r.cursorDelta).toBe("2025-09-02 — ".length);
    });

    it("a $1 inside clipboard content is left alone", async () => {
        const r = await run("$clipboard$1", { readClipboard: async () => "pay $1" });
        expect(r.text).toBe("pay $1");
        expect(r.cursorDelta).toBe("pay $1".length);
    });

    it("no tabstop: cursorDelta stays undefined", async () => {
        expect((await run("plain")).cursorDelta).toBeUndefined();
    });
});

describe("applyPlaceholders: B-243 fields", () => {
    const base = { isInCode: false, isInMath: false, isInFrontmatter: false, now: new Date("2025-09-02T10:11:12") };
    const run = (s: string, extra: object = {}) => applyPlaceholders(s, { ...base, ...extra });

    it("two fields: offsets in visit order, no explicit final stop without `$|`", async () => {
        const r = await run("[$1](url$2)");
        expect(r.text).toBe("[](url)");
        expect(r.fields).toEqual([1, 6]);
        expect(r.docOrder).toEqual([0, 1]);
        expect(r.finalDelta).toBeUndefined();
    });

    it("`$2$1`: both fields sit at one offset, the document index tells them apart", async () => {
        const r = await run("[$2$1]");
        expect(r.fields).toEqual([1, 1]);
        expect(r.docOrder).toEqual([1, 0]);
    });

    it("order is ascending number, not position; ties keep position order", async () => {
        const r = await run("$2 a $1 b $2 c $1");
        expect(r.text).toBe(" a  b  c ");
        // $1 at 3 and 9, then $2 at 0 and 6
        expect(r.fields).toEqual([3, 9, 0, 6]);
    });

    it("$| is the final stop and wins the fallback caret", async () => {
        const r = await run("a $1 b $2 c $| d");
        expect(r.text).toBe("a  b  c  d");
        expect(r.fields).toEqual([2, 5]);
        expect(r.finalDelta).toBe("a  b  c ".length);
        expect(r.cursorDelta).toBe("a  b  c ".length);
    });

    it("a single field is NOT a session (B-192 unchanged): no fields, caret only", async () => {
        const r = await run("[$1](url)");
        expect(r.fields).toBeUndefined();
        expect(r.finalDelta).toBeUndefined();
        expect(r.cursorDelta).toBe(1);
    });

    it("one field next to $| is not a session either", async () => {
        const r = await run("x $1 y $| z");
        expect(r.fields).toBeUndefined();
        expect(r.cursorDelta).toBe("x  y ".length);
    });

    it("escapes, $10, $1x, prices and code do not count as fields", async () => {
        const r = await run("\\$1 $10 $1x $1.50 `$1` $2");
        // only `$2` is real: a single field, not a session
        expect(r.fields).toBeUndefined();
        expect(r.text).toBe("$1 $10 $1x $1.50 `$1` ");
        expect((await run("```\n$1 $2\n```\n$1 $2")).fields).toHaveLength(2);
    });

    it("offsets are located after variable substitution (length-changing $date before a field)", async () => {
        const r = await run("$date $1 / $2");
        expect(r.text).toBe("2025-09-02  / ");
        expect(r.fields).toEqual(["2025-09-02 ".length, "2025-09-02  / ".length]);
    });

    it("a $1 inside clipboard content is not a field", async () => {
        const r = await run("$clipboard $1 $2", { readClipboard: async () => "pay $1 $2" });
        expect(r.text).toBe("pay $1 $2  ");
        expect(r.fields).toEqual(["pay $1 $2 ".length, "pay $1 $2  ".length]);
    });

    it("a clipboard value with marker characters cannot forge or remove a field", async () => {
        const clip = "x\uE0021\uE003y\uE004";
        const r = await run("$clipboard $1 $2", { readClipboard: async () => clip });
        expect(r.text).toBe("x1y  ");
        expect(r.fields).toEqual(["x1y ".length, "x1y  ".length]);
    });

    it("with ONE field the same clipboard value is inserted byte for byte (no stripping)", async () => {
        const clip = "x\uE0021\uE003y";
        const r = await run("$clipboard $1", { readClipboard: async () => clip });
        expect(r.text).toBe(`${clip} `);
        expect(r.fields).toBeUndefined();
    });

    it("marker characters from $filename and a custom date format are stripped when fields exist", async () => {
        const r = await run("$filename {{date:X}} $1 $2", {
            filename: "a\uE002b",
            formatDate: () => "d\uE003e",
        });
        expect(r.text).toBe("ab de  ");
    });

    it("no markers leak into the text", async () => {
        const r = await run("$1$2$3");
        expect(r.text).toBe("");
        expect(r.fields).toEqual([0, 0, 0]);
    });
});

describe("B-243 helpers", () => {
    it("countTabstops counts only real tabstops", () => {
        expect(countTabstops("plain")).toBe(0);
        expect(countTabstops("$1 \\$2 $3x `$4` $5")).toBe(2);
    });

    it("prepareTabstops: 0 or 1 tabstop keeps B-192, 2+ makes fields", () => {
        expect(prepareTabstops("a $1 b")).toEqual({ text: "a $| b", fields: false });
        expect(prepareTabstops("a b")).toEqual({ text: "a b", fields: false });
        const two = prepareTabstops("$1 $2");
        expect(two.fields).toBe(true);
        expect(two.text).not.toContain("$1");
    });

    it("scanMarkers: without fields a stray marker lookalike is left alone", () => {
        const stray = "a\uE0021\uE003b";
        expect(scanMarkers(stray, false).text).toBe(stray);
        expect(scanMarkers(stray, true).fields).toEqual([{ n: 1, offset: 1 }]);
    });

    it("scanMarkers: only the first $| is consumed unless extras are dropped", () => {
        expect(scanMarkers("a$|b$|c", false)).toEqual({ text: "ab$|c", cursor: 1, fields: [] });
        expect(scanMarkers("a$|b$|c", false, true)).toEqual({ text: "abc", cursor: 1, fields: [] });
    });

    it("orderFieldHits reports the document index of each visited field", () => {
        expect(orderFieldHits([{ n: 2, offset: 1 }, { n: 1, offset: 1 }])).toEqual({
            offsets: [1, 1],
            docOrder: [1, 0],
        });
    });

    it("escapeLiteralTabstops escapes live tabstops only, idempotently", () => {
        expect(escapeLiteralTabstops("Price $5, $10, \\$3, `$4`, $1.50, $2")).toBe(
            "Price \\$5, $10, \\$3, `$4`, $1.50, \\$2",
        );
        expect(escapeLiteralTabstops("no dollar")).toBe("no dollar");
        const once = escapeLiteralTabstops("a $7 b");
        expect(escapeLiteralTabstops(once)).toBe(once);
        // the escape is read back as the literal text
        expect(mapTabstops(once, () => "FIELD")).toBe("a $7 b");
    });

    it("orderFields is stable for equal numbers", () => {
        expect(orderFields([{ n: 2, offset: 1 }, { n: 1, offset: 5 }, { n: 1, offset: 3 }])).toEqual([5, 3, 1]);
    });
});

describe("resolveTabstops", () => {
    it("is identity without tabstops", () => {
        expect(resolveTabstops("abc $| d")).toBe("abc $| d");
    });
    it("rewrites first $N to $| and strips the rest", () => {
        expect(resolveTabstops("$2 [$1] $3")).toBe("$| [] ");
        expect(resolveTabstops("$2 [$1] $3")).not.toContain("$1");
    });
});

describe("applyPlaceholders: B-166 {{date}} / {{time}}", () => {
    const base = { isInCode: false, isInMath: false, isInFrontmatter: false, now: new Date("2025-09-02T10:11:12") };
    const fake = (d: Date, f: string) => `<${f}@${d.getFullYear()}>`;
    const run = (s: string, extra: object = {}) => applyPlaceholders(s, { ...base, ...extra });

    it("defaults match core Templates: YYYY-MM-DD and HH:mm", async () => {
        expect((await run("{{date}} {{time}}")).text).toBe("2025-09-02 10:11");
        const viaFormatter = await run("{{date}} {{time}}", { formatDate: fake });
        expect(viaFormatter.text).toBe("<YYYY-MM-DD@2025> <HH:mm@2025>");
    });

    it("passes the custom format and the injected now to the formatter", async () => {
        const r = await run("{{date:dddd, D MMM}} / {{time:h:mm A}}", { formatDate: fake });
        expect(r.text).toBe("<dddd, D MMM@2025> / <h:mm A@2025>");
    });

    it("empty format falls back to the default format", async () => {
        expect((await run("{{date:}}|{{time:}}", { formatDate: fake })).text).toBe("<YYYY-MM-DD@2025>|<HH:mm@2025>");
    });

    it("unknown tokens are left as is", async () => {
        expect((await run("{{foo}} {{date2}} {{ date }} {{title:x}} {{Title}}", { formatDate: fake })).text)
            .toBe("{{foo}} {{date2}} {{ date }} {{title:x}} {{Title}}");
    });

    it("without a formatter a custom format is left untouched, defaults still work", async () => {
        expect((await run("{{date:YYYY}} {{date}}")).text).toBe("{{date:YYYY}} 2025-09-02");
    });

    it("$| after a long formatted date places the caret after the expansion", async () => {
        const long = (_d: Date, _f: string) => "Tuesday, September 2nd 2025";
        const r = await run("{{date:LLLL}} $|!", { formatDate: long });
        expect(r.text).toBe("Tuesday, September 2nd 2025 !");
        expect(r.cursorDelta).toBe("Tuesday, September 2nd 2025 ".length);
    });

    it("{{date:FMT}} and $1 in the same replacement: caret after the date", async () => {
        const r = await run("{{date:YYYY}} $1", { formatDate: fake });
        expect(r.text).toBe("<YYYY@2025> ");
        expect(r.cursorDelta).toBe("<YYYY@2025> ".length);
    });

    it("$ in formatter output is not treated as a replace pattern", async () => {
        const r = await run("{{date:x}}", { formatDate: () => "$& $1" });
        expect(r.text).toBe("$& $1");
    });

    it("existing $date / $time are unchanged", async () => {
        expect((await run("$date $time", { formatDate: fake })).text).toBe("2025-09-02 10:11");
    });
});

describe("applyPlaceholders: B-204 {{title}} and B-218 {{notedate:FMT}}", () => {
    const base = { isInCode: false, isInMath: false, isInFrontmatter: false, now: new Date("2025-09-02T10:11:12") };
    const run = (s: string, extra: object = {}) => applyPlaceholders(s, { ...base, ...extra });
    const noteDate = (format: string): string => `<${format}>`;

    it("{{title}} is the note's basename; $filename keeps its extension", async () => {
        const r = await run("# {{title}} / $filename", { filename: "Plan.md", basename: "Plan" });
        expect(r.text).toBe("# Plan / Plan.md");
    });

    it("keeps the dots of the name (the extension is already gone)", async () => {
        expect((await run("{{title}}", { filename: "v1.2 notes.md", basename: "v1.2 notes" })).text).toBe("v1.2 notes");
    });

    it("no active file: {{title}} is an empty string", async () => {
        expect((await run("[{{title}}]")).text).toBe("[]");
    });

    it("{{title}} before $| puts the caret after the substituted name", async () => {
        const r = await run("# {{title}}: $|", { basename: "Long note name" });
        expect(r.text).toBe("# Long note name: ");
        expect(r.cursorDelta).toBe("# Long note name: ".length);
    });

    it("{{title}} used twice, and a value with $ is inserted verbatim", async () => {
        expect((await run("{{title}}+{{title}}", { basename: "a$&b" })).text).toBe("a$&b+a$&b");
    });

    it("field markers in the name cannot forge a tab stop (B-243)", async () => {
        const r = await run("$1 $2 {{title}}", { basename: "x\uE002" + "1\uE003y" });
        expect(r.fields).toEqual([0, 1]);
        expect(r.text).toBe("  x1y");
    });

    it("{{title:x}} (no format exists) is left as text", async () => {
        expect((await run("{{title:x}}", { basename: "n" })).text).toBe("{{title:x}}");
    });

    it("{{notedate:FMT}} passes the format; empty or missing FMT means YYYY-MM-DD", async () => {
        const r = await run("{{notedate:GGGG-[W]WW}} {{notedate}} {{notedate:}}", { formatNoteDate: noteDate });
        expect(r.text).toBe("<GGGG-[W]WW> <YYYY-MM-DD> <YYYY-MM-DD>");
    });

    it("{{notedate:FMT}} without the injected formatter is left untouched", async () => {
        expect((await run("{{notedate:YYYY}}")).text).toBe("{{notedate:YYYY}}");
    });

    it("{{notedate:FMT}} output is inserted verbatim ($ is not a replace pattern)", async () => {
        expect((await run("{{notedate:x}}", { formatNoteDate: () => "$& $1" })).text).toBe("$& $1");
    });

    describe("the inserted name is verbatim: later passes never read it", () => {
        const clip = { readClipboard: () => Promise.resolve("SECRET") };

        it("a note named `Budget $date` is not turned into a date", async () => {
            expect((await run("{{title}}", { basename: "Budget $date" })).text).toBe("Budget $date");
        });

        it("a note named `pw $clipboard` does not leak the clipboard", async () => {
            expect((await run("{{title}}", { basename: "pw $clipboard", ...clip })).text).toBe("pw $clipboard");
        });

        it("a note named `a $| b` does not move the caret", async () => {
            const r = await run("{{title}}!$|", { basename: "a $| b" });
            expect(r.text).toBe("a $| b!");
            expect(r.cursorDelta).toBe("a $| b!".length);
        });

        it("`$filename` and `$time` in the name stay text", async () => {
            expect((await run("{{title}}", { basename: "$filename $time", filename: "X.md" })).text).toBe("$filename $time");
        });

        it("`$1` in the name is not a tab stop", async () => {
            const r = await run("{{title}} $|", { basename: "cost $1" });
            expect(r.text).toBe("cost $1 ");
            expect(r.fields).toBeUndefined();
            const two = await run("$1 $2 {{title}}", { basename: "$1" });
            expect(two.text).toBe("  $1");
            expect(two.fields).toEqual([0, 1]);
        });

        it("`{{date}}` in the name stays text", async () => {
            expect((await run("{{title}}", { basename: "{{date}}", formatDate: () => "DATE" })).text).toBe("{{date}}");
        });

        it("{{notedate}} output with `$date`, `$clipboard` and `$|` stays text", async () => {
            const r = await run("{{notedate:x}}|$|", { formatNoteDate: () => "$date $clipboard $|", ...clip });
            expect(r.text).toBe("$date $clipboard $||");
            expect(r.cursorDelta).toBe("$date $clipboard $||".length);
        });

        it("a clipboard carrying the verbatim marker cannot pull the title in", async () => {
            const r = await run("{{title}}-$clipboard", { basename: "Plan", readClipboard: () => Promise.resolve("\uE0050\uE005") });
            expect(r.text).toBe("Plan-0");
        });

        it("a file name or a date format output carrying the marker cannot pull the title in", async () => {
            const forged = "\uE0050\uE005";
            const r = await run("{{title}}|$filename|{{date:x}}|{{notedate:y}}", {
                basename: "Plan",
                filename: forged,
                formatDate: () => forged,
                formatNoteDate: () => forged,
            });
            expect(r.text).toBe("Plan|0|0|0");
        });

        it("fields after the name are offset by the name's real length", async () => {
            const r = await run("{{title}}$1 $2", { basename: "$|" });
            expect(r.text).toBe("$| ");
            expect(r.fields).toEqual([2, 3]);
        });
    });
});

describe("applyPlaceholders: B-192 literal dollars, escapes and code (round 2)", () => {
    const base = { isInCode: false, isInMath: false, isInFrontmatter: false, now: new Date("2025-09-02T10:11:12") };
    const run = (s: string) => applyPlaceholders(s, base);

    it.each([
        ["$1,000", "thousands separator"],
        ["$1.50", "decimal price"],
        ["$1é", "accented letter"],
        ["$1日本", "CJK text"],
        ["$1x", "ASCII letter"],
        ["$10", "two digits"],
        ["$1_a", "underscore"],
    ])("%s stays literal (%s)", async (input) => {
        const r = await run(`a ${input} b`);
        expect(r.text).toBe(`a ${input} b`);
        expect(r.cursorDelta).toBeUndefined();
    });

    it("$5 each IS a tabstop (documented: escape it as \\$5)", async () => {
        const r = await run("costs $5 each");
        expect(r.text).toBe("costs  each");
        expect(r.cursorDelta).toBe("costs ".length);
    });

    it("\\$1 is an escape: backslash dropped, literal $1, no cursor", async () => {
        const r = await run("costs \\$5 each");
        expect(r.text).toBe("costs $5 each");
        expect(r.cursorDelta).toBeUndefined();
    });

    it("\\$1 with $| present: still literal, $| keeps the cursor", async () => {
        const r = await run("\\$1 $|");
        expect(r.text).toBe("$1 ");
        expect(r.cursorDelta).toBe(3);
    });

    it("other backslashes are untouched", async () => {
        expect((await run("a\\nb \\$ \\\\ \\$|")).text).toBe("a\\nb \\$ \\\\ \\");
    });

    it("$1 inside a fenced block is literal", async () => {
        const r = await run("```bash\necho $1\n```");
        expect(r.text).toBe("```bash\necho $1\n```");
        expect(r.cursorDelta).toBeUndefined();
    });

    it("an unclosed fence keeps the rest literal; tildes and longer fences work", async () => {
        expect((await run("~~~\n$1")).text).toBe("~~~\n$1");
        expect((await run("````\n```\n$1\n````\n$1")).text).toBe("````\n```\n$1\n````\n");
    });

    it("$1 inside inline code is literal", async () => {
        const r = await run("use `$1` here");
        expect(r.text).toBe("use `$1` here");
        expect(r.cursorDelta).toBeUndefined();
    });

    it("a $1 outside code next to one inside: only the outside one is the cursor", async () => {
        const r = await run("`$1` then [$1](u)");
        expect(r.text).toBe("`$1` then [](u)");
        expect(r.cursorDelta).toBe("`$1` then [".length);
    });

    it("an unmatched backtick does not hide a tabstop; double-backtick spans work", async () => {
        expect((await run("it`s $1")).text).toBe("it`s ");
        expect((await run("``a ` $1`` $1")).text).toBe("``a ` $1`` ");
    });
});

describe("expand: B-192 multi-line replacement", () => {
    it("a\\n[$1](url) puts the caret on line 1, ch 1", async () => {
        const ctx = { isInCode: false, isInMath: false, isInFrontmatter: false, now: new Date() };
        const plan = await expand(
            { textBefore: "lnk", textAfter: "", lastTyped: " ", sepCh: 3 },
            { lnk: "a\n[$1](url)" },
            ctx,
        );
        expect(plan?.insert).toBe("a\n[](url)");
        expect(plan?.newCursor).toEqual({ lineDelta: 1, ch: 1 });
    });
});

describe("B-266: findVariableTokens / findFormattedTokens", () => {
    it("lists what substituteVariables would replace, with the engine's word boundary", () => {
        expect(findVariableTokens("a $date b $time $filename $clipboard")).toEqual(["$date", "$time", "$filename", "$clipboard"]);
        expect(findVariableTokens("$dates $date_x $clipboards x$date")).toEqual(["$date"]);
        expect(findVariableTokens("$|, $1, $$")).toEqual([]);
    });

    it("lists {{date}}, {{time}} and their formatted forms, nothing else", () => {
        expect(findFormattedTokens("{{date}} {{time:HH}} {{date:}} {{date:YYYY-MM}}")).toEqual(["{{date}}", "{{time:HH}}", "{{date:}}", "{{date:YYYY-MM}}"]);
        expect(findFormattedTokens("{{ date }} {{dates}} {{date:{x}}} {{clipboard}}")).toEqual([]);
        expect(findFormattedTokens("{{title}} {{notedate}} {{notedate:GGGG-[W]WW}} {{title:x}}")).toEqual(["{{title}}", "{{notedate}}", "{{notedate:GGGG-[W]WW}}"]);
    });

    it("agrees with the engine: every listed token is replaced, every unlisted one is not", async () => {
        const ctx = { isInCode: false, isInMath: false, isInFrontmatter: false, now: new Date("2025-09-02T10:11:12"), filename: "f.md" };
        const text = "$dates {{ date }} $date_x";
        expect(findVariableTokens(text)).toEqual([]);
        expect(findFormattedTokens(text)).toEqual([]);
        expect((await applyPlaceholders(text, ctx)).text).toBe(text);
        const live = "$date {{time:HH}}";
        expect(findVariableTokens(live)).toHaveLength(1);
        expect(findFormattedTokens(live)).toHaveLength(1);
        expect((await applyPlaceholders(live, ctx)).text).not.toBe(live);
    });
});

/** The quadratic implementation `codeRanges` replaced, kept as the reference its output must equal. */
function referenceCodeRanges(text: string): Array<[number, number]> {
    const ranges: Array<[number, number]> = [];
    let offset = 0;
    let fence: { start: number; marker: string } | null = null;
    for (const line of text.split("\n")) {
        const lineEnd = offset + line.length;
        const m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
        if (fence) {
            if (m && m[1]?.[0] === fence.marker[0] && (m[1]?.length ?? 0) >= fence.marker.length) {
                ranges.push([fence.start, lineEnd]);
                fence = null;
            }
        } else if (m && m[1]) {
            fence = { start: offset, marker: m[1] };
        } else if (line.includes("`")) {
            let i = 0;
            while (i < line.length) {
                if (line[i] !== "`") { i++; continue; }
                let j = i;
                while (line[j] === "`") j++;
                const run = line.slice(i, j);
                const close = line.indexOf(run, j);
                let k = close;
                while (k >= 0 && (line[k + run.length] === "`" || line[k - 1] === "`")) {
                    k = line.indexOf(run, k + 1);
                }
                if (k >= 0) {
                    ranges.push([offset + i, offset + k + run.length]);
                    i = k + run.length;
                } else {
                    i = j;
                }
            }
        }
        offset = lineEnd + 1;
    }
    if (fence) ranges.push([fence.start, text.length]);
    return ranges;
}

describe("codeRanges: linear, and identical to the quadratic version", () => {
    it("matches the reference on 20000 generated texts (backticks, tildes, newlines, spaces, `$`)", () => {
        // Deterministic LCG, so a failure reproduces.
        let seed = 12345;
        const next = (n: number): number => {
            seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
            return (seed >>> 8) % n;
        };
        const alphabet = ["`", "`", "`", "``", "```", "~~~", "\n", "\n", " ", "   ", "a", "$", "$1", "$|"];
        for (let t = 0; t < 20000; t++) {
            let text = "";
            const parts = next(24);
            for (let i = 0; i < parts; i++) text += alphabet[next(alphabet.length)] ?? "";
            expect(codeRanges(text), JSON.stringify(text)).toEqual(referenceCodeRanges(text));
        }
    });

    it("handles the named cases like the reference", () => {
        for (const text of ["", "`", "``a`", "`a``b`c`", "``a`b``", "a`b`c`d", "```\n`x`\n```", "~~~\n``\n~~~~", "  ```js\n$1\n", "`a\n`b`"]) {
            expect(codeRanges(text), JSON.stringify(text)).toEqual(referenceCodeRanges(text));
        }
    });

    it("a line of backtick runs of growing length (200k characters) is scanned in well under 200 ms; the quadratic version takes seconds", () => {
        let line = "";
        for (let len = 1; line.length < 200_000; len++) line += `${"`".repeat(len)} `;
        const text = `${line}$`;
        codeRanges(text.slice(0, 5_000)); // warm-up
        const took = fastestOf(() => {
            const started = performance.now();
            codeRanges(text);
            return performance.now() - started;
        }, 200, 1_000);
        expect(took).toBeLessThan(200);
    }, 30_000);
});
