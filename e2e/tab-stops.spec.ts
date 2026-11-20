import { test, expect, ui, seedSnippets } from "./fixtures";
import type { SnipsyApp } from "./fixtures";
import type { ObsidianHelpers } from "obsidian-plugin-dev-kit/e2e";

/**
 * E2E (B-243 / B-244, NOT run by the maker: needs a real Obsidian window):
 * Tab stops (`$1`..`$9`, then `$|`) and the command "Expand trigger at cursor".
 *
 * Contract pinned here:
 *   - two or more fields open a session: the caret is in `$1`, Tab walks the
 *     fields, the last Tab lands on `$|`, or (without it) where the caret
 *     would be with no fields at all: after the typed separator (B-182)
 *   - nothing is written into the note (no markers), a session leaves nothing behind
 *   - Tab is ours only while a session is open: a list item still indents
 *   - Shift+Tab goes back, Escape / clicking elsewhere ends the session; blurring the editor (the Command Palette) does not
 *   - the commands `next-field` and `expand-trigger` do what their names say
 */

test.describe("[B-243] tab stops", () => {
    test.beforeEach(async ({ obsidian }) => {
        await obsidian.editor().clear();
        await seedSnippets(obsidian, {
            lnk: "[$1]($2)",
            fnc: "function $1($2) { $| }",
            one: "[$1](url)",
        });
    });

    test("Tab walks the fields, the last Tab lands after the typed separator", async ({ win, obsidian }) => {
        await obsidian.editor().type("lnk ");
        expect(await obsidian.editor().text()).toBe("[]() ");
        await obsidian.editor().type("text");
        await win.keyboard.press("Tab");
        await obsidian.editor().type("url");
        expect(await obsidian.editor().text()).toBe("[text](url) ");
        await win.keyboard.press("Tab");
        // The final stop is where the caret sits with no fields: after the typed space.
        await obsidian.editor().type("!");
        expect(await obsidian.editor().text()).toBe("[text](url) !");
    });

    test("`$|` is the final stop", async ({ win, obsidian }) => {
        await obsidian.editor().type("fnc ");
        await obsidian.editor().type("go");
        await win.keyboard.press("Tab");
        await obsidian.editor().type("a");
        await win.keyboard.press("Tab");
        await obsidian.editor().type("body");
        expect(await obsidian.editor().text()).toBe("function go(a) { body } ");
    });

    test("empty fields are visible, the session leaves no marker or class behind", async ({ win, obsidian }) => {
        await obsidian.editor().type("lnk ");
        await expect(win.locator(".cm-content .snipsy-field-empty")).toHaveCount(2);
        await win.keyboard.press("Tab");
        await win.keyboard.press("Tab");
        await expect(win.locator(".cm-content .snipsy-field-empty")).toHaveCount(0);
        expect(await obsidian.editor().text()).toBe("[]() ");
    });

    test("Shift+Tab goes back to the previous field", async ({ win, obsidian }) => {
        await obsidian.editor().type("lnk ");
        await win.keyboard.press("Tab");
        await obsidian.editor().type("u");
        await win.keyboard.press("Shift+Tab");
        await obsidian.editor().type("t");
        expect(await obsidian.editor().text()).toBe("[t](u) ");
    });

    test("Escape ends the session: Tab is no longer taken", async ({ win, obsidian }) => {
        await obsidian.editor().type("lnk ");
        await win.keyboard.press("Escape");
        await expect(win.locator(".cm-content .snipsy-field-empty")).toHaveCount(0);
        await win.keyboard.press("Tab");
        // Tab was NOT consumed by a field jump: the caret did not move to the second field (`[]()` -> ch 3).
        expect((await obsidian.editor().selection()).head.ch).not.toBe(3);
    });

    test("clicking elsewhere (caret outside every field) ends the session", async ({ win, obsidian }) => {
        await obsidian.editor().type("lnk ");
        await obsidian.editor().setCursor(0, 5);
        await expect(win.locator(".cm-content .snipsy-field-empty")).toHaveCount(0);
    });

    test("a single `$1` is the caret and opens no session (B-192 unchanged)", async ({ win, obsidian }) => {
        await obsidian.editor().type("one ");
        await expect(win.locator(".cm-content .snipsy-field-empty")).toHaveCount(0);
        await obsidian.editor().type("text");
        expect(await obsidian.editor().text()).toBe("[text](url) ");
    });

    test("without a session, Tab in a list item still indents", async ({ win, obsidian }) => {
        await obsidian.editor().type("- first\n");
        await obsidian.editor().type("second");
        await win.keyboard.press("Tab");
        const text = await obsidian.editor().text();
        expect(text).toMatch(/^- first\n\s+- second$/);
    });

    test("with a session open inside a list item, Tab jumps to the field instead of indenting", async ({ win, obsidian }) => {
        await obsidian.editor().type("- lnk ");
        await win.keyboard.press("Tab");
        await obsidian.editor().type("url");
        expect(await obsidian.editor().text()).toBe("- [](url) ");
    });

    test("typing an auto-paired character inside a field keeps the session", async ({ win, obsidian }) => {
        await obsidian.editor().type("lnk ");
        // `(` is auto-closed by Obsidian: the insert may arrive without an `input` user event.
        await obsidian.editor().type("a(b");
        await win.keyboard.press("Tab");
        await obsidian.editor().type("url");
        expect(await obsidian.editor().text()).toContain("](url)");
        expect(await obsidian.editor().text()).toMatch(/^\[a\(b\)?\]\(url\)/);
    });

    test("Enter as the separator: the session starts on the previous line, the last Tab lands on the new line", async ({
        win,
        obsidian,
    }) => {
        await obsidian.editor().type("lnk\n");
        await obsidian.editor().type("a");
        await win.keyboard.press("Tab");
        await obsidian.editor().type("u");
        await win.keyboard.press("Tab");
        await obsidian.editor().type("!");
        expect(await obsidian.editor().text()).toBe("[a](u)\n!");
    });

    test("leaving the editor for a moment (a ribbon click) keeps the session", async ({ win, obsidian }) => {
        await obsidian.editor().type("lnk ");
        // The expansion is async: wait for it before leaving the editor.
        await expect.poll(() => obsidian.editor().text()).toContain("](");
        await win.locator(".workspace-ribbon").first().click();
        await expect(win.locator(".cm-content .snipsy-field-empty")).toHaveCount(2);
        await obsidian.runCommand("snipsidian:next-field");
        await obsidian.editor().type("url");
        expect(await obsidian.editor().text()).toContain("url");
    });

    test("`Snipsy: Next field` from the real Command Palette moves the caret to the next field", async ({
        obsidian,
    }) => {
        await obsidian.editor().type("lnk ");
        await obsidian.editor().type("text");
        // The palette blurs the editor: the session has to survive that.
        // Obsidian 1.14.5 draws the "Snipsy: " prefix colon with CSS, so the
        // entry's text is "SnipsyNext field": match by the command name only.
        await obsidian.runCommandFromPalette("Next field");
        await obsidian.editor().type("url");
        expect(await obsidian.editor().text()).toBe("[text](url) ");
    });

    // B-246: real Obsidian 1.14.5 continues the list marker in the same change as the line break (the last typed
    // character becomes itself plus "\n- "). The line break still ends the trigger: the previous line is expanded and
    // the new marker stays, with the caret after it. A snippet with fields opens a session as on any other line.
    test("Enter in a list item expands the trigger, keeps the new marker, and a session ends after it", async ({ win, obsidian }) => {
        await obsidian.editor().type("- lnk\n");
        expect(await obsidian.editor().text()).toBe("- []()\n- ");
        await obsidian.editor().type("text");
        await win.keyboard.press("Tab");
        await obsidian.editor().type("url");
        expect(await obsidian.editor().text()).toBe("- [text](url)\n- ");
        await win.keyboard.press("Tab");
        await obsidian.editor().type("!");
        expect(await obsidian.editor().text()).toBe("- [text](url)\n- !");
    });

    test("command `next-field` jumps like Tab, and does nothing without a session", async ({ obsidian }) => {
        await obsidian.editor().type("plain");
        await obsidian.runCommand("snipsidian:next-field");
        expect(await obsidian.editor().text()).toBe("plain");
        await obsidian.editor().clear();
        await obsidian.editor().type("lnk ");
        await obsidian.runCommand("snipsidian:next-field");
        await obsidian.editor().type("url");
        expect(await obsidian.editor().text()).toBe("[](url) ");
    });
});

