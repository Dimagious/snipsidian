import { describe, it, expect } from "vitest";
import { isInYamlFrontmatter, isInFencedCode, isInInlineCode, isInMath } from "./markdown";

// Small helper to simulate an editor document.
function mkDoc(lines: string[]) {
    return {
        getLine: (i: number) => lines[i] ?? "",
        last: lines.length - 1
    };
}

describe("markdown: YAML frontmatter", () => {
    it("returns true when cursor is between opening and closing ---", () => {
        const lines = [
            "---",
            "title: Test",
            "tags: x",
            "---",
            "content"
        ];
        const doc = mkDoc(lines);
        expect(isInYamlFrontmatter(doc.getLine, doc.last, 1)).toBe(true); // inside
        expect(isInYamlFrontmatter(doc.getLine, doc.last, 2)).toBe(true); // inside
        expect(isInYamlFrontmatter(doc.getLine, doc.last, 3)).toBe(false); // closing line -> outside
        expect(isInYamlFrontmatter(doc.getLine, doc.last, 4)).toBe(false); // after -> outside
    });

    it("returns false when there is no opening ---", () => {
        const lines = ["title: No frontmatter", "content"];
        const doc = mkDoc(lines);
        expect(isInYamlFrontmatter(doc.getLine, doc.last, 0)).toBe(false);
        expect(isInYamlFrontmatter(doc.getLine, doc.last, 1)).toBe(false);
    });

    it("returns true if opening --- exists and no closing yet, for lines below", () => {
        const lines = [
            "---",
            "still frontmatter",
            "no closing yet"
        ];
        const doc = mkDoc(lines);
        expect(isInYamlFrontmatter(doc.getLine, doc.last, 1)).toBe(true);
        expect(isInYamlFrontmatter(doc.getLine, doc.last, 2)).toBe(true);
        // line 0 (opening) is considered outside (cursor on the fence line)
        expect(isInYamlFrontmatter(doc.getLine, doc.last, 0)).toBe(false);
    });
});

describe("markdown: fenced code blocks", () => {
    it("detects cursor inside triple-backtick fence", () => {
        const lines = [
            "para",
            "```js",
            "const a = 1;",
            "```",
            "after"
        ];
        const doc = mkDoc(lines);
        expect(isInFencedCode(doc.getLine, doc.last, 2)).toBe(true);  // inside
        expect(isInFencedCode(doc.getLine, doc.last, 1)).toBe(true);  // on opening line -> treated as inside until closed
        expect(isInFencedCode(doc.getLine, doc.last, 3)).toBe(false); // on closing line -> outside
        expect(isInFencedCode(doc.getLine, doc.last, 4)).toBe(false); // after
    });

    it("detects cursor inside tilde fence", () => {
        const lines = [
            "text",
            "~~~",
            "block",
            "~~~"
        ];
        const doc = mkDoc(lines);
        expect(isInFencedCode(doc.getLine, doc.last, 2)).toBe(true);
        expect(isInFencedCode(doc.getLine, doc.last, 3)).toBe(false);
    });

    it("returns false when no fences present", () => {
        const lines = ["just text", "more text"];
        const doc = mkDoc(lines);
        expect(isInFencedCode(doc.getLine, doc.last, 0)).toBe(false);
        expect(isInFencedCode(doc.getLine, doc.last, 1)).toBe(false);
    });
});

describe("markdown: inline code", () => {
    it("is true when cursor is inside `inline code`", () => {
        const line = "before `code` after";
        // Cursor is after "co"
        const chInside = "before `co".length;
        expect(isInInlineCode(line, chInside)).toBe(true);
    });

    it("is false when cursor is outside inline code", () => {
        const line = "before `code` after";
        const chOutside = line.indexOf("`"); // at the first backtick
        expect(isInInlineCode(line, chOutside)).toBe(false);
        expect(isInInlineCode(line, line.length)).toBe(false); // end of line
    });

    it("ignores escaped backticks and triple-backtick sequences", () => {
        const line1 = "escaped \\` does not toggle `code` here";
        const ch1 = line1.indexOf("here"); // after the inline code closes
        expect(isInInlineCode(line1, ch1)).toBe(false);

        const line2 = "``` not inline ``` still not inline";
        const ch2 = line2.indexOf("still");
        expect(isInInlineCode(line2, ch2)).toBe(false);
    });
});

