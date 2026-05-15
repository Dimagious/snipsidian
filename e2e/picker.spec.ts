import { test, expect, ui } from "./fixtures";

/**
 * E2E: Snippet Picker via command palette.
 *
 * Why E2E: the picker has unit + jsdom-mount tests, but neither
 * exercises the integration with Obsidian's command palette and
 * the editor adapter that does the actual `wrapSelectionWithSnippet`
 * / `insertSnippetAtCursor` writes. Snipsy's `Insert snippet`
 * command surfaces the picker; a snippet selected from the picker
 * must land in the active editor.
 */

test.describe("snippet picker via command palette", () => {
    test("inserts a selected snippet into the active editor", async ({
        win,
    }) => {
        // Make sure the editor has focus so the inserted snippet
        // lands somewhere we can read it back. The win fixture
        // leaves the workspace with Welcome.md open; click into
        // the editor to focus.
        const editor = ui.activeEditor(win);
        await editor.click();
        await win.keyboard.press("Meta+A");
        await win.keyboard.press("Delete");

        // Open Snipsy's "Insert snippet" command via Obsidian's
        // internal API. Avoids the command-palette typing dance,
        // which is flaky because some Obsidian versions
        // fuzzy-match different commands first.
        await win.evaluate(() => {
            const a = (globalThis as unknown as {
                app?: { commands?: { executeCommandById?: (id: string) => void } };
            }).app;
            a?.commands?.executeCommandById?.("snipsidian:insert-snippet");
        });

        // The picker modal opens. Filter to `brb` (seeded in the
        // pristine vault) so there's exactly one hit, then Enter.
        const filter = win.locator(
            ".snippet-picker-modal input[role='combobox']",
        );
        await filter.waitFor({ state: "visible" });
        await filter.fill("brb");
        // Wait for the result list to settle — the picker has a
        // 200ms search debounce.
        await win.waitForTimeout(300);
        await win.keyboard.press("Enter");

        // The replacement for `brb` is `be right back`. Verify it
        // landed in the editor.
        const value = await ui.editorText(win);
        expect(value).toContain("be right back");
    });

    test("Esc closes the picker without inserting", async ({ win }) => {
        const editor = ui.activeEditor(win);
        await editor.click();
        await win.keyboard.press("Meta+A");
        await win.keyboard.press("Delete");

        // Open picker
        await win.evaluate(() => {
            const a = (globalThis as unknown as {
                app?: { commands?: { executeCommandById?: (id: string) => void } };
            }).app;
            a?.commands?.executeCommandById?.("snipsidian:insert-snippet");
        });

        const filter = win.locator(
            ".snippet-picker-modal input[role='combobox']",
        );
        await filter.waitFor({ state: "visible" });
        await filter.fill("brb");
        await win.waitForTimeout(300);

        // Close without selecting
        await win.keyboard.press("Escape");

        // Modal should be gone
        await expect(filter).not.toBeVisible();

        // Editor is still empty — nothing was inserted.
        const value = await ui.editorText(win);
        expect(value).toBe("");
    });
});