test.describe("[B-244] command: Expand trigger at cursor", () => {
    test.beforeEach(async ({ obsidian }) => {
        await obsidian.editor().clear();
        await seedSnippets(obsidian, { lnk: "[$1]($2)" });
    });

    test("expands the trigger right before the caret, no separator typed", async ({ obsidian }) => {
        await obsidian.editor().type("say brb");
        await obsidian.runCommand("snipsidian:expand-trigger");
        expect(await obsidian.editor().text()).toBe("say be right back");
    });

    test("opens a field session for a snippet with fields", async ({ win, obsidian }) => {
        await obsidian.editor().type("lnk");
        await obsidian.runCommand("snipsidian:expand-trigger");
        await obsidian.editor().type("text");
        await win.keyboard.press("Tab");
        await obsidian.editor().type("url");
        expect(await obsidian.editor().text()).toBe("[text](url)");
    });

    test("with no trigger at the caret it jumps to the next field of an open session", async ({ obsidian }) => {
        await obsidian.editor().type("lnk ");
        await obsidian.runCommand("snipsidian:expand-trigger");
        await obsidian.editor().type("url");
        expect(await obsidian.editor().text()).toBe("[](url) ");
    });

    test("does nothing when there is no trigger and no session", async ({ obsidian }) => {
        await obsidian.editor().type("nothing here");
        await obsidian.runCommand("snipsidian:expand-trigger");
        expect(await obsidian.editor().text()).toBe("nothing here");
    });

    test("respects the guards: inside inline code nothing expands", async ({ obsidian }) => {
        // Obsidian may auto-close the backtick; either way the caret is inside inline code.
        await obsidian.editor().type("`brb");
        await obsidian.runCommand("snipsidian:expand-trigger");
        expect(await obsidian.editor().text()).not.toContain("be right back");
    });
});

