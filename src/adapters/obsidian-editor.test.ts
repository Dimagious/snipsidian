import { describe, it, expect, beforeEach, vi } from "vitest";
import { makeExpandInput, makeContext, applyEditPlan, tryExpandAtSeparator, insertSnippetAtCursor, wrapSelectionWithSnippet } from "./obsidian-editor";
import type { Dict } from "../engine/types";
import { MockEditor } from "../test/factories/editor";

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
    it("replaces range and sets new cursor position on the same line", () => {
        const ed = new MockEditor("fn ");
        ed.setCursor({ line: 0, ch: 3 }); // after space
        const plan = {
            fromCh: 0,
            toCh: 2,
            insert: "function () {}",
            newCursor: { lineDelta: 0, ch: "function ".length },
        };
        applyEditPlan(ed as any, plan);
        expect(ed.getLine(0)).toBe("function () {} ");
        expect(ed.getCursor()).toEqual({ line: 0, ch: "function ".length });
    });

    // Regression: F-001 — multi-line insert must move the cursor to the inserted
    // line, not stay on the original trigger line.
    it("places cursor on a later line for multi-line inserts", () => {
        const ed = new MockEditor("cb ");
        ed.setCursor({ line: 0, ch: 3 });
        const plan = {
            fromCh: 0,
            toCh: 2,
            insert: "> [!note] \n> ",
            newCursor: { lineDelta: 1, ch: "> ".length },
        };
        applyEditPlan(ed as any, plan);
        expect(ed.getLine(0)).toBe("> [!note] ");
        expect(ed.getLine(1)).toBe(">  ");
        expect(ed.getCursor()).toEqual({ line: 1, ch: "> ".length });
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

describe("adapters/obsidian-editor: insertSnippetAtCursor", () => {
    it("should insert snippet at cursor position", () => {
        const ed = new MockEditor("Hello world");
        ed.setCursor({ line: 0, ch: 6 }); // after "Hello "
        
        insertSnippetAtCursor(ed as any, "beautiful ");
        
        expect(ed.getLine(0)).toBe("Hello beautiful world");
        expect(ed.getCursor()).toEqual({ line: 0, ch: 16 }); // after inserted text
    });

    it("should handle cursor placeholder", () => {
        const ed = new MockEditor("Hello world");
        ed.setCursor({ line: 0, ch: 6 }); // after "Hello "
        
        insertSnippetAtCursor(ed as any, "beautiful $| day");
        
        expect(ed.getLine(0)).toBe("Hello beautiful  dayworld"); // $| removed, cursor at position
        expect(ed.getCursor()).toEqual({ line: 0, ch: 16 }); // cursor at $| position
    });

    it("should handle cursor placeholder at start of replacement", () => {
        const ed = new MockEditor("Hello world");
        ed.setCursor({ line: 0, ch: 6 });

        insertSnippetAtCursor(ed as any, "$|beautiful ");

        expect(ed.getLine(0)).toBe("Hello beautiful world");
        expect(ed.getCursor()).toEqual({ line: 0, ch: 6 });
    });

    it("should place cursor correctly for multiline replacement", () => {
        const ed = new MockEditor("Hello world");
        ed.setCursor({ line: 0, ch: 6 });

        insertSnippetAtCursor(ed as any, "one\n$|two");

        expect(ed.getLine(0)).toBe("Hello one");
        expect(ed.getLine(1)).toBe("twoworld");
        expect(ed.getCursor()).toEqual({ line: 1, ch: 0 });
    });

    it("should replace selection if present", () => {
        const ed = new MockEditor("Hello world");
        ed.setCursor({ line: 0, ch: 11 }); // end of line
        ed.selection = "world"; // simulate selection
        
        insertSnippetAtCursor(ed as any, "universe");
        
        expect(ed.getLine(0)).toBe("Hello universe");
        expect(ed.getCursor()).toEqual({ line: 0, ch: 14 });
    });
});

describe("adapters/obsidian-editor: wrapSelectionWithSnippet", () => {
    it("should wrap selection with ${SEL} placeholder", () => {
        const ed = new MockEditor("Hello world");
        ed.setCursor({ line: 0, ch: 11 });
        ed.selection = "world";
        
        wrapSelectionWithSnippet(ed as any, "**${SEL}**");
        
        expect(ed.getLine(0)).toBe("Hello **world**");
    });

    it("should wrap selection with $1 placeholder", () => {
        const ed = new MockEditor("Hello world");
        ed.setCursor({ line: 0, ch: 11 });
        ed.selection = "world";
        
        wrapSelectionWithSnippet(ed as any, "**$1**");
        
        expect(ed.getLine(0)).toBe("Hello **world**");
    });

    it("should place cursor correctly for multiline wrapping template", () => {
        const ed = new MockEditor("Hello world");
        ed.setCursor({ line: 0, ch: 11 });
        ed.selection = "world";

        wrapSelectionWithSnippet(ed as any, "A\n$|${SEL}\nB");

        expect(ed.getLine(0)).toBe("Hello A\nworld\nB");
        expect(ed.getCursor()).toEqual({ line: 1, ch: 0 });
    });

    it("should replace selection if no wrapping placeholders", () => {
        const ed = new MockEditor("Hello world");
        ed.setCursor({ line: 0, ch: 11 });
        ed.selection = "world";
        
        wrapSelectionWithSnippet(ed as any, "universe");
        
        expect(ed.getLine(0)).toBe("Hello universe");
    });

    it("should insert at cursor if no selection", () => {
        const ed = new MockEditor("Hello world");
        ed.setCursor({ line: 0, ch: 6 }); // after "Hello "
        
        wrapSelectionWithSnippet(ed as any, "beautiful ");
        
        expect(ed.getLine(0)).toBe("Hello beautiful world");
    });

    it("should handle setCursor errors gracefully in insertSnippetAtCursor", () => {
        const ed = new MockEditor("Hello world");
        ed.setCursor({ line: 0, ch: 6 });
        
        // Mock setCursor to throw an error
        const originalSetCursor = ed.setCursor;
        ed.setCursor = vi.fn().mockImplementation(() => {
            throw new Error("Cursor error");
        });
        
        // Mock console.warn to avoid noise in tests
        const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        
        insertSnippetAtCursor(ed as any, "beautiful $| universe");
        
        expect(consoleSpy).toHaveBeenCalledWith("Failed to set cursor position:", expect.any(Error));
        
        // Restore
        ed.setCursor = originalSetCursor;
        consoleSpy.mockRestore();
    });

    it("should handle setCursor errors gracefully in insertSnippetAtCursor with selection", () => {
        const ed = new MockEditor("Hello world");
        ed.setCursor({ line: 0, ch: 6 });
        ed.selection = "world";
        
        // Mock setCursor to throw an error
        const originalSetCursor = ed.setCursor;
        ed.setCursor = vi.fn().mockImplementation(() => {
            throw new Error("Cursor error");
        });
        
        // Mock console.warn to avoid noise in tests
        const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        
        insertSnippetAtCursor(ed as any, "beautiful $| universe");
        
        expect(consoleSpy).toHaveBeenCalledWith("Failed to set cursor position:", expect.any(Error));
        
        // Restore
        ed.setCursor = originalSetCursor;
        consoleSpy.mockRestore();
    });

    it("should handle setCursor errors gracefully in wrapSelectionWithSnippet", () => {
        const ed = new MockEditor("Hello world");
        ed.setCursor({ line: 0, ch: 6 });
        ed.selection = "world";
        
        // Mock setCursor to throw an error
        const originalSetCursor = ed.setCursor;
        ed.setCursor = vi.fn().mockImplementation(() => {
            throw new Error("Cursor error");
        });
        
        // Mock console.warn to avoid noise in tests
        const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        
        wrapSelectionWithSnippet(ed as any, "beautiful $| universe");
        
        expect(consoleSpy).toHaveBeenCalledWith("Failed to set cursor position:", expect.any(Error));
        
        // Restore
        ed.setCursor = originalSetCursor;
        consoleSpy.mockRestore();
    });
});
