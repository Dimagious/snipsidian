import { test, expect, ui } from "./fixtures";
import type { ElectronApplication, Page } from "@playwright/test";

/**
 * E2E: SnippetsTab delete flows.
 *
 *   - B-103: deleting a single snippet via 🗑️ → ConfirmModal →
 *     row disappears + plugin settings reflect the removal
 *   - B-104: deleting a group via group-level 🗑️ removes every
 *     snippet inside that group
 *
 * ConfirmModal ([Modals.ts:282-341]) was previously unreachable
 * from E2E — these specs pin the only delete affordance Snipsy
 * ships, and indirectly cover the "are you sure" gate so a future
 * "skip-confirm" regression is caught.
 */

// B-158: Settings can render as a separate popout window rather than
// inline in `win` (observed on Obsidian 1.13.7) — `ui.openSettings`
// resolves whichever window actually got the Snipsy tab content, and
// every UI locator below operates on that page. Data reads/writes
// still go through `win.evaluate` (`readSnippets` etc.) since
// `app`/the plugin instance are the same singleton regardless of
// which window's global scope reaches them.
async function openSnipsy(app: ElectronApplication, win: Page): Promise<Page> {
    const sw = await ui.openSettings(app, win);
    await sw
        .getByRole("button", { name: "Add snippet" })
        .first()
        .waitFor({ state: "visible" });
    return sw;
}

async function expandGroup(sw: Page, groupTitle: string) {
    const toggle = sw.getByRole("button", {
        name: `Expand group ${groupTitle}`,
    });
    if (await toggle.isVisible().catch(() => false)) {
        await toggle.click();
    }
}

/** Read the live plugin settings.snippets map. Source of truth for
 *  "did the write happen?" — the DOM lags behind on re-render. */
async function readSnippets(
    win: import("@playwright/test").Page,
): Promise<Record<string, string>> {
    return await win.evaluate(() => {
        return (
            (globalThis as unknown as {
                app?: {
                    plugins?: {
                        plugins?: {
                            snipsidian?: {
                                settings?: { snippets?: Record<string, string> };
                            };
                        };
                    };
                };
            }).app?.plugins?.plugins?.snipsidian?.settings?.snippets ?? {}
        );
    });
}

test.describe("delete flows: ConfirmModal surface", () => {
    test("deletes a single snippet via row 🗑️ + Confirm (B-103)", async ({
        win,
        app,
    }) => {
        const sw = await openSnipsy(app, win);
        await expandGroup(sw, "Ungrouped");

        // `brb` is seeded in the pristine vault. Sanity-check it's
        // present before we attempt to delete it — otherwise a
        // failing delete is indistinguishable from a missing seed.
        const before = await readSnippets(win);
        expect(before.brb).toBe("be right back");

        // Click the row's 🗑️. The button's accessible name is
        // `Delete snippet brb` (set in SnippetsTab.ts:421).
        await sw
            .getByRole("button", { name: "Delete snippet brb" })
            .click();

        // ConfirmModal opens. The body uses an `.snipsidian-modal`
        // class; the confirm button is the one with text "Delete"
        // and `.mod-cta`. Cancel is focused by default — clicking
        // Delete forces the confirmed path explicitly.
        const confirmModal = sw.locator(".snipsidian-confirm-modal");
        await expect(confirmModal).toBeVisible();
        await expect(confirmModal).toContainText('Delete snippet "brb"?');

        await confirmModal
            .getByRole("button", { name: "Delete" })
            .click();

        // Settings reflect the removal.
        const after = await readSnippets(win);
        expect(after.brb).toBeUndefined();

        // Row is gone from the UI. We assert via the absence of the
        // edit-button (whose `aria-label` is keyed on the trigger
        // name) — `.snippet-trigger` is too broad and would match
        // by-substring.
        await expect(
            sw.getByRole("button", { name: "Edit snippet brb" }),
        ).toHaveCount(0);
    });

    test("Cancel keeps the snippet (B-103 regression guard)", async ({
        win,
        app,
    }) => {
        // Without this test, a future change that always-confirms
        // (skipping the modal click) would still pass the
        // happy-path delete test. This pins the Cancel half.
        const sw = await openSnipsy(app, win);
        await expandGroup(sw, "Ungrouped");

        await sw
            .getByRole("button", { name: "Delete snippet brb" })
            .click();
        const confirmModal = sw.locator(".snipsidian-confirm-modal");
        await expect(confirmModal).toBeVisible();

        // Cancel by name — `:not(.mod-cta)` used to be unique to it,
        // but the redesign's `danger: true` confirm maps Delete to
        // `mod-warning` instead of `mod-cta` (ConfirmModal.ts), so
        // both footer buttons now match `:not(.mod-cta)`.
        await confirmModal.getByRole("button", { name: "Cancel" }).click();

        const after = await readSnippets(win);
        expect(after.brb).toBe("be right back");
    });

    test("deletes an entire group via group 🗑️ (B-104)", async ({ win, app }) => {
        // Seed a fresh named group with two snippets, then delete
        // the group. Using a fresh group keeps the test
        // independent of the seed's exact contents AND verifies
        // the group-delete path (which differs from row-delete:
        // iterates `items` and deletes each key).
        await win.evaluate(async () => {
            const plugin = (globalThis as unknown as {
                app?: {
                    plugins?: {
                        plugins?: {
                            snipsidian?: {
                                settings?: { snippets?: Record<string, string> };
                                saveSettings?: () => Promise<void>;
                            };
                        };
                    };
                };
            }).app?.plugins?.plugins?.snipsidian;
            if (!plugin?.settings?.snippets) return;
            plugin.settings.snippets["test-group/alpha"] = "alpha replacement";
            plugin.settings.snippets["test-group/beta"] = "beta replacement";
            await plugin.saveSettings?.();
        });

        const sw = await openSnipsy(app, win);
        // The group title is the display form — `slugifyGroup`
        // produces the same slug for `"test-group"`, and
        // `displayGroupTitle` reconstructs `"Test group"` per the
        // store/utils convention.
        // `displayGroupTitle("test-group")` Title-Cases every word
        // (services/utils.ts:68-75), so the visible label is
        // "Test Group", not "Test group".
        const groupTitle = "Test Group";

        // Group is visible in the tree.
        await expect(
            sw.getByRole("button", { name: `Expand group ${groupTitle}` }),
        ).toBeVisible();

        // Click the group's 🗑️. Aria-label set in SnippetsTab.ts:339.
        await sw
            .getByRole("button", { name: `Delete group ${groupTitle}` })
            .click();

        // Confirm modal's body previews the snippet count + the
        // first 5 trigger names. Copy last changed in B-053 (1.1.7);
        // `.snipsidian-confirm-modal` is the content element — the
        // title lives in a sibling `titleEl`, not checked here.
        const confirmModal = sw.locator(".snipsidian-confirm-modal");
        await expect(confirmModal).toBeVisible();
        await expect(confirmModal).toContainText(
            `Delete 2 snippets from "${groupTitle}": alpha, beta.`,
        );

        await confirmModal
            .getByRole("button", { name: "Delete" })
            .click();

        // Both keys gone from settings.
        const after = await readSnippets(win);
        expect(after["test-group/alpha"]).toBeUndefined();
        expect(after["test-group/beta"]).toBeUndefined();

        // Group header no longer renders.
        await expect(
            sw.getByRole("button", { name: `Expand group ${groupTitle}` }),
        ).toHaveCount(0);
    });
});
