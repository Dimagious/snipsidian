import { test, expect, ui, seedSnippets } from "./fixtures";

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

    // Real Obsidian 1.14.5: Enter in a list item continues the list marker in
    // the same keystroke, and no snippet expands there, with or without
    // fields (the same in 1.7.3). Pinned so a change of that behaviour shows
    // up; expanding on Enter in lists is backlog B-246.
    test("Enter in a list item expands nothing and opens no session", async ({ win, obsidian }) => {
        await obsidian.editor().type("- lnk\n");
        expect(await obsidian.editor().text()).toBe("- lnk\n- ");
        await expect(win.locator(".cm-content .snipsy-field-empty")).toHaveCount(0);
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
