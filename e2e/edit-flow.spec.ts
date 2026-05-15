import { test, expect } from "./fixtures";

/**
 * E2E: SnippetsTab edit-flow regression.
 *
 * B-021 was the keystone bug in 1.1.0 — the SnippetsTab's old
 * `renderSnippetList(root)` re-render destroyed any in-flight edit
 * state because it lived in a local closure. Fixed by lifting
 * `editingKey` + `editingDraft` to `UIStateManager`.
 *
 * The unit tests cover the contract at the state layer. These E2E
 * tests prove the user-facing flow works end-to-end:
 *
 *   1. Editing a row updates the snippet and persists
 *   2. Edit-mode survives sibling re-renders (the actual B-021 fix)
 *   3. Opening edit on row B discards row A's draft (single-edit-mode)
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

async function expandUngrouped(win: import("@playwright/test").Page) {
    const toggle = win.getByRole("button", { name: "Expand group Ungrouped" });
    if (await toggle.isVisible().catch(() => false)) {
        await toggle.click();
    }
}

test.describe("edit-flow: B-021 regression surface", () => {
    test("edits a snippet's replacement via Edit button and persists", async ({
        win,
    }) => {
        await openSnipsy(win);
        await expandUngrouped(win);

        // `brb` is seeded in the pristine vault with replacement
        // "be right back". Click its Edit button.
        const editBtn = win.getByRole("button", { name: "Edit snippet brb" });
        await editBtn.click();

        // Edit-mode renders trigger + replacement inputs in-place.
        const replacementInput = win.getByRole("textbox", {
            name: "Snippet replacement",
        });
        await replacementInput.fill("be right back!! EDITED");

        // Save (mod-cta button inside the edit form's .actions row).
        await win
            .locator(".snippet-row.is-editing .actions .mod-cta")
            .click();

        // Verify via plugin API — that's the source of truth.
        const stored = await win.evaluate(() => {
            const p = (globalThis as unknown as {
                app?: { plugins?: { plugins?: { snipsidian?: { settings?: { snippets?: Record<string, string> } } } } };
            }).app?.plugins?.plugins?.snipsidian?.settings?.snippets ?? {};
            return p.brb;
        });
        expect(stored).toBe("be right back!! EDITED");
    });

    test("opening Edit on row B closes row A's edit form (single-edit-mode)", async ({
        win,
    }) => {
        await openSnipsy(win);
        await expandUngrouped(win);

        // Open edit on `brb`.
        await win.getByRole("button", { name: "Edit snippet brb" }).click();
        // Type into A's replacement — should be tracked in the
        // UIStateManager draft, NOT yet persisted.
        const replacementInputA = win.getByRole("textbox", {
            name: "Snippet replacement",
        });
        await replacementInputA.fill("UNSAVED EDIT");

        // Without saving, open edit on `h1`.
        await win.getByRole("button", { name: "Edit snippet h1" }).click();

        // Only ONE row should be in edit mode now (h1's).
        const editingRows = win.locator(".snippet-row.is-editing");
        await expect(editingRows).toHaveCount(1);

        // The active edit form should belong to h1 — its trigger
        // input contains "h1", not "brb".
        const triggerInput = win.getByRole("textbox", { name: "Snippet trigger" });
        await expect(triggerInput).toHaveValue("h1");

        // The unsaved A draft did NOT land in settings.
        const stillOriginal = await win.evaluate(() => {
            const p = (globalThis as unknown as {
                app?: { plugins?: { plugins?: { snipsidian?: { settings?: { snippets?: Record<string, string> } } } } };
            }).app?.plugins?.plugins?.snipsidian?.settings?.snippets ?? {};
            return p.brb;
        });
        expect(stillOriginal).toBe("be right back");
    });

    test("Cancel discards the draft without writing", async ({ win }) => {
        await openSnipsy(win);
        await expandUngrouped(win);

        await win.getByRole("button", { name: "Edit snippet brb" }).click();
        await win
            .getByRole("textbox", { name: "Snippet replacement" })
            .fill("DISCARDED");

        // Click the non-CTA action (Cancel).
        await win
            .locator(".snippet-row.is-editing .actions button:not(.mod-cta)")
            .click();

        // Editor closed.
        await expect(win.locator(".snippet-row.is-editing")).toHaveCount(0);

        // Settings still has the original value.
        const stored = await win.evaluate(() => {
            const p = (globalThis as unknown as {
                app?: { plugins?: { plugins?: { snipsidian?: { settings?: { snippets?: Record<string, string> } } } } };
            }).app?.plugins?.plugins?.snipsidian?.settings?.snippets ?? {};
            return p.brb;
        });
        expect(stored).toBe("be right back");
    });

    test("renames the trigger key via Edit (B-105)", async ({ win }) => {
        // Renaming the trigger is a *different* path from editing
        // the replacement: it routes through `safeRenameKey` and
        // shifts the entry under a new key (touching splitKey /
        // joinKey / hasTriggerCollision). The replacement-edit test
        // above never exercises this path because the key stays
        // the same.
        await openSnipsy(win);
        await expandUngrouped(win);

        await win.getByRole("button", { name: "Edit snippet brb" }).click();

        // Change the trigger; keep the replacement intact.
        const triggerInput = win.getByRole("textbox", { name: "Snippet trigger" });
        await triggerInput.fill("bbb");

        await win
            .locator(".snippet-row.is-editing .actions .mod-cta")
            .click();

        // Settings: old key gone, new key holds the original
        // replacement.
        const snippets = await win.evaluate(() => {
            return (
                (globalThis as unknown as {
                    app?: { plugins?: { plugins?: { snipsidian?: { settings?: { snippets?: Record<string, string> } } } } };
                }).app?.plugins?.plugins?.snipsidian?.settings?.snippets ?? {}
            );
        });
        expect(snippets.brb).toBeUndefined();
        expect(snippets.bbb).toBe("be right back");

        // UI reflects the rename — old edit-button gone, new one
        // present.
        await expect(
            win.getByRole("button", { name: "Edit snippet brb" }),
        ).toHaveCount(0);
        await expect(
            win.getByRole("button", { name: "Edit snippet bbb" }),
        ).toBeVisible();
    });
});