test.describe("[B-243] field sessions from the picker", () => {
    test.beforeEach(async ({ obsidian }) => {
        await obsidian.editor().clear();
        await seedSnippets(obsidian, { zzlnk: "[$1]($2)" });
    });

    async function pick(win: import("@playwright/test").Page, obsidian: import("obsidian-plugin-dev-kit/e2e").ObsidianHelpers): Promise<void> {
        await obsidian.runCommand("snipsidian:insert-snippet");
        await win.locator(".snippet-picker-modal input[role='combobox']").waitFor({ state: "visible" });
        await ui.fillPickerFilter(win, "zzlnk", "zzlnk");
        await win.keyboard.press("Enter");
        await expect(win.locator(".snippet-picker-modal")).toHaveCount(0);
    }

    test("insert: the session survives the modal closing, Tab walks the fields", async ({ win, obsidian }) => {
        await ui.activeEditor(win).click();
        await pick(win, obsidian);
        await expect(win.locator(".cm-content .snipsy-field-empty")).toHaveCount(2);
        await obsidian.editor().type("text");
        await win.keyboard.press("Tab");
        await obsidian.editor().type("url");
        expect(await obsidian.editor().text()).toBe("[text](url)");
    });

    test("wrap: `$1` takes the selection, the session starts at `$2` and survives the modal closing", async ({
        win,
        obsidian,
    }) => {
        await ui.activeEditor(win).click();
        await obsidian.editor().type("word");
        await obsidian.press("Mod+A");
        await pick(win, obsidian);
        await expect(win.locator(".cm-content .snipsy-field-empty")).toHaveCount(1);
        await obsidian.editor().type("url");
        expect(await obsidian.editor().text()).toBe("[word](url)");
    });
});

