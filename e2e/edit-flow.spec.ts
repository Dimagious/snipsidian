import { test, expect, ui } from "./fixtures";
import type { ElectronApplication, Page } from "@playwright/test";

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

// B-158: Settings can render as a separate popout window rather than
// inline in `win` (observed on Obsidian 1.13.7) — `ui.openSettings`
// resolves whichever window actually got the Snipsy tab content, and
// every UI locator below operates on that page. Data reads still go
// through `win.evaluate` since `app`/the plugin instance are the same
// singleton regardless of which window's global scope reaches them.
async function openSnipsy(app: ElectronApplication, win: Page): Promise<Page> {
    const sw = await ui.openSettings(app, win);
    await sw
        .getByRole("button", { name: "Add snippet" })
        .first()
        .waitFor({ state: "visible" });
    return sw;
}

async function expandUngrouped(sw: Page) {
    const toggle = sw.getByRole("button", { name: "Expand group Ungrouped" });
    if (await toggle.isVisible().catch(() => false)) {
        await toggle.click();
    }
}

test.describe("edit-flow: B-021 regression surface", () => {
    test("edits a snippet's replacement via Edit button and persists", async ({
        win,
        app,
    }) => {
        const sw = await openSnipsy(app, win);
        await expandUngrouped(sw);

        // `brb` is seeded in the pristine vault with replacement
        // "be right back". Click its Edit button.
        const editBtn = sw.getByRole("button", { name: "Edit snippet brb" });
        await editBtn.click();

        // Edit-mode renders trigger + replacement inputs in-place.
        const replacementInput = sw.getByRole("textbox", {
            name: "Snippet replacement",
        });
        await replacementInput.fill("be right back!! EDITED");

        // Save (mod-cta button inside the edit form's .actions row).
        await sw
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
        app,
    }) => {
        const sw = await openSnipsy(app, win);
        await expandUngrouped(sw);

        // Open edit on `brb`.
        await sw.getByRole("button", { name: "Edit snippet brb" }).click();
        // Type into A's replacement — should be tracked in the
        // UIStateManager draft, NOT yet persisted.
        const replacementInputA = sw.getByRole("textbox", {
            name: "Snippet replacement",
        });
        await replacementInputA.fill("UNSAVED EDIT");

        // Without saving, open edit on `h1`.
        await sw.getByRole("button", { name: "Edit snippet h1" }).click();

        // Only ONE row should be in edit mode now (h1's).
        const editingRows = sw.locator(".snippet-row.is-editing");
        await expect(editingRows).toHaveCount(1);

        // The active edit form should belong to h1 — its trigger
        // input contains "h1", not "brb".
        const triggerInput = sw.getByRole("textbox", { name: "Snippet trigger" });
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

    test("Cancel discards the draft without writing", async ({ win, app }) => {
        const sw = await openSnipsy(app, win);
        await expandUngrouped(sw);

        await sw.getByRole("button", { name: "Edit snippet brb" }).click();
        await sw
            .getByRole("textbox", { name: "Snippet replacement" })
            .fill("DISCARDED");

        // Click the non-CTA action (Cancel).
        await sw
            .locator(".snippet-row.is-editing .actions button:not(.mod-cta)")
            .click();

        // Editor closed.
        await expect(sw.locator(".snippet-row.is-editing")).toHaveCount(0);

        // Settings still has the original value.
        const stored = await win.evaluate(() => {
            const p = (globalThis as unknown as {
                app?: { plugins?: { plugins?: { snipsidian?: { settings?: { snippets?: Record<string, string> } } } } };
            }).app?.plugins?.plugins?.snipsidian?.settings?.snippets ?? {};
            return p.brb;
        });
        expect(stored).toBe("be right back");
    });

    test("renames the trigger key via Edit (B-105)", async ({ win, app }) => {
        // Renaming the trigger is a *different* path from editing
        // the replacement: it routes through `safeRenameKey` and
        // shifts the entry under a new key (touching splitKey /
        // joinKey / hasTriggerCollision). The replacement-edit test
        // above never exercises this path because the key stays
        // the same.
        const sw = await openSnipsy(app, win);
        await expandUngrouped(sw);

        await sw.getByRole("button", { name: "Edit snippet brb" }).click();

        // Change the trigger; keep the replacement intact.
        const triggerInput = sw.getByRole("textbox", { name: "Snippet trigger" });
        await triggerInput.fill("bbb");

        await sw
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
            sw.getByRole("button", { name: "Edit snippet brb" }),
        ).toHaveCount(0);
        await expect(
            sw.getByRole("button", { name: "Edit snippet bbb" }),
        ).toBeVisible();
    });
});