describe("markdown: math (B-167)", () => {
    /** Cursor at the end of the last line (where a typed separator lands). */
    function atEnd(lines: string[]): boolean {
        const doc = mkDoc(lines);
        const cur = lines.length - 1;
        return isInMath(doc.getLine, doc.last, cur, (lines[cur] ?? "").length);
    }
    function at(lines: string[], line: number, ch: number): boolean {
        const doc = mkDoc(lines);
        return isInMath(doc.getLine, doc.last, line, ch);
    }

    it("inline: inside a closed $a today$ is math (cursor before the closing $)", () => {
        expect(at(["$a today$"], 0, 8)).toBe(true);
        expect(at(["$a today$"], 0, 3)).toBe(true);
    });
    it("inline: after the closing $ is not math (trigger right after closing $)", () => {
        expect(at(["$a$ today "], 0, 10)).toBe(false);
        expect(at(["$a$"], 0, 3)).toBe(false);
    });
    it("inline: before the opening $ is not math", () => {
        expect(at(["today $a$"], 0, 5)).toBe(false);
    });
    it("inline: unclosed opener still being typed counts as math", () => {
        expect(atEnd(["$a <= "])).toBe(true);
        expect(atEnd(["text $x + "])).toBe(true);
    });
    it("inline: closer typed after a trailing space does not make the rest math", () => {
        expect(atEnd(["$a $ and then "])).toBe(true); // `$ ` can't close: preceded by space
        expect(atEnd(["$a$ and then "])).toBe(false);
    });
    it("escaped \\$ never opens or closes math", () => {
        expect(atEnd(["costs \\$x today "])).toBe(false);
        expect(atEnd(["$a \\$ b today$"].map(l => l.slice(0, -1)))).toBe(true); // \$ does not close
        expect(at(["$a\\$b$ c"], 0, 9)).toBe(false);
    });
    it("prices are not math: `costs $5 and $10`", () => {
        expect(atEnd(["costs $5 and $10 "])).toBe(false);
        expect(atEnd(["costs $5 and $10"])).toBe(false);
        expect(atEnd(["$5 today "])).toBe(false);
    });
    it("closing $ followed by a digit does not close", () => {
        // `$a$5` : the second $ is followed by a digit => not a closer; opener stays open
        expect(atEnd(["$a$5 x "])).toBe(true);
    });
    it("a lone $ followed by a space is not an opener", () => {
        expect(atEnd(["cost: $ today "])).toBe(false);
    });
    it("single-line $$x$$: inside is math, after is not", () => {
        expect(at(["$$x$$"], 0, 3)).toBe(true);
        expect(at(["$$x$$ today "], 0, 12)).toBe(false);
    });
    it("display block spanning lines", () => {
        const doc = ["before", "$$", "a <= b", "$$", "after"];
        expect(at(doc, 0, 6)).toBe(false);
        expect(at(doc, 2, 6)).toBe(true);
        expect(at(doc, 3, 0)).toBe(true);  // before the closing $$ token
        expect(at(doc, 3, 2)).toBe(false); // right after the closing $$
        expect(at(doc, 4, 5)).toBe(false);
    });
    it("display block opened on a text line (`$$ a`) and closed later", () => {
        const doc = ["$$ a", "b <= c", "d $$", "after "];
        expect(at(doc, 1, 7)).toBe(true);
        expect(at(doc, 2, 1)).toBe(true);
        expect(at(doc, 3, 6)).toBe(false);
    });
    it("unclosed display block makes everything below math", () => {
        expect(at(["$$", "a", "b"], 2, 1)).toBe(true);
    });
    it("$ inside a fenced code block is ignored (no leak out of the fence)", () => {
        const doc = ["```", "$$", "```", "plain text "];
        expect(at(doc, 3, 11)).toBe(false);
        const doc2 = ["~~~", "$x", "~~~", "plain "];
        expect(at(doc2, 3, 6)).toBe(false);
    });
    it("cursor inside a fence is not reported as math (code guard owns it)", () => {
        expect(at(["$$", "```", "x"], 2, 1)).toBe(false); // inside the fence: left to isInCode
        expect(at(["```", "$x a", "```"], 1, 4)).toBe(false);
    });
    it("$ inside inline code is ignored", () => {
        expect(atEnd(["use `$x` then plain "])).toBe(false);
        expect(atEnd(["``$$`` plain "])).toBe(false);
    });
    it("$$ in YAML frontmatter does not leak into the body", () => {
        const doc = ["---", "price: $$", "---", "body "];
        expect(at(doc, 3, 5)).toBe(false);
    });
    it("empty line / no $ anywhere is not math", () => {
        expect(at([""], 0, 0)).toBe(false);
        expect(at(["plain text "], 0, 11)).toBe(false);
    });
    it("cursor line past lastLine does not throw", () => {
        expect(isInMath((i) => ["a"][i] ?? "", 0, 5, 0)).toBe(false);
    });
    it("price-only line of 20000 tokens stays linear and is not math", () => {
        const line = "$1 ".repeat(20000);
        const t0 = Date.now();
        expect(at([line], 0, line.length)).toBe(false);
        expect(Date.now() - t0).toBeLessThan(2000); // quadratic: ~6 s at 20000 (~390 ms at 5000); linear: ~5 ms
    });
    it("a $ inside an inline-code span is not a closer", () => {
        expect(at(["$a `$` b$ today "], 0, 6)).toBe(true); // opener..real closer at 9 spans the code
        expect(at(["$a `$` b$ today "], 0, 15)).toBe(false); // past the real closer
    });
    it("a code span fully before the opener does not disturb the math scan", () => {
        expect(at(["`x` $a b$ today "], 0, 7)).toBe(true);
        expect(at(["`x` $a b$ today "], 0, 15)).toBe(false);
    });
    it("an unclosed opener followed by prices keeps the typing-in-progress rule", () => {
        expect(at(["$a then $5 $6 "], 0, 14)).toBe(true);
        expect(at(["$5 $6 $a b"], 0, 10)).toBe(true);
    });
    it("a multi-backtick code span inside $…$ is skipped when looking for the closer", () => {
        expect(at(["$a ``b$c`` d$ today "], 0, 18)).toBe(false); // `$` in ``…`` is not a closer; real closer at 12
        expect(at(["$a ``b$c`` d$ today "], 0, 10)).toBe(true); // still inside the span, before the closer
    });
    it("an unclosed backtick run inside $…$ is literal and does not hide the closer", () => {
        expect(at(["$a `b$ today "], 0, 13)).toBe(false); // lone ` is literal, `b$` closes
        expect(at(["$a `b$ today "], 0, 5)).toBe(true);
    });
    it("a $$ pair inside an inline opener is skipped, not taken as a closer", () => {
        expect(at(["$a $$ b$ today "], 0, 15)).toBe(false); // closer is the final lone $
        expect(at(["$a $$ b today "], 0, 14)).toBe(true); // no lone closer: still being typed
    });
    it("an unclosed backtick run outside math is literal, so a later $ still opens math", () => {
        expect(atEnd(["`a $x + "])).toBe(true);
        expect(atEnd(["``a `b` $x$ plain "])).toBe(false); // ``a `b` is unclosed double run; $x$ closed
    });
    it("a line missing from the document (getLine yields undefined) is treated as empty", () => {
        const getLine = (i: number): string => ["$$"][i] as string;
        expect(isInMath(getLine, 3, 3, 0)).toBe(true); // opened `$$` on line 0 carries over blank lines
        expect(isInMath((i) => [][i] as unknown as string, 2, 2, 0)).toBe(false);
    });
    it("frontmatter marker on a single-line document does not swallow the cursor line", () => {
        expect(at(["---"], 0, 3)).toBe(false);
        expect(at(["---", "$a "], 1, 3)).toBe(false); // unclosed frontmatter: the body is YAML
    });
    it("legacy helpers tolerate getLine yielding undefined (missing lines read as empty)", () => {
        const none = (i: number): string => [][i] as unknown as string;
        expect(isInYamlFrontmatter(none, 3, 2)).toBe(false);
        expect(isInYamlFrontmatter((i) => ["---"][i] as string, 3, 2)).toBe(true); // unclosed, line 1+ missing
        expect(isInFencedCode(none, 3, 2)).toBe(false);
    });
});
