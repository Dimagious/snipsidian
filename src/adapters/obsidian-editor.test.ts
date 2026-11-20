import { describe, it, expect, beforeEach, vi } from "vitest";

// Capture `new Notice(msg)` so B-199 tests can assert the stale-target notice.
const noticeCalls = vi.hoisted(() => [] as string[]);
vi.mock("obsidian", async () => {
    const actual = await vi.importActual("../test/stubs/obsidian");
    return {
        ...actual,
        Notice: vi.fn().mockImplementation(function (msg: string) {
            noticeCalls.push(msg);
        }),
    };
});

import { makeExpandInput, makeContext, applyEditPlan, tryExpandAtSeparator, tryExpandAtCursor, tryExpandInstant, canExpandAtCursor, insertSnippetAtCursor, wrapSelectionWithSnippet, PATTERN_USER_EVENT, type PairedCloser } from "./obsidian-editor";
import { compilePatternRules } from "../engine/patterns";
import type { Dict, PatternRule } from "../engine/types";
import { MockEditor, asEditor } from "../test/factories/editor";

describe("adapters/obsidian-editor: makeExpandInput", () => {
    it("builds ExpandInput slice around the separator", () => {
        const ed = new MockEditor("hello fn world");
        ed.setCursor({ line: 0, ch: "hello fn ".length }); // cursor is right after the space
        const sepCh = ed.getCursor().ch - 1;
        const lastTyped = ed.getLine(0).charAt(sepCh);

        const input = makeExpandInput(asEditor(ed), sepCh, lastTyped);
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

        const ctx = makeContext(asEditor(ed), "note.md", new Date("2025-09-02T10:11:12Z"));
        expect(ctx.isInCode).toBe(true);
        expect(ctx.isInFrontmatter).toBe(false);
        expect(ctx.filename).toBe("note.md");
    });

    it("marks YAML frontmatter as frontmatter context", () => {
        const ed = new MockEditor(["---", "title: X", "tags: a", "---", "text"].join("\n"));
        ed.setCursor({ line: 1, ch: 2 }); // inside frontmatter
        const ctx = makeContext(asEditor(ed), undefined, new Date());
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
        applyEditPlan(asEditor(ed), plan, 0);
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
        applyEditPlan(asEditor(ed), plan, 0);
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
        await tryExpandAtSeparator(asEditor(ed), dict, {
            filename: "note.md",
            now: new Date("2025-09-02T10:11:12Z"),
            readClipboard: async () => "CLIP",
        });
        expect(ed.getLine(0)).toBe("function () {} ");
        expect(ed.getCursor()).toEqual({ line: 0, ch: "function ".length });
    });

    describe("[B-176] reports where the expansion landed", () => {
        const deps = { now: new Date() };

        it("returns offsets, the replaced text and the separator", async () => {
            const ed = new MockEditor("fn ");
            ed.setCursor({ line: 0, ch: 3 });
            const result = await tryExpandAtSeparator(asEditor(ed), { fn: "function" }, deps);
            expect(result).toEqual({ from: 0, insert: "function", original: "fn", separator: " " });
            expect(ed.getLine(0)).toBe("function ");
        });

        it("offsets count the newlines of earlier lines", async () => {
            const ed = new MockEditor("first\nsecond fn,");
            ed.setCursor({ line: 1, ch: 10 });
            const result = await tryExpandAtSeparator(asEditor(ed), { fn: "A\nB" }, deps);
            expect(result).toEqual({ from: 13, insert: "A\nB", original: "fn", separator: "," });
        });

        it("covers a multi-line insert and an Enter separator", async () => {
            const ed = new MockEditor("fn\n");
            ed.setCursor({ line: 1, ch: 0 });
            const result = await tryExpandAtSeparator(asEditor(ed), { fn: "> a\n> b" }, deps);
            expect(result).toEqual({ from: 0, insert: "> a\n> b", original: "fn", separator: "\n" });
        });

        it("includes the consumed prefix char in `original` (B-137)", async () => {
            const ed = new MockEditor("x :fn ");
            ed.setCursor({ line: 0, ch: 6 });
            const result = await tryExpandAtSeparator(asEditor(ed), { fn: "function" }, { ...deps, prefix: ":" });
            expect(result).toEqual({ from: 2, insert: "function", original: ":fn", separator: " " });
        });

        it("returns undefined when nothing expanded", async () => {
            const ed = new MockEditor("zz ");
            ed.setCursor({ line: 0, ch: 3 });
            expect(await tryExpandAtSeparator(asEditor(ed), { fn: "function" }, deps)).toBeUndefined();
            const ed2 = new MockEditor("fn");
            ed2.setCursor({ line: 0, ch: 2 });
            expect(await tryExpandAtSeparator(asEditor(ed2), { fn: "function" }, deps)).toBeUndefined();
        });
    });

    it("does nothing if the last typed char is not a separator", async () => {
        const ed = new MockEditor("fn"); // no trailing separator
        ed.setCursor({ line: 0, ch: 2 });
        await tryExpandAtSeparator(asEditor(ed), dict, {
            now: new Date(),
        });
        expect(ed.getLine(0)).toBe("fn");
    });

    it("does nothing inside inline code context", async () => {
        const ed = new MockEditor("before `fn ` after");
        // place cursor just after the space inside the inline code
        const ch = "before `fn ".length;
        ed.setCursor({ line: 0, ch });
        await tryExpandAtSeparator(asEditor(ed), dict, { now: new Date() });
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
        await tryExpandAtSeparator(asEditor(ed), dict, { now: new Date() });
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
        await tryExpandAtSeparator(asEditor(ed), dict, { now: new Date() });
        expect(ed.getLine(0)).toBe("hello world");
    });

    it("[B-148] does nothing at column 0 of the very first line (nothing precedes it)", async () => {
        const ed = new MockEditor("fn");
        ed.setCursor({ line: 0, ch: 0 });
        await tryExpandAtSeparator(asEditor(ed), dict, { now: new Date() });
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
    // exactly where they put it. The `$|` marker gives the plan a
    // `newCursor`, so without the guard the cursor WOULD be yanked back.
    it("[B-136/B-147] applies an async $clipboard expansion to the original trigger line, and does not teleport the cursor away from wherever the user moved it", async () => {
        const ed = new MockEditor("clip ");
        ed.setCursor({ line: 0, ch: 5 }); // cursor right after the separator

        let resolveClipboard: (value: string) => void = () => {};
        const clipboardPromise = new Promise<string>((resolve) => {
            resolveClipboard = resolve;
        });

        const expandPromise = tryExpandAtSeparator(
            asEditor(ed),
            { clip: "$clipboard$|" },
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
            asEditor(ed),
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

describe("adapters/obsidian-editor: makeContext formatDate (B-166)", () => {
    it("formats via Obsidian's moment, including [literal] escapes", () => {
        const ed = new MockEditor("x");
        const ctx = makeContext(asEditor(ed), undefined, new Date("2025-09-02T10:11:12"));
        expect(ctx.formatDate?.(ctx.now, "YYYY-MM-DD HH:mm")).toBe("2025-09-02 10:11");
        expect(ctx.formatDate?.(ctx.now, "[Week] W, [YYYY]")).toBe("Week 36, YYYY");
    });
});

describe("adapters/obsidian-editor: B-204 {{title}} and B-218 {{notedate:FMT}}", () => {
    const now = new Date("2025-09-02T10:11:12");

    it("makeContext carries the basename and a note-date formatter bound to it", () => {
        const ctx = makeContext(asEditor(new MockEditor("x")), "2026-12-31.md", now, undefined, undefined, undefined, "2026-12-31");
        expect(ctx.basename).toBe("2026-12-31");
        expect(ctx.formatNoteDate?.("GGGG-[W]WW")).toBe("2026-W53");
    });

    it("makeContext without a note: {{notedate}} is empty", () => {
        const ctx = makeContext(asEditor(new MockEditor("x")), undefined, now);
        expect(ctx.basename).toBeUndefined();
        expect(ctx.formatNoteDate?.("YYYY")).toBe("");
    });

    it("hotstring path: {{title}} drops the extension and keeps dots in the name", async () => {
        const ed = new MockEditor("hd ");
        ed.setCursor({ line: 0, ch: 3 });
        await tryExpandAtSeparator(asEditor(ed), { hd: "# {{title}} ($filename) $|" }, {
            filename: "v1.2 notes.md",
            basename: "v1.2 notes",
            now,
        });
        expect(ed.getLine(0)).toBe("# v1.2 notes (v1.2 notes.md)  ");
        expect(ed.getCursor()).toEqual({ line: 0, ch: "# v1.2 notes (v1.2 notes.md) ".length });
    });

    it("hotstring path: no active file gives an empty {{title}} and {{notedate}}", async () => {
        const ed = new MockEditor("hd ");
        ed.setCursor({ line: 0, ch: 3 });
        await tryExpandAtSeparator(asEditor(ed), { hd: "[{{title}}|{{notedate:YYYY}}]" }, { now });
        expect(ed.getLine(0)).toBe("[|] ");
    });

    it("hotstring path: {{notedate:FMT}} uses the date in the note's name", async () => {
        const ed = new MockEditor("wk ");
        ed.setCursor({ line: 0, ch: 3 });
        await tryExpandAtSeparator(asEditor(ed), { wk: "{{notedate:GGGG-[W]WW}}" }, {
            filename: "2027-01-01.md",
            basename: "2027-01-01",
            now,
        });
        expect(ed.getLine(0)).toBe("2026-W53 ");
    });

    it("hotstring path: a note that is not a date gives an empty {{notedate:FMT}}", async () => {
        const ed = new MockEditor("wk ");
        ed.setCursor({ line: 0, ch: 3 });
        await tryExpandAtSeparator(asEditor(ed), { wk: "<{{notedate:YYYY}}>" }, { filename: "Plan.md", basename: "Plan", now });
        expect(ed.getLine(0)).toBe("<> ");
    });

    it("picker insert path (B-197): {{title}} and {{notedate:FMT}} are substituted before $|", async () => {
        const ed = new MockEditor("");
        await insertSnippetAtCursor(asEditor(ed), "{{title}} / {{notedate:DD.MM}}$|!", {
            now,
            filename: "2026-12-31.md",
            basename: "2026-12-31",
        });
        expect(ed.getLine(0)).toBe("2026-12-31 / 31.12!");
        expect(ed.getCursor()).toEqual({ line: 0, ch: "2026-12-31 / 31.12".length });
    });

    it("picker insert path: a note named `a $| b` keeps its text and the caret stays at the real $|", async () => {
        const ed = new MockEditor("");
        await insertSnippetAtCursor(asEditor(ed), "{{title}} $|!", { now, basename: "a $| b $date" });
        expect(ed.getLine(0)).toBe("a $| b $date !");
        expect(ed.getCursor()).toEqual({ line: 0, ch: "a $| b $date ".length });
    });

    it("picker wrap path: a note named `a $| b` is inserted as written and does not take the caret", async () => {
        const ed = new MockEditor("Hello world");
        ed.setCursor({ line: 0, ch: 11 });
        ed.selection = "world";
        await wrapSelectionWithSnippet(asEditor(ed), "{{title}} [$1]", { now, basename: "a $| b" });
        expect(ed.getLine(0)).toBe("Hello a $| b [world]");
    });

    it("picker wrap path: the selection stays and {{title}} is substituted", async () => {
        const ed = new MockEditor("Hello world");
        ed.setCursor({ line: 0, ch: 11 });
        ed.selection = "world";
        await wrapSelectionWithSnippet(asEditor(ed), "[$1]({{title}})", { now, basename: "Plan", filename: "Plan.md" });
        expect(ed.getLine(0)).toBe("Hello [world](Plan)");
    });
});

describe("adapters/obsidian-editor: insertSnippetAtCursor", () => {
    it("[B-192] $1 becomes the cursor and never leaks as text", async () => {
        const ed = new MockEditor("Hello world");
        ed.setCursor({ line: 0, ch: 6 });
        await insertSnippetAtCursor(asEditor(ed), "[$1](url)");
        expect(ed.getLine(0)).toBe("Hello [](url)world");
        expect(ed.getCursor()).toEqual({ line: 0, ch: 7 });
    });

    it("should insert snippet at cursor position", async () => {
        const ed = new MockEditor("Hello world");
        ed.setCursor({ line: 0, ch: 6 }); // after "Hello "
        
        await insertSnippetAtCursor(asEditor(ed), "beautiful ");
        
        expect(ed.getLine(0)).toBe("Hello beautiful world");
        expect(ed.getCursor()).toEqual({ line: 0, ch: 16 }); // after inserted text
    });

    it("should handle cursor placeholder", async () => {
        const ed = new MockEditor("Hello world");
        ed.setCursor({ line: 0, ch: 6 }); // after "Hello "
        
        await insertSnippetAtCursor(asEditor(ed), "beautiful $| day");
        
        expect(ed.getLine(0)).toBe("Hello beautiful  dayworld"); // $| removed, cursor at position
        expect(ed.getCursor()).toEqual({ line: 0, ch: 16 }); // cursor at $| position
    });

    it("should handle cursor placeholder at start of replacement", async () => {
        const ed = new MockEditor("Hello world");
        ed.setCursor({ line: 0, ch: 6 });

        await insertSnippetAtCursor(asEditor(ed), "$|beautiful ");

        expect(ed.getLine(0)).toBe("Hello beautiful world");
        expect(ed.getCursor()).toEqual({ line: 0, ch: 6 });
    });

    it("should place cursor correctly for multiline replacement", async () => {
        const ed = new MockEditor("Hello world");
        ed.setCursor({ line: 0, ch: 6 });

        await insertSnippetAtCursor(asEditor(ed), "one\n$|two");

        expect(ed.getLine(0)).toBe("Hello one");
        expect(ed.getLine(1)).toBe("twoworld");
        expect(ed.getCursor()).toEqual({ line: 1, ch: 0 });
    });

    it("should replace selection if present", async () => {
        const ed = new MockEditor("Hello world");
        ed.setCursor({ line: 0, ch: 11 }); // end of line
        ed.selection = "world"; // simulate selection
        
        await insertSnippetAtCursor(asEditor(ed), "universe");
        
        expect(ed.getLine(0)).toBe("Hello universe");
        expect(ed.getCursor()).toEqual({ line: 0, ch: 14 });
    });
});

describe("adapters/obsidian-editor: wrapSelectionWithSnippet", () => {
    it("should wrap selection with ${SEL} placeholder", async () => {
        const ed = new MockEditor("Hello world");
        ed.setCursor({ line: 0, ch: 11 });
        ed.selection = "world";
        
        await wrapSelectionWithSnippet(asEditor(ed), "**${SEL}**");
        
        expect(ed.getLine(0)).toBe("Hello **world**");
    });

    it("should wrap selection with $1 placeholder", async () => {
        const ed = new MockEditor("Hello world");
        ed.setCursor({ line: 0, ch: 11 });
        ed.selection = "world";
        
        await wrapSelectionWithSnippet(asEditor(ed), "**$1**");
        
        expect(ed.getLine(0)).toBe("Hello **world**");
    });

    it("[F3] strips $2..$9 in the wrap path: function $1($2) { $| }", async () => {
        const ed = new MockEditor("foo");
        ed.setCursor({ line: 0, ch: 3 });
        ed.selection = "foo";
        await wrapSelectionWithSnippet(asEditor(ed), "function $1($2) { $| }");
        expect(ed.getLine(0)).toBe("function foo() {  }");
        expect(ed.getCursor()).toEqual({ line: 0, ch: "function foo() { ".length });
    });

    it("[F3] a selection containing $2 or $& is inserted verbatim", async () => {
        const ed = new MockEditor("x");
        ed.setCursor({ line: 0, ch: 1 });
        ed.selection = "a $2 $& $1";
        await wrapSelectionWithSnippet(asEditor(ed), "[$1] $2");
        expect(ed.getLine(0)).toBe("[a $2 $& $1] ");
    });

    it("[F3] escapes and code are honoured, only the first $1 is the slot", async () => {
        const ed = new MockEditor("w");
        ed.setCursor({ line: 0, ch: 1 });
        ed.selection = "w";
        await wrapSelectionWithSnippet(asEditor(ed), "\\$1 `$1` $1 $1");
        expect(ed.getLine(0)).toBe("$1 `$1` w ");
    });

    it("[F3] ${SEL} wins and every tabstop is stripped", async () => {
        const ed = new MockEditor("w");
        ed.setCursor({ line: 0, ch: 1 });
        ed.selection = "w";
        await wrapSelectionWithSnippet(asEditor(ed), "<${SEL}|$1|$2>");
        expect(ed.getLine(0)).toBe("<w||>");
    });

    it("should place cursor correctly for multiline wrapping template", async () => {
        const ed = new MockEditor("Hello world");
        ed.setCursor({ line: 0, ch: 11 });
        ed.selection = "world";

        await wrapSelectionWithSnippet(asEditor(ed), "A\n$|${SEL}\nB");

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

    it("should replace selection if no wrapping placeholders", async () => {
        const ed = new MockEditor("Hello world");
        ed.setCursor({ line: 0, ch: 11 });
        ed.selection = "world";
        
        await wrapSelectionWithSnippet(asEditor(ed), "universe");
        
        expect(ed.getLine(0)).toBe("Hello universe");
    });

    it("should insert at cursor if no selection", async () => {
        const ed = new MockEditor("Hello world");
        ed.setCursor({ line: 0, ch: 6 }); // after "Hello "
        
        await wrapSelectionWithSnippet(asEditor(ed), "beautiful ");
        
        expect(ed.getLine(0)).toBe("Hello beautiful world");
    });

    it("should handle setCursor errors gracefully in insertSnippetAtCursor", async () => {
        const ed = new MockEditor("Hello world");
        ed.setCursor({ line: 0, ch: 6 });
        
        // Mock setCursor to throw an error
        const setCursorSpy = vi.spyOn(ed, "setCursor").mockImplementation(() => {
            throw new Error("Cursor error");
        });
        
        // Mock console.warn to avoid noise in tests
        const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        
        await insertSnippetAtCursor(asEditor(ed), "beautiful $| universe");
        
        expect(consoleSpy).toHaveBeenCalledWith("Failed to set cursor position:", expect.any(Error));
        
        // Restore
        setCursorSpy.mockRestore();
        consoleSpy.mockRestore();
    });

    it("should handle setCursor errors gracefully in insertSnippetAtCursor with selection", async () => {
        const ed = new MockEditor("Hello world");
        ed.setCursor({ line: 0, ch: 6 });
        ed.selection = "world";
        
        // Mock setCursor to throw an error
        const setCursorSpy = vi.spyOn(ed, "setCursor").mockImplementation(() => {
            throw new Error("Cursor error");
        });
        
        // Mock console.warn to avoid noise in tests
        const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        
        await insertSnippetAtCursor(asEditor(ed), "beautiful $| universe");
        
        expect(consoleSpy).toHaveBeenCalledWith("Failed to set cursor position:", expect.any(Error));
        
        // Restore
        setCursorSpy.mockRestore();
        consoleSpy.mockRestore();
    });

    it("should handle setCursor errors gracefully in wrapSelectionWithSnippet", async () => {
        const ed = new MockEditor("Hello world");
        ed.setCursor({ line: 0, ch: 6 });
        ed.selection = "world";
        
        // Mock setCursor to throw an error
        const setCursorSpy = vi.spyOn(ed, "setCursor").mockImplementation(() => {
            throw new Error("Cursor error");
        });
        
        // Mock console.warn to avoid noise in tests
        const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        
        await wrapSelectionWithSnippet(asEditor(ed), "beautiful $| universe");
        
        expect(consoleSpy).toHaveBeenCalledWith("Failed to set cursor position:", expect.any(Error));
        
        // Restore
        setCursorSpy.mockRestore();
        consoleSpy.mockRestore();
    });
});

describe("adapters/obsidian-editor: B-197 picker paths run the placeholder pipeline", () => {
    const now = new Date("2025-09-02T10:11:12");

    it("insert: $date, {{time}} and $filename are substituted, $| places the caret after them", async () => {
        const ed = new MockEditor("");
        await insertSnippetAtCursor(asEditor(ed), "## $date $|", { now, filename: "n.md" });
        expect(ed.getLine(0)).toBe("## 2025-09-02 ");
        expect(ed.getCursor()).toEqual({ line: 0, ch: "## 2025-09-02 ".length });
        const ed2 = new MockEditor("");
        await insertSnippetAtCursor(asEditor(ed2), "{{time}} $filename", { now, filename: "n.md" });
        expect(ed2.getLine(0)).toBe("10:11 n.md");
    });

    it("insert: $filename with no active file becomes an empty string", async () => {
        const ed = new MockEditor("");
        await insertSnippetAtCursor(asEditor(ed), "[$filename]", { now });
        expect(ed.getLine(0)).toBe("[]");
    });

    it("insert: $clipboard uses the injected reader", async () => {
        const ed = new MockEditor("");
        await insertSnippetAtCursor(asEditor(ed), "<$clipboard>", { now, readClipboard: async () => "CLIP" });
        expect(ed.getLine(0)).toBe("<CLIP>");
    });

    it("insert: a failing clipboard read inserts without crashing ($clipboard becomes empty)", async () => {
        const ed = new MockEditor("");
        await insertSnippetAtCursor(asEditor(ed), "<$clipboard>", {
            now,
            readClipboard: async () => { throw new Error("denied"); },
        });
        expect(ed.getLine(0)).toBe("<>");
    });

    it("insert: if the user moved during the clipboard await, text lands at the captured position and the cursor is not teleported", async () => {
        const ed = new MockEditor("ab\ncd");
        ed.setCursor({ line: 0, ch: 1 });
        const setCursor = vi.spyOn(ed, "setCursor");
        await insertSnippetAtCursor(asEditor(ed), "X$|Y$clipboard", {
            now,
            readClipboard: async () => {
                ed.setCursor({ line: 1, ch: 2 });
                setCursor.mockClear();
                return "C";
            },
        });
        expect(ed.getLine(0)).toBe("aXYCb");
        expect(ed.getLine(1)).toBe("cd");
        expect(setCursor).not.toHaveBeenCalled();
    });

    it("wrap: {{date:YYYY}} is formatted through moment", async () => {
        const ed2 = new MockEditor("w");
        ed2.setCursor({ line: 0, ch: 1 });
        ed2.selection = "w";
        await wrapSelectionWithSnippet(asEditor(ed2), "{{date:YYYY}}: $1", { now });
        expect(ed2.getLine(0)).toBe("2025: w");
    });

    it("wrap: a selection containing $date, {{date}}, $1 or $| stays literal and does not move the caret", async () => {
        const ed2 = new MockEditor("");
        ed2.setCursor({ line: 0, ch: 0 });
        ed2.selection = "$date {{date}} $1 $|";
        await wrapSelectionWithSnippet(asEditor(ed2), "<$1> $date $|!", { now });
        expect(ed2.getLine(0)).toBe("<$date {{date}} $1 $|> 2025-09-02 !");
    });

    it("wrap: the caret lands at $| after substituted variables", async () => {
        const ed = new MockEditor("sel");
        ed.setCursor({ line: 0, ch: 3 });
        ed.selection = "sel";
        await wrapSelectionWithSnippet(asEditor(ed), "$date $|-$1", { now });
        expect(ed.getLine(0)).toBe("2025-09-02 -sel");
        expect(ed.getCursor()).toEqual({ line: 0, ch: "2025-09-02 ".length });
    });

    it("wrap: $clipboard failure does not crash", async () => {
        const ed = new MockEditor("");
        ed.selection = "s";
        await wrapSelectionWithSnippet(asEditor(ed), "[$clipboard$1]", {
            now,
            readClipboard: async () => { throw new Error("x"); },
        });
        expect(ed.getLine(0)).toBe("[s]");
    });
});

// ---- B-199: validate the captured target after the async await ----
describe("adapters/obsidian-editor: B-199 target validated after the $clipboard await", () => {
    beforeEach(() => {
        noticeCalls.length = 0;
    });

    /** Doc "Hello world" with "world" selected (cursor at its end). */
    function selectedWorld(): MockEditor {
        const ed = new MockEditor("above\nHello world");
        ed.setCursor({ line: 1, ch: 11 });
        ed.selection = "world";
        return ed;
    }

    it("wrap: an unchanged document still wraps the selection and shows no Notice", async () => {
        const ed = selectedWorld();
        await wrapSelectionWithSnippet(asEditor(ed), "**$1**$clipboard", { readClipboard: async () => "C" });
        expect(ed.getLine(1)).toBe("Hello **world**C");
        expect(noticeCalls).toEqual([]);
    });

    it("wrap: text inserted ABOVE during the await shifts the range, so nothing is overwritten and a Notice shows", async () => {
        const ed = selectedWorld();
        await wrapSelectionWithSnippet(asEditor(ed), "**$1**$clipboard", {
            readClipboard: async () => {
                // Another plugin / sync edits the target line's start; the
                // user's cursor/selection drifts with it.
                ed.lines[1] = "XX" + ed.lines[1];
                ed.cursor = { line: 1, ch: 13 };
                return "C";
            },
        });
        expect(ed.getLine(1)).toBe("XXHello world");
        expect(noticeCalls).toEqual(["Snippet not inserted: the note changed"]);
    });

    it("wrap: the user moved but the captured range still holds the selection, so it is replaced there", async () => {
        const ed = selectedWorld();
        await wrapSelectionWithSnippet(asEditor(ed), "**$1**$clipboard", {
            readClipboard: async () => {
                ed.selection = "";
                ed.setCursor({ line: 0, ch: 2 });
                return "C";
            },
        });
        expect(ed.getLine(1)).toBe("Hello **world**C");
        expect(noticeCalls).toEqual([]);
    });

    it("insert: the user moved but the captured line is unchanged, so it lands at the captured position (B-136 kept)", async () => {
        const ed = new MockEditor("ab\ncd");
        ed.setCursor({ line: 0, ch: 1 });
        await insertSnippetAtCursor(asEditor(ed), "X$clipboard", {
            readClipboard: async () => {
                ed.setCursor({ line: 1, ch: 2 });
                return "C";
            },
        });
        expect(ed.getLine(0)).toBe("aXCb");
        expect(noticeCalls).toEqual([]);
    });

    it("insert: the captured line changed during the await, so it falls back to the live cursor", async () => {
        const ed = new MockEditor("ab\ncd");
        ed.setCursor({ line: 0, ch: 1 });
        await insertSnippetAtCursor(asEditor(ed), "X$clipboard", {
            readClipboard: async () => {
                // A line is inserted above; the captured line index now holds other text.
                ed.lines.unshift("new first line");
                ed.setCursor({ line: 2, ch: 2 }); // user is on "cd", now line 2
                return "C";
            },
        });
        expect(ed.lines).toEqual(["new first line", "ab", "cdXC"]);
        expect(noticeCalls).toEqual([]);
    });

    it("insert with a selection: a stale captured range writes nothing and shows the Notice", async () => {
        const ed = selectedWorld();
        await insertSnippetAtCursor(asEditor(ed), "U$clipboard", {
            readClipboard: async () => {
                ed.lines[1] = "XX" + ed.lines[1];
                ed.cursor = { line: 1, ch: 13 };
                return "C";
            },
        });
        expect(ed.getLine(1)).toBe("XXHello world");
        expect(noticeCalls).toEqual(["Snippet not inserted: the note changed"]);
    });

    it("insert: the note shrank so the captured line no longer exists, falls back to the live cursor", async () => {
        const ed = new MockEditor("a\nb\nc");
        ed.setCursor({ line: 2, ch: 1 });
        await insertSnippetAtCursor(asEditor(ed), "X$clipboard", {
            readClipboard: async () => {
                ed.lines = ["a"];
                ed.setCursor({ line: 0, ch: 1 });
                return "C";
            },
        });
        expect(ed.lines).toEqual(["aXC"]);
    });
});

describe("adapters/obsidian-editor: B-243 field sessions from trigger expansion", () => {
    const deps = { now: new Date("2025-09-02T10:11:12Z") };

    it("two fields: the text has no markers and the result carries document offsets", async () => {
        const ed = new MockEditor("see lnk ");
        ed.setCursor({ line: 0, ch: 8 });
        const result = await tryExpandAtSeparator(asEditor(ed), { lnk: "[$1]($2)" }, deps);
        expect(ed.getLine(0)).toBe("see []() ");
        expect(result?.session).toEqual({ fields: [5, 7], docOrder: [0, 1], final: 9 });
    });

    it("offsets follow earlier lines and a multi-line insert", async () => {
        const ed = new MockEditor("first\nfn ");
        ed.setCursor({ line: 1, ch: 3 });
        const result = await tryExpandAtSeparator(asEditor(ed), { fn: "a\n$2\nb $1\n$|end" }, deps);
        expect(ed.value()).toBe("first\na\n\nb \nend ");
        // $1 after "first\na\n\nb " (11), $2 after "first\na\n" (8); `$|` before "end" (12)
        expect(result?.session).toEqual({ fields: [11, 8], docOrder: [1, 0], final: 12 });
    });

    it("final stop without `$|` is after the typed separator (same spot as with no fields, B-182)", async () => {
        const ed = new MockEditor("lnk,");
        ed.setCursor({ line: 0, ch: 4 });
        const result = await tryExpandAtSeparator(asEditor(ed), { lnk: "[$1]($2)" }, deps);
        expect(ed.getLine(0)).toBe("[](),");
        expect(result?.session?.final).toBe(5);
    });

    it("Enter as the separator: the session starts on the previous line, the final stop is the start of the new line", async () => {
        const ed = new MockEditor("lnk\n");
        ed.setCursor({ line: 1, ch: 0 });
        const result = await tryExpandAtSeparator(asEditor(ed), { lnk: "[$1]($2)" }, deps);
        expect(ed.value()).toBe("[]()\n");
        expect(result?.session).toEqual({ fields: [1, 3], docOrder: [0, 1], final: 5 });
        // the engine's fallback caret is set only when the user is still on that line (B-148)
        expect(ed.getCursor()).toEqual({ line: 1, ch: 0 });
    });

    // The final stop must be exactly where the caret lands when the same
    // expansion has no fields (B-182 parity): the field plan and the plain plan
    // are run on identical documents and compared. MockEditor does not
    // auto-continue list markers, so these cases prove the separator and
    // indentation arithmetic only (the real-Obsidian list case is in e2e).
    const parityCases: Array<[string, string, { line: number; ch: number }]> = [
        ["Enter after a list item line (no marker continued by the mock)", "- lnk\n", { line: 1, ch: 0 }],
        ["Enter on an indented line", "  lnk\n", { line: 1, ch: 0 }],
        ["Enter after a nested list item with text before the trigger (no marker continued by the mock)", "    - see lnk\n", { line: 1, ch: 0 }],
        ["a space after an indented trigger", "  lnk more", { line: 0, ch: 6 }],
    ];
    it.each(parityCases)("%s: the final stop is where the caret lands with no fields", async (_name, doc, caret) => {
        const withFields = new MockEditor(doc);
        withFields.setCursor(caret);
        const result = await tryExpandAtSeparator(asEditor(withFields), { lnk: "[$1]($2)" }, deps);
        const plain = new MockEditor(doc);
        plain.setCursor(caret);
        await tryExpandAtSeparator(asEditor(plain), { lnk: "[]()" }, deps);
        expect(result?.session?.final).toBe(plain.posToOffset(plain.getCursor()));
        expect(withFields.value()).toBe(plain.value());
    });

    it("B-147: the user moved during the clipboard await, so no session opens and the caret is not pulled back", async () => {
        const ed = new MockEditor("lnk more");
        ed.setCursor({ line: 0, ch: 4 });
        const result = await tryExpandAtSeparator(asEditor(ed), { lnk: "[$1]($2)$clipboard" }, {
            ...deps,
            readClipboard: async () => {
                ed.setCursor({ line: 0, ch: 8 });
                return "C";
            },
        });
        expect(ed.getLine(0)).toBe("[]()C more");
        expect(result).toMatchObject({ original: "lnk" });
        expect(result?.session).toBeUndefined();
        // the user's caret moved with the text, not back into the first field (ch 1)
        expect(ed.getCursor()).toEqual({ line: 0, ch: "[]()C more".length });
    });

    it("a clipboard value with marker characters cannot open a phantom session (one field stays byte-identical)", async () => {
        const clip = "a\uE0021\uE003b";
        const two = new MockEditor("cb ");
        two.setCursor({ line: 0, ch: 3 });
        const r2 = await tryExpandAtSeparator(asEditor(two), { cb: "$clipboard $1 $2" }, {
            ...deps,
            readClipboard: async () => clip,
        });
        expect(two.getLine(0)).toBe("a1b   ");
        expect(r2?.session?.fields).toEqual([4, 5]);

        const one = new MockEditor("cb ");
        one.setCursor({ line: 0, ch: 3 });
        const r1 = await tryExpandAtSeparator(asEditor(one), { cb: "$clipboard $1" }, {
            ...deps,
            readClipboard: async () => clip,
        });
        expect(one.getLine(0)).toBe(`${clip}  `);
        expect(r1?.session).toBeUndefined();
    });

    it("`$2$1`: the result carries the document order of fields at one offset", async () => {
        const ed = new MockEditor("sw ");
        ed.setCursor({ line: 0, ch: 3 });
        const result = await tryExpandAtSeparator(asEditor(ed), { sw: "<$2$1>" }, deps);
        expect(result?.session).toEqual({ fields: [1, 1], docOrder: [1, 0], final: 3 });
    });

    it("a single field is the caret, with no session (B-192 unchanged)", async () => {
        const ed = new MockEditor("lnk ");
        ed.setCursor({ line: 0, ch: 4 });
        const result = await tryExpandAtSeparator(asEditor(ed), { lnk: "[$1](url)" }, deps);
        expect(result?.session).toBeUndefined();
        expect(ed.getCursor()).toEqual({ line: 0, ch: 1 });
    });

    it("with $| the caret falls back to it and the session's final stop is there", async () => {
        const ed = new MockEditor("fn ");
        ed.setCursor({ line: 0, ch: 3 });
        const result = await tryExpandAtSeparator(asEditor(ed), { fn: "f($1, $2) { $| }" }, deps);
        expect(ed.getLine(0)).toBe("f(, ) {  } ");
        expect(result?.session).toEqual({ fields: [2, 4], docOrder: [0, 1], final: "f(, ) { ".length });
        expect(ed.getCursor()).toEqual({ line: 0, ch: "f(, ) { ".length });
    });
});

describe("adapters/obsidian-editor: B-244 tryExpandAtCursor", () => {
    const deps = { now: new Date("2025-09-02T10:11:12Z") };
    const dict: Dict = { brb: "be right back", fn: "function $|()", lnk: "[$1]($2)" };

    function at(text: string, ch = text.length): MockEditor {
        const ed = new MockEditor(text);
        ed.setCursor({ line: 0, ch });
        return ed;
    }

    it("expands the trigger that ends at the caret, no separator needed, caret after it", async () => {
        const ed = at("say brb");
        const result = await tryExpandAtCursor(asEditor(ed), dict, deps);
        // (the real editor maps the caret to the end of the insert; the mock does not model that)
        expect(ed.getLine(0)).toBe("say be right back");
        expect(result).toEqual({ from: 4, insert: "be right back", original: "brb", separator: "" });
    });

    it("works at the very start of a line", async () => {
        const ed = at("brb");
        await tryExpandAtCursor(asEditor(ed), dict, deps);
        expect(ed.getLine(0)).toBe("be right back");
    });

    it("works right after punctuation", async () => {
        const ed = at("(brb");
        await tryExpandAtCursor(asEditor(ed), dict, deps);
        expect(ed.getLine(0)).toBe("(be right back");
    });

    it("text after the caret stays untouched", async () => {
        const ed = at("brb tail", 3);
        await tryExpandAtCursor(asEditor(ed), dict, deps);
        expect(ed.getLine(0)).toBe("be right back tail");
    });

    it("positions the caret at $|", async () => {
        const ed = at("fn");
        await tryExpandAtCursor(asEditor(ed), dict, deps);
        expect(ed.getLine(0)).toBe("function ()");
        expect(ed.getCursor()).toEqual({ line: 0, ch: "function ".length });
    });

    it("returns the field session for a snippet with fields", async () => {
        const ed = at("x lnk");
        const result = await tryExpandAtCursor(asEditor(ed), dict, deps);
        expect(ed.getLine(0)).toBe("x []()");
        expect(result?.session).toEqual({ fields: [3, 5], docOrder: [0, 1], final: 6 });
    });

    it("no trigger at the caret: undefined and the note is untouched", async () => {
        const ed = at("nothing here");
        expect(await tryExpandAtCursor(asEditor(ed), dict, deps)).toBeUndefined();
        expect(ed.getLine(0)).toBe("nothing here");
    });

    it("column 0 and a caret in the middle of a word do nothing", async () => {
        expect(await tryExpandAtCursor(asEditor(at("brb", 0)), dict, deps)).toBeUndefined();
        const inside = at("xbrb y", 5);
        expect(await tryExpandAtCursor(asEditor(inside), dict, deps)).toBeUndefined();
    });

    it("inside a word (`brb|x`) nothing expands, the note stays as it was", async () => {
        const mid = at("brbx", 3);
        expect(await tryExpandAtCursor(asEditor(mid), dict, deps)).toBeUndefined();
        expect(mid.getLine(0)).toBe("brbx");
    });

    it("expands when the next character is a separator or the line ends", async () => {
        const space = at("brb tail", 3);
        expect(await tryExpandAtCursor(asEditor(space), dict, deps)).toMatchObject({ original: "brb" });
        const bracket = at("(brb)", 4);
        expect(await tryExpandAtCursor(asEditor(bracket), dict, deps)).toMatchObject({ original: "brb" });
        const end = at("brb");
        expect(await tryExpandAtCursor(asEditor(end), dict, deps)).toMatchObject({ original: "brb" });
    });

    it("does nothing while text is selected", async () => {
        const ed = at("brb");
        ed.selection = "brb";
        expect(await tryExpandAtCursor(asEditor(ed), dict, deps)).toBeUndefined();
        expect(ed.getLine(0)).toBe("brb");
    });

    it("does nothing inside inline code, a fenced block, frontmatter and math", async () => {
        const inline = at("`brb", 4);
        expect(await tryExpandAtCursor(asEditor(inline), dict, deps)).toBeUndefined();
        expect(inline.getLine(0)).toBe("`brb");

        const fenced = new MockEditor("```\nbrb\n```");
        fenced.setCursor({ line: 1, ch: 3 });
        expect(await tryExpandAtCursor(asEditor(fenced), dict, deps)).toBeUndefined();

        const front = new MockEditor("---\ntitle: brb\n---\n");
        front.setCursor({ line: 1, ch: 10 });
        expect(await tryExpandAtCursor(asEditor(front), dict, deps)).toBeUndefined();

        const math = at("$x brb", 6);
        expect(await tryExpandAtCursor(asEditor(math), dict, deps)).toBeUndefined();
    });

    it("prefix mode: needs the prefix char, consumes it", async () => {
        const without = at("brb");
        expect(await tryExpandAtCursor(asEditor(without), dict, { ...deps, prefix: ":" })).toBeUndefined();
        expect(without.getLine(0)).toBe("brb");
        const withPrefix = at("x :brb");
        const result = await tryExpandAtCursor(asEditor(withPrefix), dict, { ...deps, prefix: ":" });
        expect(withPrefix.getLine(0)).toBe("x be right back");
        expect(result?.original).toBe(":brb");
    });

    it("an inherited key such as `constructor` is not a trigger (S-008)", async () => {
        const ed = at("constructor");
        expect(await tryExpandAtCursor(asEditor(ed), dict, deps)).toBeUndefined();
    });
});

describe("adapters/obsidian-editor: B-243 field stops from the picker paths", () => {
    it("insert: two fields return document offsets and the caret falls back to the first field", async () => {
        const ed = new MockEditor("ab\nHello world");
        ed.setCursor({ line: 1, ch: 6 });
        const stops = await insertSnippetAtCursor(asEditor(ed), "<$1 / $2>");
        expect(ed.getLine(1)).toBe("Hello < / >world");
        expect(stops).toEqual({ fields: [10, 13], docOrder: [0, 1], final: 14 });
        expect(ed.getCursor()).toEqual({ line: 1, ch: 7 });
    });

    it("insert: $| is the final stop", async () => {
        const ed = new MockEditor("");
        const stops = await insertSnippetAtCursor(asEditor(ed), "$2 $1 $| end");
        expect(ed.getLine(0)).toBe("   end");
        expect(stops).toEqual({ fields: [1, 0], docOrder: [1, 0], final: 2 });
    });

    it("insert: one field, or none, returns no stops", async () => {
        const ed = new MockEditor("");
        expect(await insertSnippetAtCursor(asEditor(ed), "[$1](x)")).toBeUndefined();
        expect(await insertSnippetAtCursor(asEditor(new MockEditor("")), "plain")).toBeUndefined();
    });

    it("insert: when the user moved during the await, the text lands but no session starts", async () => {
        const ed = new MockEditor("a");
        ed.setCursor({ line: 0, ch: 1 });
        const stops = await insertSnippetAtCursor(asEditor(ed), "$1 $2$clipboard", {
            readClipboard: async () => {
                ed.setCursor({ line: 0, ch: 0 });
                return "C";
            },
        });
        expect(stops).toBeUndefined();
        expect(ed.getLine(0)).toBe("a C");
    });

    it("wrap: $1 takes the selection and the remaining fields start the session at the next one", async () => {
        const ed = new MockEditor("see word");
        ed.setCursor({ line: 0, ch: 8 });
        ed.selection = "word";
        const stops = await wrapSelectionWithSnippet(asEditor(ed), "[$1]($2)");
        expect(ed.getLine(0)).toBe("see [word]()");
        expect(stops).toEqual({ fields: [11], docOrder: [0], final: 12 });
    });

    it("wrap: the selection length shifts fields that follow it, not those before it", async () => {
        const ed = new MockEditor("xx LONGER");
        ed.setCursor({ line: 0, ch: 9 });
        ed.selection = "LONGER";
        const stops = await wrapSelectionWithSnippet(asEditor(ed), "$2<$1>$3");
        expect(ed.getLine(0)).toBe("xx <LONGER>");
        expect(stops).toEqual({ fields: [3, 11], docOrder: [0, 1], final: 11 });
    });

    it("wrap: ${SEL} plus two fields: every $N is a field", async () => {
        const ed = new MockEditor("w");
        ed.setCursor({ line: 0, ch: 1 });
        ed.selection = "w";
        const stops = await wrapSelectionWithSnippet(asEditor(ed), "<${SEL}|$1|$2>");
        expect(ed.getLine(0)).toBe("<w||>");
        expect(stops).toEqual({ fields: [3, 4], docOrder: [0, 1], final: 5 });
    });

    it("wrap: a selection that looks like a field marker or the cursor sentinel is inserted verbatim", async () => {
        const ed = new MockEditor("q");
        ed.setCursor({ line: 0, ch: 1 });
        ed.selection = "q";
        const lookalike = "a\uE0021\uE003b__SNIPSIDIAN_CURSOR__";
        ed.selection = lookalike;
        ed.lines = [lookalike];
        ed.setCursor({ line: 0, ch: lookalike.length });
        const stops = await wrapSelectionWithSnippet(asEditor(ed), "[$1] $2");
        expect(ed.getLine(0)).toBe(`[${lookalike}] `);
        expect(stops).toEqual({ fields: [lookalike.length + 3], docOrder: [0], final: lookalike.length + 3 });
    });

    it("insert: a clipboard value with marker characters is stripped with fields, kept verbatim with one field", async () => {
        const clip = "a\uE0021\uE003b";
        const two = new MockEditor("");
        const stops = await insertSnippetAtCursor(asEditor(two), "$clipboard|$1|$2", { readClipboard: async () => clip });
        expect(two.getLine(0)).toBe("a1b||");
        expect(stops?.fields).toEqual([4, 5]);

        const one = new MockEditor("");
        expect(await insertSnippetAtCursor(asEditor(one), "$clipboard|$1", { readClipboard: async () => clip })).toBeUndefined();
        expect(one.getLine(0)).toBe(`${clip}|`);
    });

    it("wrap: a clipboard value with marker characters is stripped with fields, kept verbatim with one field", async () => {
        const clip = "a\uE0021\uE003b";
        const two = new MockEditor("w");
        two.setCursor({ line: 0, ch: 1 });
        two.selection = "w";
        const stops = await wrapSelectionWithSnippet(asEditor(two), "$clipboard<$1>$2$3", { readClipboard: async () => clip });
        expect(two.getLine(0)).toBe("a1b<w>");
        expect(stops?.fields).toEqual(["a1b<w>".length, "a1b<w>".length]);

        const one = new MockEditor("w");
        one.setCursor({ line: 0, ch: 1 });
        one.selection = "w";
        expect(await wrapSelectionWithSnippet(asEditor(one), "$clipboard<$1>", { readClipboard: async () => clip })).toBeUndefined();
        expect(one.getLine(0)).toBe(`${clip}<w>`);
    });

    it("wrap: one tabstop that is the selection slot leaves no session", async () => {
        const ed = new MockEditor("w");
        ed.setCursor({ line: 0, ch: 1 });
        ed.selection = "w";
        expect(await wrapSelectionWithSnippet(asEditor(ed), "**$1**")).toBeUndefined();
    });

    it("wrap: moved during the await, no session and the captured range is replaced", async () => {
        const ed = new MockEditor("Hello world");
        ed.setCursor({ line: 0, ch: 11 });
        ed.selection = "world";
        const stops = await wrapSelectionWithSnippet(asEditor(ed), "[$1] $2$clipboard", {
            readClipboard: async () => {
                ed.selection = "";
                return "";
            },
        });
        expect(stops).toBeUndefined();
    });
});


// ADR-0008 patterns ---------------------------------------------------------

function rules(...list: Array<Partial<PatternRule> & { source: string }>) {
    const set = compilePatternRules(list.map((r, i) => ({ id: `r${i}`, replacement: "x", enabled: true, mode: "instant", ...r })));
    expect(set.errors).toEqual([]);
    return set.rules;
}

/** A stand-in for the CM6 view behind `editor.cm`: it records the specs and applies them to the mock. */
function withView(ed: MockEditor) {
    type Spec = { changes: { from: number; to: number; insert: string }; selection?: { anchor: number }; userEvent?: string };
    const specs: Spec[] = [];
    const view = {
        dispatch: (spec: Spec) => {
            specs.push(spec);
            const caretAtEnd = ed.getCursor().ch === spec.changes.to;
            ed.replaceRange(spec.changes.insert, { line: 0, ch: spec.changes.from }, { line: 0, ch: spec.changes.to });
            // CM6 maps a caret at the end of a replaced range to the end of the insert.
            if (caretAtEnd) ed.setCursor({ line: 0, ch: spec.changes.from + spec.changes.insert.length });
            if (spec.selection) ed.setCursor({ line: 0, ch: spec.selection.anchor });
        },
    };
    return { editor: Object.assign(ed, { cm: view }), specs };
}

const pdeps = { filename: "note.md", now: new Date("2025-09-02T10:11:12") };

describe("adapters/obsidian-editor: applyEditPlan, pattern plans (own undo step)", () => {
    const plan = { kind: "pattern" as const, fromCh: 2, toCh: 5, insert: "X" };

    it("writes through the CM6 view with a non-typing, non-joinable userEvent", () => {
        const ed = new MockEditor("a 1/2");
        const { editor, specs } = withView(ed);
        applyEditPlan(asEditor(editor), plan, 0);
        expect(ed.getLine(0)).toBe("a X");
        expect(specs).toEqual([{ changes: { from: 2, to: 5, insert: "X" }, userEvent: PATTERN_USER_EVENT }]);
        // not typing (the bridge must not re-scan it) and not joined into CM6's typing group
        expect(PATTERN_USER_EVENT).not.toMatch(/^(input|delete)/);
        expect(PATTERN_USER_EVENT).not.toMatch(/^(input\.type|delete)($|\.)/);
    });

    it("falls back to replaceRange on a legacy editor without a CM6 view", () => {
        const ed = new MockEditor("a 1/2");
        applyEditPlan(asEditor(ed), plan, 0);
        expect(ed.getLine(0)).toBe("a X");
    });

    it("a literal plan stays on replaceRange, byte for byte as before", () => {
        const ed = new MockEditor("a 1/2");
        const { editor, specs } = withView(ed);
        applyEditPlan(asEditor(editor), { fromCh: 2, toCh: 5, insert: "X" }, 0);
        expect(ed.getLine(0)).toBe("a X");
        expect(specs).toEqual([]);
    });
});

describe("adapters/obsidian-editor: separator-mode patterns", () => {
    const fraction = rules({ source: String.raw`/(\d+)\/(\d+)$/`, replacement: "{{1}}\u2044{{2}}", mode: "separator" });

    function typedSpace(text: string): MockEditor {
        const ed = new MockEditor(text);
        ed.setCursor({ line: 0, ch: text.length });
        return ed;
    }

    it("expands on the separator, keeps it, and reports what was typed", async () => {
        const ed = typedSpace("take 3/4 ");
        const { editor, specs } = withView(ed);
        const result = await tryExpandAtSeparator(asEditor(editor), {}, { ...pdeps, patterns: fraction });
        expect(ed.getLine(0)).toBe("take 3\u20444 ");
        expect(result).toEqual({ from: 5, insert: "3\u20444", original: "3/4", separator: " " });
        expect(specs[0]?.userEvent).toBe(PATTERN_USER_EVENT);
    });

    it("a literal trigger wins and is still written untagged", async () => {
        const ed = typedSpace("brb ");
        const { editor, specs } = withView(ed);
        const result = await tryExpandAtSeparator(asEditor(editor), { brb: "be right back" }, { ...pdeps, patterns: rules({ source: "/brb$/", replacement: "PATTERN", mode: "separator" }) });
        expect(ed.getLine(0)).toBe("be right back ");
        expect(result?.original).toBe("brb");
        expect(specs).toEqual([]);
    });

    it("without patterns nothing changes", async () => {
        const ed = typedSpace("take 3/4 ");
        expect(await tryExpandAtSeparator(asEditor(ed), {}, pdeps)).toBeUndefined();
        expect(ed.getLine(0)).toBe("take 3/4 ");
    });

    it("the Enter separator works for patterns too", async () => {
        const ed = new MockEditor("mtg Bob\n");
        ed.setCursor({ line: 1, ch: 0 });
        const result = await tryExpandAtSeparator(asEditor(ed), {}, {
            ...pdeps,
            patterns: rules({ source: String.raw`/mtg (\w+)$/`, replacement: "With {{1}}", mode: "separator" }),
        });
        expect(ed.getLine(0)).toBe("With Bob");
        expect(result).toMatchObject({ original: "mtg Bob", separator: "\n" });
    });

    it("a pattern in a code span does not expand", async () => {
        const ed = typedSpace("`take 3/4 ");
        expect(await tryExpandAtSeparator(asEditor(ed), {}, { ...pdeps, patterns: fraction })).toBeUndefined();
    });

    it("the staleness guard still protects a pattern edit (the note changed while it was resolved)", async () => {
        const ed = typedSpace("take 3/4 ");
        const rulesWithClipboard = rules({ source: String.raw`/(\d+)\/(\d+)$/`, replacement: "$clipboard", mode: "separator" });
        const result = await tryExpandAtSeparator(asEditor(ed), {}, {
            ...pdeps,
            patterns: rulesWithClipboard,
            readClipboard: async () => {
                ed.lines[0] = "take 9/9 ";
                return "CLIP";
            },
        });
        expect(result).toBeUndefined();
        expect(ed.getLine(0)).toBe("take 9/9 ");
    });

    it("\"Expand trigger at cursor\" runs separator-mode patterns, not instant ones", async () => {
        const ed = new MockEditor("take 3/4");
        ed.setCursor({ line: 0, ch: 8 });
        const both = rules(
            { source: String.raw`/(\d{1,2})\/(\d{1,2})$/`, replacement: "INSTANT", mode: "instant" },
            { source: String.raw`/(\d+)\/(\d+)$/`, replacement: "{{1}}\u2044{{2}}", mode: "separator" },
        );
        const result = await tryExpandAtCursor(asEditor(ed), {}, { ...pdeps, patterns: both });
        expect(ed.getLine(0)).toBe("take 3\u20444");
        expect(result).toMatchObject({ from: 5, original: "3/4", separator: "" });
    });
});

describe("adapters/obsidian-editor: instant rules on a typed separator (one order for all rules)", () => {
    const dots = { source: String.raw`/\.\.\.$/`, replacement: "\u2026", mode: "instant" } as const;
    const bracket = { source: String.raw`/(\w+)\.\.$/`, replacement: "[{{1}}]", mode: "separator" } as const;

    function typed(text: string): MockEditor {
        const ed = new MockEditor(text);
        ed.setCursor({ line: 0, ch: text.length });
        return ed;
    }

    it("foo... types foo\u2026 when the instant rule is listed first, and the result carries no separator", async () => {
        const ed = typed("foo...");
        const { editor, specs } = withView(ed);
        const result = await tryExpandAtSeparator(asEditor(editor), {}, { ...pdeps, patterns: rules(dots, bracket), instant: true });
        expect(ed.getLine(0)).toBe("foo\u2026");
        expect(ed.getCursor()).toEqual({ line: 0, ch: 4 });
        expect(result).toEqual({ from: 3, insert: "\u2026", original: "...", separator: "" });
        expect(specs).toEqual([{ changes: { from: 3, to: 6, insert: "\u2026" }, userEvent: PATTERN_USER_EVENT }]);
    });

    it("the separator rule listed first takes it, and the separator stays", async () => {
        const ed = typed("foo...");
        const result = await tryExpandAtSeparator(asEditor(ed), {}, { ...pdeps, patterns: rules(bracket, dots), instant: true });
        expect(ed.getLine(0)).toBe("[foo].");
        expect(result).toMatchObject({ original: "foo..", separator: "." });
    });

    it("without the instant flag (not a single typed character) instant rules stay out", async () => {
        const ed = typed("foo...");
        expect(await tryExpandAtSeparator(asEditor(ed), {}, { ...pdeps, patterns: rules(dots) })).toBeUndefined();
        expect(ed.getLine(0)).toBe("foo...");
    });

    it("Enter never runs an instant rule, whatever the flag says", async () => {
        const ed = new MockEditor("foo...\n");
        ed.setCursor({ line: 1, ch: 0 });
        expect(await tryExpandAtSeparator(asEditor(ed), {}, { ...pdeps, patterns: rules(dots), instant: true })).toBeUndefined();
        expect(ed.getLine(0)).toBe("foo...");
    });

    it("a field session after an instant expansion on a separator ends right after the insert", async () => {
        const ed = typed("a...");
        const result = await tryExpandAtSeparator(asEditor(ed), {}, {
            ...pdeps,
            patterns: rules({ source: String.raw`/\.\.\.$/`, replacement: "[$1][$2]", mode: "instant" }),
            instant: true,
        });
        expect(ed.getLine(0)).toBe("a[][]");
        expect(result?.session).toEqual({ fields: [2, 4], docOrder: [0, 1], final: 5 });
    });

    it("tryExpandInstant leaves a typed separator to the separator path", async () => {
        const ed = typed("foo...");
        expect(await tryExpandInstant(asEditor(ed), rules(dots), pdeps)).toBeUndefined();
        expect(ed.getLine(0)).toBe("foo...");
    });
});

describe("adapters/obsidian-editor: tryExpandInstant", () => {
    const arrow = rules({ source: "/->$/", replacement: "\u2192" });

    function at(text: string, ch = text.length): MockEditor {
        const ed = new MockEditor(text);
        ed.setCursor({ line: 0, ch });
        return ed;
    }

    it("replaces the match that ends at the caret and puts the caret after it", async () => {
        const ed = at("a ->");
        const { editor, specs } = withView(ed);
        const result = await tryExpandInstant(asEditor(editor), arrow, pdeps);
        expect(ed.getLine(0)).toBe("a \u2192");
        expect(ed.getCursor()).toEqual({ line: 0, ch: 3 });
        expect(result).toEqual({ from: 2, insert: "\u2192", original: "->", separator: "" });
        expect(specs).toEqual([{ changes: { from: 2, to: 4, insert: "\u2192" }, userEvent: PATTERN_USER_EVENT }]);
    });

    it("a hit runs the rule's regex once: the plan is built from the match found first", async () => {
        const [rule] = arrow;
        if (!rule) throw new Error("no rule");
        const exec = vi.spyOn(rule.re, "exec");
        const ed = at("a ->");
        await tryExpandInstant(asEditor(ed), arrow, pdeps);
        expect(ed.getLine(0)).toBe("a \u2192");
        expect(exec).toHaveBeenCalledTimes(1);
        // A guarded hit (inside inline code) is matched once too, then dropped.
        exec.mockClear();
        await tryExpandInstant(asEditor(at("`a ->` b", 5)), arrow, pdeps);
        expect(exec).toHaveBeenCalledTimes(1);
        exec.mockRestore();
    });

    it("text after the caret stays", async () => {
        const ed = at("a -> b", 4);
        await tryExpandInstant(asEditor(ed), arrow, pdeps);
        expect(ed.getLine(0)).toBe("a \u2192 b");
    });

    it("nothing happens at the start of a line, with a selection, or with no match", async () => {
        expect(await tryExpandInstant(asEditor(at("->", 0)), arrow, pdeps)).toBeUndefined();
        const selected = at("a ->");
        selected.selection = "->";
        expect(await tryExpandInstant(asEditor(selected), arrow, pdeps)).toBeUndefined();
        expect(selected.getLine(0)).toBe("a ->");
        const plain = at("a -");
        expect(await tryExpandInstant(asEditor(plain), arrow, pdeps)).toBeUndefined();
        expect(plain.getLine(0)).toBe("a -");
    });

    it("guards: not in inline code, a fenced block, math or frontmatter", async () => {
        const inline = at("`a ->` b", 5);
        expect(await tryExpandInstant(asEditor(inline), arrow, pdeps)).toBeUndefined();
        expect(inline.getLine(0)).toBe("`a ->` b");
        const fence = new MockEditor("```\na ->\n```");
        fence.setCursor({ line: 1, ch: 4 });
        expect(await tryExpandInstant(asEditor(fence), arrow, pdeps)).toBeUndefined();
        const front = new MockEditor("---\ntitle: ->\n---\n");
        front.setCursor({ line: 1, ch: 10 });
        expect(await tryExpandInstant(asEditor(front), arrow, pdeps)).toBeUndefined();
        const math = at("$a ->", 5);
        expect(await tryExpandInstant(asEditor(math), arrow, pdeps)).toBeUndefined();
    });

    it("$| puts the caret inside the insert", async () => {
        const ed = at("box");
        await tryExpandInstant(asEditor(ed), rules({ source: "/box$/", replacement: "[ $| ]" }), pdeps);
        expect(ed.getLine(0)).toBe("[  ]");
        expect(ed.getCursor()).toEqual({ line: 0, ch: 2 });
    });

    it("fields: the caret goes to the first field and the session starts with document offsets", async () => {
        const ed = at("x lnk");
        const result = await tryExpandInstant(asEditor(ed), rules({ source: "/lnk$/", replacement: "[$1]($2)" }), pdeps);
        expect(ed.getLine(0)).toBe("x []()");
        expect(ed.getCursor()).toEqual({ line: 0, ch: 3 });
        // no `$|`: the last Tab lands after the insert (there is no separator)
        expect(result?.session).toEqual({ fields: [3, 5], docOrder: [0, 1], final: 6 });
    });

    it("a captured $1 is not a field", async () => {
        const ed = at("x v$1");
        const result = await tryExpandInstant(asEditor(ed), rules({ source: String.raw`/v(\S+)$/`, replacement: "<{{1}}>" }), pdeps);
        expect(ed.getLine(0)).toBe("x <$1>");
        expect(result?.session).toBeUndefined();
    });

    it("a field session does not pull the caret when the user moved during an async clipboard read (B-147)", async () => {
        const ed = at("x clip y z", 6);
        const { editor } = withView(ed);
        const result = await tryExpandInstant(asEditor(editor), rules({ source: "/clip$/", replacement: "$clipboard $1 $2" }), {
            ...pdeps,
            readClipboard: async () => {
                ed.setCursor({ line: 0, ch: 10 }); // the user clicked elsewhere
                return "CLIP";
            },
        });
        expect(ed.getLine(0)).toBe("x CLIP   y z");
        expect(ed.getCursor()).toEqual({ line: 0, ch: 10 + "CLIP  ".length - "clip".length });
        expect(result?.session).toBeUndefined();
        expect(result?.original).toBe("clip");
    });

    it("refuses to overwrite when the line changed under it", async () => {
        const ed = at("x clip");
        const result = await tryExpandInstant(asEditor(ed), rules({ source: "/clip$/", replacement: "$clipboard" }), {
            ...pdeps,
            readClipboard: async () => {
                ed.lines[0] = "x CHANGED";
                return "CLIP";
            },
        });
        expect(result).toBeUndefined();
        expect(ed.getLine(0)).toBe("x CHANGED");
    });
});

describe("adapters/obsidian-editor: an instant rule that replaces the opener of an auto-paired closer (ADR-0008)", () => {
    // `x :(` typed with "Auto pair brackets": the editor wrote `()`, caret between. With auto-pair off the same typing
    // gives `x \u2639`, so the closer goes with the opener, in the same write.
    const sad = rules({ source: String.raw`/:\($/`, replacement: "\u2639", mode: "instant" });
    const star = rules({ source: String.raw`/\*$/`, replacement: "\u2022", mode: "instant" });

    function at(text: string, ch: number): MockEditor {
        const ed = new MockEditor(text);
        ed.setCursor({ line: 0, ch });
        return ed;
    }

    /** What the bridge hands over: the closer, with the caret and the line as the pair insert left them. */
    function pair(closer: string, ed: MockEditor): PairedCloser {
        return { closer, caret: ed.getCursor(), lineText: ed.getLine(0) };
    }

    it("a rule typed through a separator opener (`(`) takes the closer in one write and leaves the caret after the insert", async () => {
        const { editor, specs } = withView(at("x :()", 4));
        const result = await tryExpandAtSeparator(asEditor(editor), {}, { ...pdeps, patterns: sad, instant: true, pairCloser: pair(")", editor) });
        expect(editor.getLine(0)).toBe("x \u2639");
        expect(specs).toEqual([
            { changes: { from: 2, to: 5, insert: "\u2639" }, selection: { anchor: 3 }, userEvent: PATTERN_USER_EVENT },
        ]);
        expect(editor.getCursor()).toEqual({ line: 0, ch: 3 });
        // what a highlight / Backspace undo restores is the whole pair
        expect(result).toEqual({ from: 2, insert: "\u2639", original: ":()", separator: "", restoreCaret: 2 });
    });

    it("the same typing without a known auto-pair closer leaves it alone (nothing else to go by)", async () => {
        const { editor, specs } = withView(at("x :()", 4));
        await tryExpandAtSeparator(asEditor(editor), {}, { ...pdeps, patterns: sad, instant: true });
        expect(editor.getLine(0)).toBe("x \u2639)");
        expect(specs[0]?.changes).toEqual({ from: 2, to: 4, insert: "\u2639" });
        expect(specs[0]?.selection).toBeUndefined();
    });

    it("a rule on a non-separator opener (`*` of `**`) takes the closer too", async () => {
        const { editor, specs } = withView(at("x **", 3));
        await tryExpandInstant(asEditor(editor), star, { ...pdeps, pairCloser: pair("*", editor) });
        expect(editor.getLine(0)).toBe("x \u2022");
        expect(specs[0]).toMatchObject({ changes: { from: 2, to: 4, insert: "\u2022" }, selection: { anchor: 3 } });
    });

    it("only the closer of that update: another character after the caret stays", async () => {
        const { editor } = withView(at("x :(a)", 4));
        await tryExpandAtSeparator(asEditor(editor), {}, { ...pdeps, patterns: sad, instant: true, pairCloser: pair(")", editor) });
        expect(editor.getLine(0)).toBe("x \u2639a)");
    });

    it("a different closer than the one inserted stays", async () => {
        const { editor } = withView(at("x :(]", 4));
        await tryExpandAtSeparator(asEditor(editor), {}, { ...pdeps, patterns: sad, instant: true, pairCloser: pair(")", editor) });
        expect(editor.getLine(0)).toBe("x \u2639]");
    });

    it("a separator-mode rule typed through `(` keeps the opener, so the pair stays whole", async () => {
        const { editor } = withView(at("x :a()", 5));
        const sepRule = rules({ source: String.raw`/:a$/`, replacement: "A", mode: "separator" });
        await tryExpandAtSeparator(asEditor(editor), {}, { ...pdeps, patterns: sepRule, instant: true, pairCloser: pair(")", editor) });
        expect(editor.getLine(0)).toBe("x A()");
    });

    it("a literal trigger before `(` keeps the pair as before", async () => {
        const { editor } = withView(at("brb()", 4));
        await tryExpandAtSeparator(asEditor(editor), { brb: "be right back" }, { ...pdeps, patterns: sad, instant: true, pairCloser: pair(")", editor) });
        expect(editor.getLine(0)).toBe("be right back()");
    });

    it("the legacy editor without a CM6 view is left as it was (the plain write cannot place the caret)", async () => {
        const ed = at("x :()", 4);
        await tryExpandAtSeparator(asEditor(ed), {}, { ...pdeps, patterns: sad, instant: true, pairCloser: pair(")", ed) });
        expect(ed.getLine(0)).toBe("x \u2639)");
    });

    it("a separator rule typed through a self-paired opener (`\"` of `\"\"`) does not take the closer: it ends before the caret", async () => {
        // `x :a""`, caret between the quotes: the rule ends before the typed `"`, so the second `"` is not its closer
        const { editor } = withView(at('x :a""', 5));
        const sepRule = rules({ source: String.raw`/:a$/`, replacement: "A", mode: "separator" });
        await tryExpandAtSeparator(asEditor(editor), {}, { ...pdeps, patterns: sepRule, instant: true, pairCloser: pair('"', editor) });
        expect(editor.getLine(0)).toBe('x A""');
    });

    const clip = rules({ source: String.raw`/:\($/`, replacement: "$clipboard", mode: "instant" });

    it("the caret moving during the await does not pull it back, and the closer stays (fail closed)", async () => {
        const ed = at("x :()", 4);
        const { editor, specs } = withView(ed);
        const result = await tryExpandAtSeparator(asEditor(editor), {}, {
            ...pdeps,
            patterns: clip,
            instant: true,
            pairCloser: pair(")", editor),
            readClipboard: async () => {
                ed.setCursor({ line: 0, ch: 1 });
                return "CLIP";
            },
        });
        expect(editor.getLine(0)).toBe("x CLIP)");
        expect(specs[0]?.selection).toBeUndefined();
        expect(editor.getCursor()).toEqual({ line: 0, ch: 1 });
        expect(result?.restoreCaret).toBeUndefined();
    });

    it("a `)` typed over the closer during the await stays, with no restore caret", async () => {
        const ed = at("x :()", 4);
        const { editor } = withView(ed);
        const result = await tryExpandAtSeparator(asEditor(editor), {}, {
            ...pdeps,
            patterns: clip,
            instant: true,
            pairCloser: pair(")", editor),
            readClipboard: async () => {
                ed.setCursor({ line: 0, ch: 5 }); // step-over: selection only, the line is untouched
                return "CLIP";
            },
        });
        expect(editor.getLine(0)).toBe("x CLIP)");
        expect(result?.restoreCaret).toBeUndefined();
    });

    it("`) ` typed during the await keeps both characters", async () => {
        const ed = at("x :()", 4);
        const { editor } = withView(ed);
        const result = await tryExpandAtSeparator(asEditor(editor), {}, {
            ...pdeps,
            patterns: clip,
            instant: true,
            pairCloser: pair(")", editor),
            readClipboard: async () => {
                ed.lines[0] = "x :() ";
                ed.setCursor({ line: 0, ch: 6 });
                return "CLIP";
            },
        });
        expect(editor.getLine(0)).toBe("x CLIP) ");
        expect(result?.restoreCaret).toBeUndefined();
    });

    it("Expand at cursor never takes a closer, even with `)` right after the caret", async () => {
        const ed = at("x :)", 3);
        const { editor } = withView(ed);
        const rule = rules({ source: String.raw`/:$/`, replacement: "E", mode: "separator" });
        await tryExpandAtCursor(asEditor(editor), {}, { ...pdeps, patterns: rule });
        expect(editor.getLine(0)).toBe("x E)");
    });

    it("a closer recorded for a different caret is left alone (the fallback after a stale first attempt re-reads the caret)", async () => {
        // Rule A (clipboard) is stale after the user rewrote the opener and clicked between `zx` and their own `)`; rule B then
        // fires on the live caret and must not take that `)`.
        const ed = at("x :() f(zx)", 4);
        const { editor } = withView(ed);
        const both = rules(
            { source: String.raw`/:\($/`, replacement: "$clipboard", mode: "instant" },
            { source: String.raw`/zx$/`, replacement: "\u2192", mode: "instant" },
        );
        const deps = {
            ...pdeps,
            pairCloser: pair(")", editor),
            readClipboard: async () => {
                ed.lines[0] = "x a() f(zx)";
                ed.setCursor({ line: 0, ch: 10 });
                return "CLIP";
            },
        };
        const first = await tryExpandAtSeparator(asEditor(editor), {}, { ...deps, patterns: both, instant: true });
        expect(first).toBeUndefined();
        const second = await tryExpandInstant(asEditor(editor), both, deps);
        expect(editor.getLine(0)).toBe("x a() f(\u2192)");
        expect(second?.restoreCaret).toBeUndefined();
    });

    it("a closer recorded for another caret position is left alone, with the line unchanged", async () => {
        const { editor } = withView(at("x :()", 4));
        const stale: PairedCloser = { closer: ")", caret: { line: 0, ch: 3 }, lineText: "x :()" };
        await tryExpandAtSeparator(asEditor(editor), {}, { ...pdeps, patterns: sad, instant: true, pairCloser: stale });
        expect(editor.getLine(0)).toBe("x \u2639)");
    });

    it("a closer recorded for another version of the line is left alone, even with the caret at the same spot", async () => {
        const { editor } = withView(at("x **", 3));
        const stale: PairedCloser = { closer: "*", caret: { line: 0, ch: 3 }, lineText: "y **" };
        await tryExpandInstant(asEditor(editor), star, { ...pdeps, pairCloser: stale });
        expect(editor.getLine(0)).toBe("x \u2022*");
    });

    it("a forward Delete on the closer during the await, with an identical character behind it, writes nothing (first attempt)", async () => {
        const ed = at("(x :())", 5);
        const { editor, specs } = withView(ed);
        const result = await tryExpandAtSeparator(asEditor(editor), {}, {
            ...pdeps,
            patterns: clip,
            instant: true,
            pairCloser: pair(")", ed),
            readClipboard: async () => {
                ed.lines[0] = "(x :()"; // the caret stays at 5
                return "CLIP";
            },
        });
        expect(result).toBeUndefined();
        expect(specs).toEqual([]);
        expect(ed.getLine(0)).toBe("(x :()");
    });

    it("a forward Delete on the closer during the await, with an identical character behind it, writes nothing (instant path)", async () => {
        const ed = at("*x ***", 4);
        const { editor, specs } = withView(ed);
        const clipStar = rules({ source: String.raw`/\*$/`, replacement: "$clipboard", mode: "instant" });
        const result = await tryExpandInstant(asEditor(editor), clipStar, {
            ...pdeps,
            pairCloser: pair("*", ed),
            readClipboard: async () => {
                ed.lines[0] = "*x **";
                return "CLIP";
            },
        });
        expect(result).toBeUndefined();
        expect(specs).toEqual([]);
        expect(ed.getLine(0)).toBe("*x **");
    });

    it("a selection at apply time with the head at the origin does not take the closer", async () => {
        const ed = at("x :()", 4);
        const { editor } = withView(ed);
        const result = await tryExpandAtSeparator(asEditor(editor), {}, {
            ...pdeps,
            patterns: clip,
            instant: true,
            pairCloser: pair(")", ed),
            readClipboard: async () => {
                ed.selection = "sel"; // a selection whose head is still at the origin: the caret did not move
                return "CLIP";
            },
        });
        expect(editor.getLine(0)).toBe("x CLIP)");
        expect(result?.restoreCaret).toBeUndefined();
    });

    it("a note that changed while the closer was being resolved is not overwritten", async () => {
        const ed = at("x :()", 4);
        const { editor } = withView(ed);
        const clip = rules({ source: String.raw`/:\($/`, replacement: "$clipboard", mode: "instant" });
        const result = await tryExpandAtSeparator(asEditor(editor), {}, {
            ...pdeps,
            patterns: clip,
            instant: true,
            pairCloser: pair(")", ed),
            readClipboard: async () => {
                ed.lines[0] = "x :(a";
                return "CLIP";
            },
        });
        expect(result).toBeUndefined();
        expect(ed.getLine(0)).toBe("x :(a");
    });
});

describe("adapters/obsidian-editor: B-255 canExpandAtCursor", () => {
    const dict: Dict = { brb: "be right back", fn: "function $|()" };

    function at(text: string, ch = text.length, selection = ""): MockEditor {
        const ed = new MockEditor(text);
        ed.setCursor({ line: 0, ch });
        ed.selection = selection;
        return ed;
    }

    it("is true for a trigger right before the caret", () => {
        expect(canExpandAtCursor(asEditor(at("say brb")), dict)).toBeDefined();
        expect(canExpandAtCursor(asEditor(at("brb tail", 3)), dict)).toBeDefined();
    });

    it("is false with no trigger, an unknown word, or a caret at column 0", () => {
        expect(canExpandAtCursor(asEditor(at("say hello")), dict)).toBeUndefined();
        expect(canExpandAtCursor(asEditor(at("")), dict)).toBeUndefined();
        expect(canExpandAtCursor(asEditor(at("brb", 0)), dict)).toBeUndefined();
    });

    it("is false inside a word that is no trigger, with a selection that is no trigger, and in code", () => {
        expect(canExpandAtCursor(asEditor(at("brbx", 3)), dict)).toBeUndefined();
        expect(canExpandAtCursor(asEditor(at("hello world", 5, "hello")), dict)).toBeUndefined();
        expect(canExpandAtCursor(asEditor(at("`brb")), dict)).toBeUndefined();
    });

    // Parity with the original plugin: both inputs agree with the expand path.
    it("is true for a selection that is exactly a trigger, and for a caret inside a trigger word", () => {
        expect(canExpandAtCursor(asEditor(at("say brb", 7, "brb")), dict)).toBeDefined();
        expect(canExpandAtCursor(asEditor(at("say brb now", 6)), dict)).toBeDefined();
    });

    it("is false for a caret at the START of a word (Tab keeps indenting there)", () => {
        expect(canExpandAtCursor(asEditor(at("say brb", 4)), dict)).toBeUndefined();
    });

    it("honours prefix mode like the command does", () => {
        expect(canExpandAtCursor(asEditor(at("brb")), dict, ":")).toBeUndefined();
        expect(canExpandAtCursor(asEditor(at(":brb")), dict, ":")).toBeDefined();
    });

    // Tab runs this on every press: the note scan for frontmatter, fences and math (it reads `lastLine`) is only for
    // a line that has something to expand.
    it("looks at the note (frontmatter, fences, math) only when the line has a candidate", () => {
        const scans = (ed: MockEditor): number => {
            const spy = vi.spyOn(ed, "lastLine");
            canExpandAtCursor(asEditor(ed), dict);
            return spy.mock.calls.length;
        };
        expect(scans(at("say hello"))).toBe(0);
        expect(scans(at("   "))).toBe(0);
        expect(scans(at("say brb"))).toBeGreaterThan(0);
    });

    it("does not resolve or write anything", () => {
        const ed = at("say brb");
        canExpandAtCursor(asEditor(ed), dict);
        expect(ed.getLine(0)).toBe("say brb");
    });

    it("never matches an inherited Object.prototype key (S-008)", () => {
        expect(canExpandAtCursor(asEditor(at("constructor")), {})).toBeUndefined();
    });

    describe("with pattern rules (ADR-0008)", () => {
        const date = rules({ source: String.raw`/\bdd(\d+)$/`, mode: "separator" });

        it("is true for a rule that matches the line before the caret, false without the rules", () => {
            expect(canExpandAtCursor(asEditor(at("on dd5")), dict, undefined, date)).toBeDefined();
            expect(canExpandAtCursor(asEditor(at("on dd5")), dict)).toBeUndefined();
        });

        it("is false when no rule matches, and for the empty rule list", () => {
            expect(canExpandAtCursor(asEditor(at("on hello")), dict, undefined, date)).toBeUndefined();
            expect(canExpandAtCursor(asEditor(at("on dd5")), dict, undefined, [])).toBeUndefined();
        });

        it("a caret inside the word is judged on the word up to its end, as the expand path does", () => {
            expect(canExpandAtCursor(asEditor(at("on dd5 now", 5)), dict, undefined, date)).toBeDefined();
        });

        it("a selection is never matched against rules, only literal triggers count", () => {
            expect(canExpandAtCursor(asEditor(at("on dd5", 6, "dd5")), dict, undefined, date)).toBeUndefined();
            expect(canExpandAtCursor(asEditor(at("say brb", 7, "brb")), dict, undefined, date)).toBeDefined();
        });

        it("the guards still apply: no match in inline code", () => {
            expect(canExpandAtCursor(asEditor(at("`on dd5")), dict, undefined, date)).toBeUndefined();
        });

        it("instant rules are skipped: Tab has no typed character to complete", () => {
            const arrow = rules({ source: "/->$/", mode: "instant" });
            expect(canExpandAtCursor(asEditor(at("a ->")), dict, undefined, arrow)).toBeUndefined();
            // The same text through a separator rule is found, so the skip is about the mode.
            const sep = rules({ source: "/->$/", mode: "separator" });
            expect(canExpandAtCursor(asEditor(at("a ->")), dict, undefined, sep)).toBeDefined();
        });

        it("hands back what it found: the literal trigger, or the rule hit", () => {
            const lit = canExpandAtCursor(asEditor(at("say brb")), dict, undefined, date);
            expect(lit).toMatchObject({ literal: true });
            expect(lit?.hit).toBeUndefined();
            const hit = canExpandAtCursor(asEditor(at("on dd5")), dict, undefined, date);
            expect(hit).toMatchObject({ literal: false, hit: { index: 3, captures: ["dd5", "5"] } });
        });

        // Owner decision: a match that starts after the caret would replace a tail the caret is not in.
        describe("a caret inside a word (the match must start at or before the caret)", () => {
            const tail = rules({ source: String.raw`/dd(\d+)$/`, mode: "separator" });

            it("a match that starts after the caret does not count", () => {
                expect(canExpandAtCursor(asEditor(at("abcdd5 x", 1)), dict, undefined, tail)).toBeUndefined();
                expect(canExpandAtCursor(asEditor(at("abcdd5 x", 2)), dict, undefined, tail)).toBeUndefined();
            });

            it("a match that starts exactly at the caret, or spans it, counts", () => {
                expect(canExpandAtCursor(asEditor(at("abcdd5 x", 3)), dict, undefined, tail)).toBeDefined();
                expect(canExpandAtCursor(asEditor(at("abcdd5 x", 4)), dict, undefined, tail)).toBeDefined();
            });

            it("at the end of the word (not inside it) the rule is judged as before", () => {
                expect(canExpandAtCursor(asEditor(at("abcdd5 x", 6)), dict, undefined, tail)).toBeDefined();
            });

            it("a literal trigger inside the word is unchanged", () => {
                expect(canExpandAtCursor(asEditor(at("say brb now", 5)), dict, undefined, tail)).toBeDefined();
            });
        });

        it("does not write anything", () => {
            const ed = at("on dd5");
            canExpandAtCursor(asEditor(ed), dict, undefined, date);
            expect(ed.getLine(0)).toBe("on dd5");
        });
    });
});

describe("adapters/obsidian-editor: manual expansion with pattern rules (B-255 + ADR-0008)", () => {
    const now = new Date("2025-09-02T10:11:12Z");
    const date = rules({ source: String.raw`/\bdd(\d+)$/`, replacement: "day {{1}}", mode: "separator" });
    const compileDate = (): ReturnType<typeof rules> => rules({ source: String.raw`/\bdd(\d+)$/`, replacement: "day {{1}}", mode: "separator" });
    const dict: Dict = { brb: "be right back" };

    function at(text: string, ch = text.length, selection = ""): MockEditor {
        const ed = new MockEditor(text);
        ed.setCursor({ line: 0, ch });
        ed.selection = selection;
        return ed;
    }

    it("a rule expands at the caret on the manual path", async () => {
        const ed = at("on dd5");
        const result = await tryExpandAtCursor(asEditor(ed), dict, { now, manual: true, patterns: date });
        expect(ed.getLine(0)).toBe("on day 5");
        expect(result).toMatchObject({ original: "dd5", insert: "day 5", separator: "" });
    });

    it("a caret inside the word takes the whole word and parks after the new text", async () => {
        const ed = at("on dd5 now", 5);
        await tryExpandAtCursor(asEditor(ed), dict, { now, manual: true, patterns: date });
        expect(ed.getLine(0)).toBe("on day 5 now");
        expect(ed.getCursor()).toEqual({ line: 0, ch: 8 });
    });

    it("a literal trigger wins over a rule that matches the same text", async () => {
        const both = rules({ source: "/brb$/", replacement: "PATTERN", mode: "separator" });
        const ed = at("say brb");
        await tryExpandAtCursor(asEditor(ed), dict, { now, manual: true, patterns: both });
        expect(ed.getLine(0)).toBe("say be right back");
    });

    it("a selection is replaced only as a literal trigger, rules do not see it", async () => {
        const ed = at("on dd5", 6, "dd5");
        expect(await tryExpandAtCursor(asEditor(ed), dict, { now, manual: true, patterns: date })).toBeUndefined();
        expect(ed.getLine(0)).toBe("on dd5");
    });

    // The command and Tab never know about an auto-paired closer: with the same rule an instant typing path would take
    // the `)`; here it stays.
    it("never takes the bracket after the caret (no pairCloser on this path)", async () => {
        const opener = rules({ source: String.raw`/\(c$/`, replacement: "\u00a9", mode: "separator" });
        const ed = at("x (c)", 4);
        await tryExpandAtCursor(asEditor(ed), dict, { now, patterns: opener });
        expect(ed.getLine(0)).toBe("x \u00a9)");
    });

    it("without `manual` a rule inside a word does nothing, as before", async () => {
        const ed = at("on dd5 now", 5);
        expect(await tryExpandAtCursor(asEditor(ed), dict, { now, patterns: date })).toBeUndefined();
    });

    describe("a caret inside a word: the match must start at or before the caret (command and Tab alike)", () => {
        const tail = rules({ source: String.raw`/dd(\d+)$/`, replacement: "day {{1}}", mode: "separator" });

        it("a tail the caret is not in is left alone: nothing changes, the caret stays", async () => {
            const ed = at("abcdd5 x", 1);
            expect(await tryExpandAtCursor(asEditor(ed), dict, { now, manual: true, patterns: tail })).toBeUndefined();
            expect(ed.getLine(0)).toBe("abcdd5 x");
            expect(ed.getCursor()).toEqual({ line: 0, ch: 1 });
        });

        it("a match that spans the caret still expands and parks the caret after the new text", async () => {
            const ed = at("abcdd5 x", 4);
            await tryExpandAtCursor(asEditor(ed), dict, { now, manual: true, patterns: tail });
            expect(ed.getLine(0)).toBe("abcday 5 x");
            expect(ed.getCursor()).toEqual({ line: 0, ch: 8 });
        });
    });

    describe("rules run once per Tab (the check's hit is handed to the expansion)", () => {
        // Compiled per test: the health counters (runs, switchedOff) are state, so no test can see another's.
        const compile = (): ReturnType<typeof rules> => rules({ source: String.raw`/\bdd(\d+)$/`, replacement: "day {{1}}", mode: "separator" });

        it("check plus expansion with `prepared` is one run of the rule", async () => {
            const ruleSet = compile();
            const ed = at("on dd5");
            const found = canExpandAtCursor(asEditor(ed), dict, undefined, ruleSet);
            expect(found).toBeDefined();
            await tryExpandAtCursor(asEditor(ed), dict, { now, manual: true, patterns: ruleSet, prepared: found });
            expect(ed.getLine(0)).toBe("on day 5");
            expect(ruleSet[0]?.health.runs).toBe(1);
        });

        it("a rule the first run switched off cannot make the expansion find nothing", async () => {
            const ruleSet = compile();
            const ed = at("on dd5");
            const found = canExpandAtCursor(asEditor(ed), dict, undefined, ruleSet);
            // What a second run would see: the guard (strikes, 8 ms budget) took the rule out after the check.
            const rule = ruleSet[0];
            if (rule) rule.health.switchedOff = "Switched off: test.";
            await tryExpandAtCursor(asEditor(ed), dict, { now, manual: true, patterns: ruleSet, prepared: found });
            expect(ed.getLine(0)).toBe("on day 5");
            // Control: without the handed hit the same switched-off rule finds nothing, so the test is not vacuous.
            const again = at("on dd5");
            expect(await tryExpandAtCursor(asEditor(again), dict, { now, manual: true, patterns: ruleSet })).toBeUndefined();
        });

        it("a literal trigger handed over expands without the rules being consulted", async () => {
            const both = rules({ source: "/brb$/", replacement: "PATTERN", mode: "separator" });
            const ed = at("say brb");
            const found = canExpandAtCursor(asEditor(ed), dict, undefined, both);
            expect(both[0]?.health.runs).toBe(0);
            await tryExpandAtCursor(asEditor(ed), dict, { now, manual: true, patterns: both, prepared: found });
            expect(ed.getLine(0)).toBe("say be right back");
            expect(both[0]?.health.runs).toBe(0);
        });
    });

    describe("the context guard of a rule hit (no `prepared`: the command and the alias)", () => {
        const cases: Array<[string, () => MockEditor]> = [
            ["inline code", () => at("`on dd5", 7)],
            [
                "a fenced block",
                () => {
                    const ed = new MockEditor("```\non dd5\n```");
                    ed.setCursor({ line: 1, ch: 6 });
                    return ed;
                },
            ],
            [
                "frontmatter",
                () => {
                    const ed = new MockEditor("---\ntitle: dd5\n---\n");
                    ed.setCursor({ line: 1, ch: 11 });
                    return ed;
                },
            ],
        ];

        for (const manual of [true, false]) {
            for (const [name, make] of cases) {
                it(`writes nothing in ${name} (manual: ${manual})`, async () => {
                    const ed = make();
                    const before = ed.lines.join("\n");
                    const result = await tryExpandAtCursor(asEditor(ed), dict, { now, manual, patterns: compileDate() });
                    expect(result).toBeUndefined();
                    expect(ed.lines.join("\n")).toBe(before);
                });
            }
        }

        it("control: the same rule expands outside code", async () => {
            const ed = at("on dd5");
            expect(await tryExpandAtCursor(asEditor(ed), dict, { now, manual: true, patterns: compileDate() })).toMatchObject({ insert: "day 5" });
        });
    });

    it("a prepared rule hit is written through the CM6 view as its own undo step (PATTERN_USER_EVENT)", async () => {
        const ruleSet = compileDate();
        const { editor, specs } = withView(at("on dd5"));
        const found = canExpandAtCursor(asEditor(editor), dict, undefined, ruleSet);
        await tryExpandAtCursor(asEditor(editor), dict, { now, manual: true, patterns: ruleSet, prepared: found });
        expect(editor.getLine(0)).toBe("on day 5");
        expect(specs).toHaveLength(1);
        expect(specs[0]?.userEvent).toBe(PATTERN_USER_EVENT);
    });
});

describe("adapters/obsidian-editor: B-255 manual expansion (selection, caret inside a word)", () => {
    const deps = { now: new Date("2025-09-02T10:11:12Z"), manual: true };
    const dict: Dict = { brb: "be right back", fn: "function $|()", lnk: "[$1]($2)" };

    function at(text: string, ch = text.length, selection = ""): MockEditor {
        const ed = new MockEditor(text);
        ed.setCursor({ line: 0, ch });
        ed.selection = selection;
        return ed;
    }

    it("a selection that is exactly a trigger is replaced and the caret lands after the new text", async () => {
        const ed = at("say brb now", 7, "brb");
        const result = await tryExpandAtCursor(asEditor(ed), dict, deps);
        expect(ed.getLine(0)).toBe("say be right back now");
        expect(result).toEqual({ from: 4, insert: "be right back", original: "brb", separator: "" });
        expect(ed.getCursor()).toEqual({ line: 0, ch: "say be right back".length });
    });

    it("a selection that is only the tail of a longer word is left alone", async () => {
        const ed = at("xbrb", 4, "brb");
        expect(await tryExpandAtCursor(asEditor(ed), dict, deps)).toBeUndefined();
        expect(ed.getLine(0)).toBe("xbrb");
    });

    it("a selection that is no trigger is left alone", async () => {
        const ed = at("hello", 5, "hello");
        expect(await tryExpandAtCursor(asEditor(ed), dict, deps)).toBeUndefined();
    });

    it("a selection spanning a separator is never a trigger", async () => {
        const ed = at("a brb", 5, "a brb");
        expect(await tryExpandAtCursor(asEditor(ed), dict, deps)).toBeUndefined();
    });

    it("a selected trigger inside code is not expanded", async () => {
        const ed = at("`brb`", 4, "brb");
        expect(await tryExpandAtCursor(asEditor(ed), dict, deps)).toBeUndefined();
        expect(ed.getLine(0)).toBe("`brb`");
    });

    it("prefix mode: a selection of the trigger alone is taken and the unselected prefix char is consumed", async () => {
        const ed = at("x :brb y", 6, "brb");
        const result = await tryExpandAtCursor(asEditor(ed), dict, { ...deps, prefix: ":" });
        expect(ed.getLine(0)).toBe("x be right back y");
        expect(result?.original).toBe(":brb");
    });

    it("prefix mode: a selection of prefix char + trigger is taken", async () => {
        const ed = at("x :brb y", 6, ":brb");
        const result = await tryExpandAtCursor(asEditor(ed), dict, { ...deps, prefix: ":" });
        expect(ed.getLine(0)).toBe("x be right back y");
        expect(result?.original).toBe(":brb");
    });

    it("prefix mode: a selected trigger with no prefix char before it is not taken", async () => {
        const ed = at("x brb y", 5, "brb");
        expect(await tryExpandAtCursor(asEditor(ed), dict, { ...deps, prefix: ":" })).toBeUndefined();
        expect(ed.getLine(0)).toBe("x brb y");
    });

    it("a caret inside a trigger word expands the WHOLE word and parks the caret after it", async () => {
        const ed = at("say brb now", 6);
        const result = await tryExpandAtCursor(asEditor(ed), dict, deps);
        expect(ed.getLine(0)).toBe("say be right back now");
        expect(result?.original).toBe("brb");
        expect(ed.getCursor()).toEqual({ line: 0, ch: "say be right back".length });
    });

    it("a caret inside a word that is no trigger does nothing", async () => {
        const ed = at("say brbx now", 6);
        expect(await tryExpandAtCursor(asEditor(ed), dict, deps)).toBeUndefined();
        expect(ed.getLine(0)).toBe("say brbx now");
    });

    it("a caret at the start of a word does nothing", async () => {
        const ed = at("say brb", 4);
        expect(await tryExpandAtCursor(asEditor(ed), dict, deps)).toBeUndefined();
    });

    it("a mid-word trigger with fields opens a session instead of parking the caret", async () => {
        const ed = at("x lnk", 4);
        const result = await tryExpandAtCursor(asEditor(ed), dict, deps);
        expect(ed.getLine(0)).toBe("x []()");
        expect(result?.session).toBeDefined();
    });

    it("never matches an inherited Object.prototype key mid-word (S-008)", async () => {
        const ed = at("constructor", 4);
        expect(await tryExpandAtCursor(asEditor(ed), {}, deps)).toBeUndefined();
    });

    it("without `manual` the command keeps its old rules (selection and mid-word do nothing)", async () => {
        const plain = { now: deps.now };
        expect(await tryExpandAtCursor(asEditor(at("say brb", 7, "brb")), dict, plain)).toBeUndefined();
        expect(await tryExpandAtCursor(asEditor(at("say brb now", 6)), dict, plain)).toBeUndefined();
    });
});

describe("adapters/obsidian-editor: Enter in a list item (B-246)", () => {
    const deps = { now: new Date("2025-09-02T10:11:12Z") };
    const dict: Dict = { sig: "Best regards", lnk: "[$1]($2)" };

    // The editor continued the list in the same change: the document already holds the new marker and the caret
    // sits after it.
    const enter = async (
        doc: string,
        listContinuation: string,
        snippets: Dict = dict,
    ): Promise<{ ed: MockEditor; result: Awaited<ReturnType<typeof tryExpandAtSeparator>> }> => {
        const ed = new MockEditor(doc);
        const lines = doc.split("\n");
        ed.setCursor({ line: lines.length - 1, ch: lines[lines.length - 1]?.length ?? 0 });
        const result = await tryExpandAtSeparator(asEditor(ed), snippets, { ...deps, listContinuation });
        return { ed, result };
    };

    it.each([
        ["bullet", "- sig\n- ", "\n- ", "- Best regards\n- "],
        ["numbered", "1. sig\n2. ", "\n2. ", "1. Best regards\n2. "],
        ["task", "- [ ] sig\n- [ ] ", "\n- [ ] ", "- [ ] Best regards\n- [ ] "],
        ["nested", "- a\n\tsig\n\t- ", "\n\t- ", "- a\n\tBest regards\n\t- "],
        ["a trigger after other words", "- say sig\n- ", "\n- ", "- say Best regards\n- "],
    ])("%s: expands the previous line and keeps the new marker", async (_name, doc, tail, expected) => {
        const { ed, result } = await enter(doc, tail);
        expect(ed.value()).toBe(expected);
        // the caret stays after the new marker, where the editor put it (the line moved only by the expansion's length)
        const lines = expected.split("\n");
        expect(ed.getCursor()).toEqual({ line: lines.length - 1, ch: lines[lines.length - 1]?.length });
        expect(result?.separator).toBe(tail);
    });

    it("a word that is not a trigger changes nothing", async () => {
        const { ed, result } = await enter("- hello\n- ", "\n- ");
        expect(ed.value()).toBe("- hello\n- ");
        expect(result).toBeUndefined();
    });

    it("the new marker is not read as a trigger line of its own", async () => {
        const { ed } = await enter("- sig\n- ", "\n- ", { "-": "dash" });
        expect(ed.value()).toBe("- sig\n- ");
    });

    it("does nothing when the caret is not where the Enter left it (a stale update)", async () => {
        const ed = new MockEditor("- sig\n- x");
        ed.setCursor({ line: 1, ch: 3 });
        expect(await tryExpandAtSeparator(asEditor(ed), dict, { ...deps, listContinuation: "\n- " })).toBeUndefined();
        expect(ed.value()).toBe("- sig\n- x");
    });

    it("keeps the guards: no expansion inside a fenced code block", async () => {
        const { ed } = await enter("```\n- sig\n- ", "\n- ");
        expect(ed.value()).toBe("```\n- sig\n- ");
    });

    it("keeps the guards: no expansion inside inline code on the line", async () => {
        const { ed } = await enter("- `sig\n- ", "\n- ");
        expect(ed.value()).toBe("- `sig\n- ");
    });

    it("a snippet with fields opens a session that ends after the new marker", async () => {
        const { ed, result } = await enter("- lnk\n- ", "\n- ");
        expect(ed.value()).toBe("- []()\n- ");
        // fields after "- [" (3) and "- [](" (5); the final stop is the caret: after "- []()\n- " (9)
        expect(result?.session).toEqual({ fields: [3, 5], docOrder: [0, 1], final: 9 });
    });

    it("without a continuation, the same document is read as before (marker line, caret after the marker)", async () => {
        const ed = new MockEditor("- sig\n- ");
        ed.setCursor({ line: 1, ch: 2 });
        await tryExpandAtSeparator(asEditor(ed), dict, deps);
        expect(ed.value()).toBe("- sig\n- ");
    });
});