test.describe("[B-246] Enter in a list item", () => {
    test.beforeEach(async ({ obsidian }) => {
        await obsidian.editor().clear();
        await seedSnippets(obsidian, { sig: "Best regards" });
    });

    test("a bullet: expands, keeps the new marker, the caret is after it", async ({ obsidian }) => {
        await obsidian.editor().type("- sig\n");
        expect(await obsidian.editor().text()).toBe("- Best regards\n- ");
        await obsidian.editor().type("x");
        expect(await obsidian.editor().text()).toBe("- Best regards\n- x");
    });

    test("a numbered item", async ({ obsidian }) => {
        await obsidian.editor().type("1. sig\n");
        expect(await obsidian.editor().text()).toBe("1. Best regards\n2. ");
        await obsidian.editor().type("x");
        expect(await obsidian.editor().text()).toBe("1. Best regards\n2. x");
    });

    test("a task", async ({ obsidian }) => {
        await obsidian.editor().type("- [ ] sig\n");
        expect(await obsidian.editor().text()).toBe("- [ ] Best regards\n- [ ] ");
        await obsidian.editor().type("x");
        expect(await obsidian.editor().text()).toBe("- [ ] Best regards\n- [ ] x");
    });

    test("a nested item", async ({ win, obsidian }) => {
        await obsidian.editor().type("- a\n");
        await win.keyboard.press("Tab");
        await obsidian.editor().type("sig\n");
        expect(await obsidian.editor().text()).toMatch(/^- a\n\s+- Best regards\n\s+- $/);
        await obsidian.editor().type("x");
        expect(await obsidian.editor().text()).toMatch(/\n\s+- x$/);
    });

    test("a word that is not a trigger changes nothing", async ({ obsidian }) => {
        await obsidian.editor().type("- hello\n");
        expect(await obsidian.editor().text()).toBe("- hello\n- ");
    });

    test("Enter on the empty item that follows still removes the marker", async ({ obsidian }) => {
        await obsidian.editor().type("- sig\n");
        await obsidian.editor().type("\n");
        expect((await obsidian.editor().text()).startsWith("- Best regards\n")).toBe(true);
        expect(await obsidian.editor().text()).not.toMatch(/\n- $/);
    });

    test("inside a fenced code block nothing expands", async ({ obsidian }) => {
        await obsidian.editor().type("```\n- sig\n");
        expect(await obsidian.editor().text()).not.toContain("Best regards");
    });

    // Real Obsidian 1.14.5 renumbers the items below in the SAME transaction as the continuation (`2. b` becomes
    // `3. b`), so the update has more than one change; the expansion must still happen.
    test("a numbered item above others: the items below are renumbered and the trigger still expands", async ({ win, obsidian }) => {
        await putCaret(obsidian, "1. \n2. b\n3. c", 0, 3);
        await win.keyboard.type("sig");
        await win.keyboard.press("Enter");
        expect(await obsidian.editor().text()).toBe("1. Best regards\n2. \n3. b\n4. c");
        await obsidian.editor().type("x");
        expect(await obsidian.editor().text()).toBe("1. Best regards\n2. x\n3. b\n4. c");
    });

    test("a numbered item above one other item", async ({ win, obsidian }) => {
        await putCaret(obsidian, "1. \n2. b", 0, 3);
        await win.keyboard.type("sig");
        await win.keyboard.press("Enter");
        expect(await obsidian.editor().text()).toBe("1. Best regards\n2. \n3. b");
    });

    // The word before the caret is a trigger, and Enter in the middle of a plain line expands it and drops the blank
    // it broke at (`sig tail` becomes `Best regards` / `tail`). The list does the same.
    test("Enter in the middle of an item expands and moves the rest to the new item", async ({ win, obsidian }) => {
        await putCaret(obsidian, "-  tail", 0, 2);
        await win.keyboard.type("sig");
        await win.keyboard.press("Enter");
        expect(await obsidian.editor().text()).toBe("- Best regards\n- tail");
        expect(await obsidian.editor().selection()).toMatchObject({ head: { line: 1, ch: 2 } });
    });

    test("Enter in the middle of a plain line (the behaviour the list matches)", async ({ win, obsidian }) => {
        await putCaret(obsidian, " tail", 0, 0);
        await win.keyboard.type("sig");
        await win.keyboard.press("Enter");
        expect(await obsidian.editor().text()).toBe("Best regards\ntail");
    });

    test("a checked task: Obsidian opens an unchecked one below", async ({ win, obsidian }) => {
        await putCaret(obsidian, "- [x] ", 0, 6);
        await win.keyboard.type("sig");
        await win.keyboard.press("Enter");
        expect(await obsidian.editor().text()).toBe("- [x] Best regards\n- [ ] ");
    });

    test("a list in a blockquote", async ({ win, obsidian }) => {
        await putCaret(obsidian, "> - ", 0, 4);
        await win.keyboard.type("sig");
        await win.keyboard.press("Enter");
        expect(await obsidian.editor().text()).toBe("> - Best regards\n> - ");
    });

    test("a plain blockquote line", async ({ win, obsidian }) => {
        await putCaret(obsidian, "> ", 0, 2);
        await win.keyboard.type("sig");
        await win.keyboard.press("Enter");
        expect(await obsidian.editor().text()).toBe("> Best regards\n> ");
    });

    test("a callout body, plain and as a list", async ({ win, obsidian }) => {
        await putCaret(obsidian, "> [!note]\n> ", 1, 2);
        await win.keyboard.type("sig");
        await win.keyboard.press("Enter");
        expect(await obsidian.editor().text()).toBe("> [!note]\n> Best regards\n> ");

        await putCaret(obsidian, "> [!note]\n> - ", 1, 4);
        await win.keyboard.type("sig");
        await win.keyboard.press("Enter");
        expect(await obsidian.editor().text()).toBe("> [!note]\n> - Best regards\n> - ");
    });
});

/** Replaces the note with `doc` and puts the caret at `line`, `ch`, with no keystroke (so nothing expands on the way). */
async function putCaret(obsidian: ObsidianHelpers, doc: string, line: number, ch: number): Promise<void> {
    await obsidian.editor().clear();
    await obsidian.evaluate(
        (app: SnipsyApp, text: string) => {
            const editor = (app as unknown as { workspace: { activeEditor?: { editor?: { setValue(v: string): void } } } })
                .workspace.activeEditor?.editor;
            if (!editor) throw new Error("no active editor");
            editor.setValue(text);
        },
        doc,
    );
    await obsidian.editor().setCursor(line, ch);
}
