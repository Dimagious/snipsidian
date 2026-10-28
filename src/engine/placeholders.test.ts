import { describe, it, expect } from "vitest";
import { applyPlaceholders, resolveTabstops } from "./placeholders";
import { expand } from "./expand";

describe("applyPlaceholders", () => {
    it("removes $| and returns cursorDelta at its position", async () => {
        const ctx = { isInCode: false, isInMath: false, isInFrontmatter: false, now: new Date("2025-09-02T10:11:12Z") };
        const r = await applyPlaceholders("function $|() {}", ctx as any);
        expect(r.text).toBe("function () {}");
        expect(r.cursorDelta).toBe("function ".length);
    });

    it("replaces $date and $time", async () => {
        const now = new Date("2025-09-02T10:11:12");
        const ctx = { isInCode: false, isInMath: false, isInFrontmatter: false, now };
        const r = await applyPlaceholders("Today: $date $time", ctx as any);
        // date: YYYY-MM-DD, time: HH:mm
        expect(r.text).toMatch(/^Today: \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    });

    it("replaces $filename", async () => {
        const ctx = { isInCode: false, isInMath: false, isInFrontmatter: false, now: new Date(), filename: "note.md" };
        const r = await applyPlaceholders("File: $filename", ctx as any);
        expect(r.text).toBe("File: note.md");
    });

    it("replaces $clipboard if provided, otherwise empties it", async () => {
        const ctx1 = {
            isInCode: false, isInMath: false, isInFrontmatter: false,
            now: new Date(),
            readClipboard: async () => "CLIP"
        };
        const r1 = await applyPlaceholders("X $clipboard Y", ctx1 as any);
        expect(r1.text).toBe("X CLIP Y");

        const ctx2 = { isInCode: false, isInMath: false, isInFrontmatter: false, now: new Date() };
        const r2 = await applyPlaceholders("X $clipboard Y", ctx2 as any);
        expect(r2.text).toBe("X  Y");
    });

    // Regression: F-002 — `$|` was previously located against the raw replacement,
    // before variable substitution. Any length change in a variable to the left
    // of `$|` would desync the cursor. The cursor must point to the marker's
    // position in the FINAL substituted text.
    it("locates $| after substituting $date (cursor lands at end of expanded date)", async () => {
        const now = new Date("2026-05-14T10:11:12");
        const ctx = { isInCode: false, isInMath: false, isInFrontmatter: false, now };
        const r = await applyPlaceholders("$date $|", ctx as any);
        expect(r.text).toBe("2026-05-14 ");
        expect(r.cursorDelta).toBe("2026-05-14 ".length); // 11 — after the substituted date + space
    });

    it("locates $| after substituting $time", async () => {
        const now = new Date("2026-05-14T07:08:00");
        const ctx = { isInCode: false, isInMath: false, isInFrontmatter: false, now };
        const r = await applyPlaceholders("[$time] $|note", ctx as any);
        expect(r.text).toBe("[07:08] note");
        // cursor lands before "note" — i.e. at index 8 of the substituted text
        expect(r.cursorDelta).toBe("[07:08] ".length);
    });

    it("locates $| after substituting $filename (incl. empty filename)", async () => {
        const ctx = {
            isInCode: false, isInMath: false, isInFrontmatter: false,
            now: new Date(), filename: "",
        };
        const r = await applyPlaceholders("file=$filename $|done", ctx as any);
        expect(r.text).toBe("file= done");
        expect(r.cursorDelta).toBe("file= ".length);
    });

    it("locates $| after substituting $clipboard", async () => {
        const ctx = {
            isInCode: false, isInMath: false, isInFrontmatter: false,
            now: new Date(),
            readClipboard: async () => "hello",
        };
        const r = await applyPlaceholders("[$clipboard] $|", ctx as any);
        expect(r.text).toBe("[hello] ");
        expect(r.cursorDelta).toBe("[hello] ".length);
    });

    it("$| inside a multi-line replacement is resolved against the final text", async () => {
        const ctx = { isInCode: false, isInMath: false, isInFrontmatter: false, now: new Date() };
        const r = await applyPlaceholders("> [!note] \n> $|", ctx as any);
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

    it("first $N is the cursor, remaining tabstops are stripped", async () => {
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
        expect((await run("{{foo}} {{date2}} {{ date }} {{title}}", { formatDate: fake })).text)
            .toBe("{{foo}} {{date2}} {{ date }} {{title}}");
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
