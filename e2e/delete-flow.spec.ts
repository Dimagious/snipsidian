import { test, expect } from "./fixtures";

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

async function openSnipsy(win: import("@playwright/test").Page) {
    await win.evaluate(() => {
        const a = (globalThis as unknown as {
            app?: { setting?: { open?: () => void; openTabById?: (id: string) => void } };
        }).app;
        a?.setting?.open?.();
        a?.setting?.openTabById?.("snipsidian");
    });
    await win
        .getByRole("button", { name: "Add snippet" })
        .first()
        .waitFor({ state: "visible" });
}

async function expandGroup(
    win: import("@playwright/test").Page,
    groupTitle: string,
) {
    const toggle = win.getByRole("button", {
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
    }) => {
        await openSnipsy(win);
        await expandGroup(win, "Ungrouped");

        // `brb` is seeded in the pristine vault. Sanity-check it's
        // present before we attempt to delete it — otherwise a
        // failing delete is indistinguishable from a missing seed.
        const before = await readSnippets(win);
        expect(before.brb).toBe("be right back");

        // Click the row's 🗑️. The button's accessible name is
        // `Delete snippet brb` (set in SnippetsTab.ts:421).
        await win
            .getByRole("button", { name: "Delete snippet brb" })
            .click();

        // ConfirmModal opens. The body uses an `.snipsidian-modal`
        // class; the confirm button is the one with text "Delete"
        // and `.mod-cta`. Cancel is focused by default — clicking
        // Delete forces the confirmed path explicitly.
        const confirmModal = win.locator(".snipsidian-confirm-modal");
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
            win.getByRole("button", { name: "Edit snippet brb" }),
        ).toHaveCount(0);
    });

    test("Cancel keeps the snippet (B-103 regression guard)", async ({
        win,
    }) => {
        // Without this test, a future change that always-confirms
        // (skipping the modal click) would still pass the
        // happy-path delete test. This pins the Cancel half.
        await openSnipsy(win);
        await expandGroup(win, "Ungrouped");

        await win
            .getByRole("button", { name: "Delete snippet brb" })
            .click();
        const confirmModal = win.locator(".snipsidian-confirm-modal");
        await expect(confirmModal).toBeVisible();

        // Cancel is the non-CTA button in the footer.
        await confirmModal
            .locator(".modal-button-container button:not(.mod-cta)")
            .click();

        const after = await readSnippets(win);
        expect(after.brb).toBe("be right back");
    });

    test("deletes an entire group via group 🗑️ (B-104)", async ({ win }) => {
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

        await openSnipsy(win);
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
            win.getByRole("button", { name: `Expand group ${groupTitle}` }),
        ).toBeVisible();

        // Click the group's 🗑️. Aria-label set in SnippetsTab.ts:339.
        await win
            .getByRole("button", { name: `Delete group ${groupTitle}` })
            .click();

        // Confirm modal mentions the snippet count.
        const confirmModal = win.locator(".snipsidian-confirm-modal");
        await expect(confirmModal).toBeVisible();
        await expect(confirmModal).toContainText(
            `Delete group "${groupTitle}" with 2 snippet(s)?`,
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
            win.getByRole("button", { name: `Expand group ${groupTitle}` }),
        ).toHaveCount(0);
    });
});
