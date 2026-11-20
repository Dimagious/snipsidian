import { describe, it, expect } from "vitest";
import { compileRule, type CompiledRule } from "../engine/patterns";
import type { PatternMode } from "../engine/types";
import { capTryItLine, replayTryIt, TRY_IT_MAX_LINE, type TryItResult } from "./pattern-tryit";

const NOW = new Date(2026, 10, 19, 9, 5, 0);

type Spec = { id: string; source: string; replacement: string; mode?: PatternMode };

function compile(specs: Spec[]): CompiledRule[] {
    return specs.map((s) => {
        const result = compileRule({ id: s.id, source: s.source, replacement: s.replacement, mode: s.mode ?? "instant", enabled: true });
        if (!result.ok) throw new Error(`${s.id}: ${result.reason}`);
        return result.rule;
    });
}

async function tryIt(
    specs: Spec[],
    line: string,
    opts: { draft?: string; snippets?: Record<string, string>; prefix?: string; typing?: boolean } = {},
): Promise<TryItResult> {
    const rules = compile(specs);
    return replayTryIt({
        line,
        rules,
        positions: new Map(specs.map((s, i) => [s.id, i + 1])),
        draftId: opts.draft ?? specs[0]?.id ?? "draft",
        snippets: opts.snippets ?? {},
        prefix: opts.prefix,
        expandWhileTyping: opts.typing ?? true,
        now: NOW,
    });
}

const HALF_SEPARATOR: Spec = { id: "a", source: "/(\\d+)\\/(\\d+)$/", replacement: "{{1}}⁄{{2}}", mode: "separator" };
const ONE_HALF_SEPARATOR: Spec = { id: "a", source: "/1\\/2$/", replacement: "½", mode: "instant" };

