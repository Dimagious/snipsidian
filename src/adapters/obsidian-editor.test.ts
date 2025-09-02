import { describe, it, expect, beforeEach } from "vitest";
import { makeExpandInput, makeContext, applyEditPlan, tryExpandAtSeparator } from "./obsidian-editor";
import type { Dict } from "../engine/types";

/**
 * Minimal in-memory Editor mock that supports just what's needed by the adapter.
 * It stores document lines, a cursor, and implements replaceRange / setCursor.
 */
class MockEditor {
    lines: string[];
    cursor = { line: 0, ch: 0 };

    constructor(text: string) {
        this.lines = text.split("\n");
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
    replaceRange(text: string, from: { line: number; ch: number }, to: { line: number; ch: number }) {
        const startLine = this.lines[from.line] ?? "";
        const endLine = this.lines[to.line] ?? "";
        const before = startLine.slice(0, from.ch);
        const after = endLine.slice(to.ch);

        const insertLines = text.split("\n");

        if (from.line === to.line) {
            if (insertLines.length === 1) {
                this.lines[from.line] = before + text + after;
            } else {
                // split current line into multiple
                const newLines = [
                    before + insertLines[0],
                    ...insertLines.slice(1, -1),
                    insertLines[insertLines.length - 1] + after,
                ];
                // replace one line by multiple: splice
                this.lines.splice(from.line, 1, ...newLines);
            }
        } else {
            // Multi-line replace across different lines — collapse range first, then insert
            const head = this.lines.slice(0, from.line);
            const tail = this.lines.slice(to.line + 1);
            const midFirst = before + insertLines[0];
            const midLast = insertLines[insertLines.length - 1] + after;
            const mids = insertLines.slice(1, -1);
            this.lines = [...head, midFirst, ...mids, midLast, ...tail];
        }
    }
}

describe("adapters/obsidian-editor: makeExpandInput", () => {
    it("builds ExpandInput slice around the separator", () => {
        const ed = new MockEditor("hello fn world");
        ed.setCursor({ line: 0, ch: "hello fn ".length }); // cursor is right after the space
        const sepCh = ed.getCursor().ch - 1;
        const lastTyped = ed.getLine(0)[sepCh];

        const input = makeExpandInput(ed as any, sepCh, lastTyped);
        expect(input.textBefore).toBe("hello fn");
        expect(input.textAfter).toBe("world");
        expect(input.lastTyped).toBe(" ");
        expect(input.sepCh).toBe("hello fn".length);
    });
});

describe("adapters/obsidian-editor: makeContext", () => {
    it("marks inline code as code context", () => {
        const ed = new MockEditor("before `code` after");
        // Cursor inside `code`
        const ch = "before `co".length;
        ed.setCursor({ line: 0, ch });

        const ctx = makeContext(ed as any, "note.md", new Date("2025-09-02T10:11:12Z"));
        expect(ctx.isInCode).toBe(true);
        expect(ctx.isInFrontmatter).toBe(false);
        expect(ctx.filename).toBe("note.md");
    });

    it("marks YAML frontmatter as frontmatter context", () => {
        const ed = new MockEditor(["---", "title: X", "tags: a", "---", "text"].join("\n"));
        ed.setCursor({ line: 1, ch: 2 }); // inside frontmatter
        const ctx = makeContext(ed as any, undefined, new Date());
        expect(ctx.isInFrontmatter).toBe(true);
        expect(ctx.isInCode).toBe(false);
    });
});

describe("adapters/obsidian-editor: applyEditPlan", () => {
    it("replaces range and sets new cursor position", () => {
        const ed = new MockEditor("fn ");
        ed.setCursor({ line: 0, ch: 3 }); // after space
        const plan = {
            fromCh: 0,
            toCh: 2,
            insert: "function () {}",
            newCursorCh: "function ".length,
        };
        applyEditPlan(ed as any, plan);
        expect(ed.getLine(0)).toBe("function () {} ");
        expect(ed.getCursor()).toEqual({ line: 0, ch: "function ".length });
    });
});

describe("adapters/obsidian-editor: tryExpandAtSeparator", () => {
    let dict: Dict;

    beforeEach(() => {
        dict = { fn: "function $|() {}" };
    });

    it("expands when the last typed character is a separator", async () => {
        const ed = new MockEditor("fn ");
        ed.setCursor({ line: 0, ch: 3 }); // cursor after the space (separator)
        await tryExpandAtSeparator(ed as any, dict, {
            filename: "note.md",
            now: new Date("2025-09-02T10:11:12Z"),
            readClipboard: async () => "CLIP",
        });
        expect(ed.getLine(0)).toBe("function () {} ");
        expect(ed.getCursor()).toEqual({ line: 0, ch: "function ".length });
    });

    it("does nothing if the last typed char is not a separator", async () => {
        const ed = new MockEditor("fn"); // no trailing separator
        ed.setCursor({ line: 0, ch: 2 });
        await tryExpandAtSeparator(ed as any, dict, {
            now: new Date(),
        });
        expect(ed.getLine(0)).toBe("fn");
    });

    it("does nothing inside inline code context", async () => {
        const ed = new MockEditor("before `fn ` after");
        // place cursor just after the space inside the inline code
        const ch = "before `fn ".length;
        ed.setCursor({ line: 0, ch });
        await tryExpandAtSeparator(ed as any, dict, { now: new Date() });
        expect(ed.getLine(0)).toBe("before `fn ` after"); // unchanged
    });
});
