import { describe, it, expect } from "vitest";
import { isInYamlFrontmatter, isInFencedCode, isInInlineCode } from "./markdown";

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