describe("replayTryIt", () => {
    it("says nothing for an empty line", async () => {
        const r = await tryIt([ONE_HALF_SEPARATOR], "");
        expect(r.status).toEqual({ kind: "empty" });
        expect(r.text).toBe("");
    });

    it("reports an instant rule that fires at the end of what was typed", async () => {
        const r = await tryIt([ONE_HALF_SEPARATOR], "1/2");
        expect(r.text).toBe("½");
        expect(r.replaced).toEqual({ from: 0, to: 1 });
        expect(r.status).toEqual({ kind: "fires", at: "1/2" });
    });

    it("explains early firing: 1/23 gives the half and a 3 (the design's case)", async () => {
        const r = await tryIt([ONE_HALF_SEPARATOR], "1/23");
        expect(r.text).toBe("½3");
        expect(r.status).toEqual({ kind: "early", at: "1/2", next: "3" });
        // The caret is after the 3, and only the replaced span is marked.
        expect(r.caret).toBe(2);
        expect(r.replaced).toEqual({ from: 0, to: 1 });
    });

    it("a separator typed right after the match is not early firing", async () => {
        const r = await tryIt([ONE_HALF_SEPARATOR], "1/2 ");
        expect(r.text).toBe("½ ");
        expect(r.status).toEqual({ kind: "fires", at: "1/2" });
    });

    it("lets a separator-mode rule finish 1/23 untouched, and fire on the separator", async () => {
        const sep: Spec = { id: "a", source: "/(?<![\\w\\/])1\\/2$/", replacement: "½", mode: "separator" };
        expect((await tryIt([sep], "1/23")).text).toBe("1/23");
        const r = await tryIt([sep], "1/2 ");
        expect(r.text).toBe("½ ");
        expect(r.status).toEqual({ kind: "fires", at: "1/2" });
    });

    it("a separator rule with no separator typed yet adds a space to the preview and says so", async () => {
        const sep: Spec = { id: "a", source: "/:(\\w+):$/", replacement: "<{{1}}>", mode: "separator" };
        const r = await tryIt([sep], ":smile:");
        expect(r.text).toBe("<smile> ");
        expect(r.status).toEqual({ kind: "needs-separator" });
    });

    it("a separator rule that does not match even with a separator says no match and adds nothing", async () => {
        const sep: Spec = { id: "a", source: "/:(\\w+):$/", replacement: "<{{1}}>", mode: "separator" };
        const r = await tryIt([sep], "smile");
        expect(r.text).toBe("smile");
        expect(r.status).toEqual({ kind: "none" });
    });

    it("tries literal snippets first on a separator and names the snippet", async () => {
        const sep: Spec = { id: "a", source: "/todo$/", replacement: "RULE", mode: "separator" };
        const r = await tryIt([sep], "todo ", { snippets: { todo: "- [ ] " } });
        expect(r.text).toBe("- [ ]  ");
        expect(r.status).toEqual({ kind: "shadowed-snippet", trigger: "todo" });
    });

    it("applies the prefix setting to literal triggers only", async () => {
        const sep: Spec = { id: "a", source: "/todo$/", replacement: "RULE", mode: "separator" };
        // Prefix mode on: bare `todo` is not a snippet any more, so the rule fires.
        const bare = await tryIt([sep], "todo ", { snippets: { todo: "S" }, prefix: ":" });
        expect(bare.text).toBe("RULE ");
        expect(bare.status).toEqual({ kind: "fires", at: "todo" });
        const prefixed = await tryIt([sep], ":todo ", { snippets: { todo: "S" }, prefix: ":" });
        expect(prefixed.text).toBe("S ");
        expect(prefixed.status).toEqual({ kind: "shadowed-snippet", trigger: "todo" });
    });

    it("names the rule that fires first when an earlier rule shadows the draft", async () => {
        const first: Spec = { id: "first", source: "/ab$/", replacement: "X" };
        const draft: Spec = { id: "draft", source: "/b$/", replacement: "Y" };
        const r = await tryIt([first, draft], "ab", { draft: "draft" });
        expect(r.text).toBe("X");
        expect(r.status).toEqual({ kind: "shadowed-rule", position: 1 });
    });

    it("says no match when nothing fires", async () => {
        const r = await tryIt([ONE_HALF_SEPARATOR], "hello");
        expect(r.status).toEqual({ kind: "none" });
        expect(r.text).toBe("hello");
        expect(r.replaced).toBeNull();
        expect(r.caret).toBe(5);
    });

    it("does not rescan inserted text within one keystroke", async () => {
        // `a` becomes `bb`, and `b$` would match the insert: the next keystroke may see it, this one does not.
        const r = await tryIt(
            [
                { id: "a", source: "/a$/", replacement: "bb" },
                { id: "b", source: "/bbb$/", replacement: "Z" },
            ],
            "a",
        );
        expect(r.text).toBe("bb");
        // The next character sees the inserted text.
        const next = await tryIt(
            [
                { id: "a", source: "/a$/", replacement: "bb" },
                { id: "b", source: "/bbb$/", replacement: "Z" },
            ],
            "ab",
        );
        expect(next.text).toBe("Z");
    });

    it("chains one rule into the next across keystrokes, as typing does", async () => {
        const rules: Spec[] = [
            { id: "a", source: "/<<$/", replacement: "≪" },
            { id: "b", source: "/≪<$/", replacement: "⋘" },
        ];
        expect((await tryIt(rules, "<<")).text).toBe("≪");
        expect((await tryIt(rules, "<<<")).text).toBe("⋘");
    });

    it("fires an instant rule on a typed separator and replaces the separator with it", async () => {
        const dots: Spec = { id: "a", source: "/\\.\\.\\.$/", replacement: "…" };
        const r = await tryIt([dots], "...");
        expect(r.text).toBe("…");
        expect(r.status).toEqual({ kind: "fires", at: "..." });
    });

    it("resolves $date and $time, and shows $clipboard and $filename as tokens without reading anything", async () => {
        const rule: Spec = { id: "a", source: "/;d$/", replacement: "$date $time|$clipboard|$filename", mode: "instant" };
        const r = await tryIt([rule], ";d");
        expect(r.text).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}\|\$clipboard\|\$filename$/);
        expect(r.text).toContain("2026-11-19 09:05");
    });

    it("B-204 / B-218: {{title}} and {{notedate:FMT}} come back as their own tokens (no note is read)", async () => {
        const rule: Spec = { id: "a", source: "/;t$/", replacement: "{{title}}|{{notedate:GGGG-[W]WW}}|{{notedate}}", mode: "instant" };
        const r = await tryIt([rule], ";t");
        expect(r.text).toBe("{{title}}|{{notedate:GGGG-[W]WW}}|{{notedate:YYYY-MM-DD}}");
    });

    it("marks tab stops and the caret of the replacement", async () => {
        const fields: Spec = { id: "a", source: "/;m$/", replacement: "Meeting $1 with $2" };
        const r = await tryIt([fields], ";m");
        expect(r.text).toBe("Meeting  with ");
        expect(r.fields).toEqual([8, 14]);
        const caret = await tryIt([{ id: "a", source: "/;c$/", replacement: "(a$|b)" }], ";c");
        expect(caret.text).toBe("(ab)");
        expect(caret.caret).toBe(2);
        // Text typed after the expansion moves the caret and clears the marks.
        const later = await tryIt([fields], ";mx");
        expect(later.fields).toEqual([]);
        expect(later.caret).toBe(later.text.length);
    });

    it("never fires an instant rule while Expand while typing is off, and a separator rule still does", async () => {
        const off = await tryIt([ONE_HALF_SEPARATOR], "1/2 ", { typing: false });
        expect(off.text).toBe("1/2 ");
        expect(off.status).toEqual({ kind: "none" });
        const sep: Spec = { id: "a", source: "/1\\/2$/", replacement: "½", mode: "separator" };
        expect((await tryIt([sep], "1/2 ", { typing: false })).text).toBe("½ ");
    });

    it("keeps a pattern on an emoji whole: no half emoji comes out", async () => {
        const rule: Spec = { id: "a", source: "/(\\S)$/", replacement: "[{{1}}]", mode: "separator" };
        // `\S` alone would match the low half of the emoji; the engine drops that match instead of writing half an emoji.
        const r = await tryIt([rule], "\u{1F600} ");
        expect(r.text).toBe("\u{1F600} ");
        expect(r.status).toEqual({ kind: "none" });
        const plain = await tryIt([{ id: "a", source: "/\u{1F600}$/", replacement: "smile", mode: "separator" }], "\u{1F600} ");
        expect(plain.text).toBe("smile ");
    });

    it("only reads the last 64 characters of a long line", async () => {
        const rule: Spec = { id: "a", source: "/^1\\/2$/", replacement: "½", mode: "instant" };
        // `^` means a line start, and a line cut by the window does not have one in sight.
        const r = await tryIt([rule], `${"x".repeat(70)}1/2`);
        expect(r.text.endsWith("1/2")).toBe(true);
        expect(r.status).toEqual({ kind: "none" });
    });

    it("captures with {{n}} come from the match", async () => {
        const r = await tryIt([HALF_SEPARATOR], "3/4 ", { draft: "a" });
        expect(r.text).toBe("3⁄4 ");
    });
});

describe("capTryItLine", () => {
    it("keeps a line up to the cap and cuts one past it", () => {
        expect(capTryItLine("a".repeat(TRY_IT_MAX_LINE))).toEqual({ line: "a".repeat(TRY_IT_MAX_LINE), cut: false });
        expect(capTryItLine("a".repeat(TRY_IT_MAX_LINE + 1))).toEqual({ line: "a".repeat(TRY_IT_MAX_LINE), cut: true });
        expect(capTryItLine("")).toEqual({ line: "", cut: false });
    });

    it("does not leave half an emoji at the cut", () => {
        const line = `${"a".repeat(TRY_IT_MAX_LINE - 1)}\u{1F600}tail`;
        const capped = capTryItLine(line);
        expect(capped.cut).toBe(true);
        expect(capped.line).toBe("a".repeat(TRY_IT_MAX_LINE - 1));
    });
});
