import { test, expect } from "./fixtures";

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
    }) => {
        // Trigger the command the way the user would via the
        // command palette — bypassing the palette UI itself to
        // keep the test focused on the command's effect, not on
        // Obsidian's fuzzy-match heuristics.
        await win.evaluate(() => {
            const a = (globalThis as unknown as {
                app?: {
                    commands?: { executeCommandById?: (id: string) => boolean };
                };
            }).app;
            a?.commands?.executeCommandById?.("snipsidian:open-settings");
        });

        // The Settings modal opens with our tab active. The tab's
        // header is "Add snippet" toolbar button — that's
        // SnippetsTab.ts's first piece of content and is unique to
        // the Snipsy tab.
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
