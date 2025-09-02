import { describe, it, expect, beforeEach } from "vitest";
import { expandIfTriggered, isSeparator, findWordStart } from "./expander";

/**
 * Minimal Editor mock for core/expander tests.
 * Provides enough behavior for expandIfTriggered to operate.
 */
class MockEditor {
    lines: string[];
    cursor = { line: 0, ch: 0 };

    constructor(text: string | string[]) {
        this.lines = Array.isArray(text) ? text.slice() : (text as string).split("\n");
    }

    getCursor() {
        return { ...this.cursor };
    }

    setCursor(pos: { line: number; ch: number }) {
        this.cursor = { line: pos.line, ch: pos.ch };
    }

    getLine(i: number) {
        return this.lines[i] ?? "";
    }

    lastLine() {
        return this.lines.length - 1;
    }

    /**
     * Replace a range [from, to) with text. Supports multi-line inserts.
     */
    replaceRange(
        text: string,
        from: { line: number; ch: number },
        to: { line: number; ch: number }
    ) {
        const startLine = this.lines[from.line] ?? "";
        const endLine = this.lines[to.line] ?? "";
        const before = startLine.slice(0, from.ch);
        const after = endLine.slice(to.ch);

        const insertLines = text.split("\n");

        if (from.line === to.line) {
            if (insertLines.length === 1) {
                this.lines[from.line] = before + text + after;
            } else {
                const newLines = [
                    before + insertLines[0],
                    ...insertLines.slice(1, -1),
                    insertLines[insertLines.length - 1] + after,
                ];
                this.lines.splice(from.line, 1, ...newLines);
            }
        } else {
            const head = this.lines.slice(0, from.line);
            const tail = this.lines.slice(to.line + 1);
            const midFirst = before + insertLines[0];
            const midLast = insertLines[insertLines.length - 1] + after;
            const mids = insertLines.slice(1, -1);
            this.lines = [...head, midFirst, ...mids, midLast, ...tail];
        }
    }
}

describe("core/expander: isSeparator", () => {
    it("recognizes whitespace and punctuation as separators (as implemented in core)", () => {
        // NOTE: core/expander.ts does NOT include '|' as a separator — keep this list in sync.
        for (const ch of [" ", "\t", "\n", ".", ",", "!", "?", ";", ":", "(", ")", "[", "]", "{", "}", "\"", "'", "-", "\\", "/"]) {
            expect(isSeparator(ch)).toBe(true);
        }
    });

    it("non-separators: letters, digits, underscore", () => {
        for (const ch of ["a", "Z", "0", "9", "_"]) {
            expect(isSeparator(ch)).toBe(false);
        }
    });
});

describe("core/expander: findWordStart (ASCII word definition)", () => {
    it("returns start index for a simple ASCII word", () => {
        const line = "hello fn";
        // endIndex points at 'n' (last char of 'fn'), which is at position line.length - 1
        const idx = findWordStart(line, line.length - 1);
        expect(idx).toBe("hello ".length);
    });

    it("returns null if endIndex isn't a word char", () => {
        const line = "hello ";
        const idx = findWordStart(line, line.length - 1); // space
        expect(idx).toBeNull();
    });
});

describe("core/expander: expandIfTriggered", () => {
    let snippets: Record<string, string>;

    beforeEach(() => {
        snippets = {
            fn: "function $|() {}",
            brb: "be right back"
        };
    });

    it("expands known trigger on separator and keeps the separator (undo-friendly)", () => {
        const ed = new MockEditor("fn ");
        ed.setCursor({ line: 0, ch: 3 }); // after the space (separator just typed)
        expandIfTriggered(ed as any, snippets);

        // Replaced only 'fn', space preserved
        expect(ed.getLine(0)).toBe("function () {} ");
        // Cursor moved to placeholder position
        expect(ed.getCursor()).toEqual({ line: 0, ch: "function ".length });
    });

    it("does nothing when no separator has been typed", () => {
        const ed = new MockEditor("fn");
        ed.setCursor({ line: 0, ch: 2 });
        expandIfTriggered(ed as any, snippets);
        expect(ed.getLine(0)).toBe("fn");
    });

    it("does nothing for unknown trigger", () => {
        const ed = new MockEditor("xx ");
        ed.setCursor({ line: 0, ch: 3 });
        expandIfTriggered(ed as any, snippets);
        expect(ed.getLine(0)).toBe("xx ");
    });

    it("does not expand inside inline code", () => {
        const ed = new MockEditor("before `fn ` after");
        // place cursor right after the space inside inline code
        const ch = "before `fn ".length;
        ed.setCursor({ line: 0, ch });
        expandIfTriggered(ed as any, snippets);
        expect(ed.getLine(0)).toBe("before `fn ` after"); // unchanged
    });

    it("does not expand inside fenced code block", () => {
        const ed = new MockEditor([
            "```",
            "fn ",
            "```"
        ]);
        ed.setCursor({ line: 1, ch: 3 }); // after space inside fence
        expandIfTriggered(ed as any, snippets);
        expect(ed.getLine(1)).toBe("fn "); // unchanged
    });

    it("does not expand inside YAML frontmatter", () => {
        const ed = new MockEditor([
            "---",
            "fn ",
            "---",
            "content"
        ]);
        ed.setCursor({ line: 1, ch: 3 }); // inside frontmatter
        expandIfTriggered(ed as any, snippets);
        expect(ed.getLine(1)).toBe("fn "); // unchanged
    });

    it("expands another trigger without $| and leaves cursor unchanged (by design)", () => {
        const ed = new MockEditor("brb ");
        ed.setCursor({ line: 0, ch: 4 }); // after the space
        expandIfTriggered(ed as any, snippets);
        expect(ed.getLine(0)).toBe("be right back ");
        // No $| in replacement -> plugin keeps cursor position as-is
        expect(ed.getCursor()).toEqual({ line: 0, ch: 4 });
    });
});
