import { test, expect, ui } from "./fixtures";

/**
 * E2E: Snipsy's Obsidian commands surface.
 *
 * Snipsy registers two commands in `src/app/plugin.ts`:
 *
 *   - `snipsidian:insert-snippet` (covered by picker.spec.ts and
 *     picker-features.spec.ts, since it opens a modal)
 *   - `snipsidian:open-settings` (covered here — it opens
 *     Settings and switches to our tab)
 *
 * Without an E2E for `open-settings`, the only assertion in the
 * suite is the unit test that `addCommand` was called — which
 * doesn't catch a regression in `setting.open()` /
 * `setting.openTabById(this.manifest.id)`.
 */

test.describe("Snipsy commands", () => {
    test("`snipsidian:open-settings` opens Settings on our tab (B-106)", async ({
        win,
        obsidian,
    }) => {
        // Trigger the command the way the user would via the
        // command palette — bypassing the palette UI itself to
        // keep the test focused on the command's effect, not on
        // Obsidian's fuzzy-match heuristics.
        await obsidian.runCommand("snipsidian:open-settings");

        // B-158: the kit's vault keeps Settings in the main window
        // (`settingsPopoutWindow: false`), so the content the command
        // opens is in `win`. This spec tests the command itself, so it
        // does not go through `obsidian.openSettings`.

        // B-151/ADR-0007: on Obsidian 1.13+ the tab opens on the
        // declarative root (Snippets/Packages page entries + General/
        // About groups), so "Add snippet" is one click deeper — a
        // no-op below 1.13, where Snippets is already the default
        // landing tab.
        await ui.openSnippetsPage(win);

        // The Settings modal opens with our tab active, and the
        // Snippets page's "Add snippet" toolbar button — that's
        // SnippetsTab.ts's first piece of content and is unique to
        // the Snipsy tab — is visible.
        await expect(
            win.getByRole("button", { name: "Add snippet" }).first(),
        ).toBeVisible({ timeout: 5_000 });

        // The Settings sidebar's Snipsy entry is also highlighted.
        // We assert via the `data-tab-id` attribute that
        // Obsidian's settings panel exposes — more stable than a
        // text-based locator.
        const activeTabId = await win.evaluate(() => {
            return (
                (globalThis as unknown as {
                    app?: {
                        setting?: {
                            activeTab?: { id?: string };
                        };
                    };
                }).app?.setting?.activeTab?.id ?? null
            );
        });
        expect(activeTabId).toBe("snipsidian");
    });
});
