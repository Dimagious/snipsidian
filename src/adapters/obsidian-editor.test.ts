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
        applyEditPlan(ed as any, plan, 0);
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
        applyEditPlan(ed as any, plan, 0);
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

    // B-148: on the Obsidian/CM6 versions this now actually runs
    // against (e2e infra was dead — B-146 — until this test round),
    // pressing Enter right after a trigger reports the cursor at
    // column 0 of the brand-new line, not at the end of the line the
    // trigger lived on. `if (cursor.ch === 0) return;` alone used to
    // silently no-op every Enter-terminated trigger.
    it("[B-148] expands when Enter is the separator, reported as cursor at column 0 of a new line", async () => {
        const ed = new MockEditor("fn\n");
        ed.setCursor({ line: 1, ch: 0 }); // as Enter now reports it
        await tryExpandAtSeparator(ed as any, dict, { now: new Date() });
        expect(ed.getLine(0)).toBe("function () {}");
        // The blank line Enter created is untouched.
        expect(ed.getLine(1)).toBe("");
        // B-147: the user's cursor (where Enter put it) is left alone
        // — not yanked back onto the line above.
        expect(ed.getCursor()).toEqual({ line: 1, ch: 0 });
    });

    it("[B-148] does nothing when the previous line does not end with a registered trigger", async () => {
        const ed = new MockEditor("hello world\n");
        ed.setCursor({ line: 1, ch: 0 });
        await tryExpandAtSeparator(ed as any, dict, { now: new Date() });
        expect(ed.getLine(0)).toBe("hello world");
    });

    it("[B-148] does nothing at column 0 of the very first line (nothing precedes it)", async () => {
        const ed = new MockEditor("fn");
        ed.setCursor({ line: 0, ch: 0 });
        await tryExpandAtSeparator(ed as any, dict, { now: new Date() });
        expect(ed.getLine(0)).toBe("fn");
    });

    // B-136: `expand()` awaits `readClipboard()` for real when the
    // matched replacement contains `$clipboard`. If the user keeps
    // typing / presses Enter / moves the cursor during that await,
    // the pre-fix code re-read `editor.getCursor()` inside
    // `applyEditPlan` and applied the edit to whatever line the
    // cursor ended up on — not the line the trigger was actually
    // typed on. This pins the fix: the target line is captured
    // BEFORE the await and the edit always lands there.
    //
    // B-147: the pre-fix code ALSO unconditionally repositioned the
    // cursor per `plan.newCursor` after the edit — even though the
    // user had since moved to a completely different line. That
    // teleported their cursor back onto the (now off-screen) trigger
    // line mid-edit-elsewhere. This test pins both halves: the text
    // edit lands on the original line, and the user's cursor is left
    // exactly where they put it.
    it("[B-136/B-147] applies an async $clipboard expansion to the original trigger line, and does not teleport the cursor away from wherever the user moved it", async () => {
        const ed = new MockEditor("clip ");
        ed.setCursor({ line: 0, ch: 5 }); // cursor right after the separator

        let resolveClipboard: (value: string) => void = () => {};
        const clipboardPromise = new Promise<string>((resolve) => {
            resolveClipboard = resolve;
        });

        const expandPromise = tryExpandAtSeparator(
            ed as any,
            { clip: "$clipboard" },
            {
                filename: "note.md",
                now: new Date("2025-09-02T10:11:12Z"),
                readClipboard: () => clipboardPromise,
            },
        );

        // While the clipboard read is still pending, simulate the
        // user pressing Enter and typing on a new line — the editor
        // now has a second line and the cursor has moved off the
        // trigger's line entirely.
        ed.lines.push("second line");
        const userCursorPosition = { line: 1, ch: "second line".length };
        ed.setCursor(userCursorPosition);

        resolveClipboard("PASTED");
        await expandPromise;

        // Replacement landed on line 0 (the ORIGINAL trigger line).
        expect(ed.getLine(0)).toBe("PASTED ");
        // Line 1, where the cursor moved to during the await, is
        // untouched — no text surgery on the wrong line.
        expect(ed.getLine(1)).toBe("second line");
        // B-147: the cursor was NOT yanked back to the trigger line —
        // it's exactly where the user put it.
        expect(ed.getCursor()).toEqual(userCursorPosition);
    });

    // B-136 staleness guard: if the trigger text itself changed
    // between the snapshot and the (post-await) apply — even on the
    // SAME line — the edit must be skipped rather than blindly
    // overwriting whatever is there now.
    it("[B-136] skips the edit if the target range no longer matches what the plan expected (staleness guard)", async () => {
        const ed = new MockEditor("clip ");
        ed.setCursor({ line: 0, ch: 5 });

        let resolveClipboard: (value: string) => void = () => {};
        const clipboardPromise = new Promise<string>((resolve) => {
            resolveClipboard = resolve;
        });

        const expandPromise = tryExpandAtSeparator(
            ed as any,
            { clip: "$clipboard" },
            {
                now: new Date("2025-09-02T10:11:12Z"),
                readClipboard: () => clipboardPromise,
            },
        );

        // Mutate the SAME line's trigger text while the clipboard
        // read is pending (e.g. a fast Backspace + retype).
        ed.lines[0] = "xxxx ";

        resolveClipboard("PASTED");
        await expandPromise;

        // The plan's range no longer holds "clip" — skip rather than
        // corrupt the user's edit.
        expect(ed.getLine(0)).toBe("xxxx ");
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

        // Fold-in (tests#6): the multiline template must actually
        // split the document into three real lines — a single "line"
        // containing embedded `\n` characters (as this test asserted
        // pre-fix) is an editor state no real Obsidian document can
        // be in; `MockEditor.replaceSelection` now delegates to
        // `replaceRange`, which splits correctly.
        expect(ed.getLine(0)).toBe("Hello A");
        expect(ed.getLine(1)).toBe("world");
        expect(ed.getLine(2)).toBe("B");
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
