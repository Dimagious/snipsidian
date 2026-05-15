import { test, expect } from "./fixtures";

/**
 * E2E: SnippetsTab Add Snippet flow.
 *
 * Verifies the whole add-snippet round-trip with a real plugin
 * instance: open Settings, click "Add snippet" in the toolbar,
 * fill out the modal, submit, expand the group, and confirm the
 * snippet is visible in the list.
 *
 * Selectors come straight from the aria-labels we added in 1.0.x /
 * 1.1.x for accessibility (so the recording session that produced
 * this scenario also gave us stable handles for free).
 */

test.describe("settings: Add snippet flow", () => {
    test("adds a new snippet via the Add snippet modal and shows it in the list", async ({
        win,
    }) => {
        // Open Settings → Snipsy tab via Obsidian's internal API.
        // Avoids guessing at sidebar selectors / re-typing the
        // plugin name in the search input.
        await win.evaluate(() => {
            const a = (globalThis as unknown as {
                app?: {
                    setting?: {
                        open?: () => void;
                        openTabById?: (id: string) => void;
                    };
                };
            }).app;
            a?.setting?.open?.();
            a?.setting?.openTabById?.("snipsidian");
        });

        // Toolbar "Add snippet" button. It's the first such button
        // on the page — the second is the modal's submit button.
        const toolbarAddBtn = win
            .getByRole("button", { name: "Add snippet" })
            .first();
        await toolbarAddBtn.waitFor({ state: "visible" });
        await toolbarAddBtn.click();

        // Modal opens with two text inputs (the placeholder text is
        // their accessible name in Obsidian's Setting() pattern).
        const triggerInput = win.getByRole("textbox", {
            name: "Example: :hello",
        });
        const replacementInput = win.getByRole("textbox", {
            name: "Example: hello, world!",
        });
        await triggerInput.fill("e2etest");
        await replacementInput.fill("end-to-end works");

        // Submit. The modal's confirm button is also named "Add
        // snippet" — by position it's the second occurrence.
        await win
            .getByRole("button", { name: "Add snippet" })
            .nth(1)
            .click();

        // After the modal closes, the new entry should be present
        // in the snippet collection. Verify via Obsidian's API (the
        // ground truth) rather than scraping the DOM — the row may
        // not be rendered yet if the user's Ungrouped group is
        // collapsed.
        const stored = await win.evaluate(() => {
            const p = (globalThis as unknown as {
                app?: { plugins?: { plugins?: { snipsidian?: { settings?: { snippets?: Record<string, string> } } } } };
            }).app?.plugins?.plugins?.snipsidian?.settings?.snippets ?? {};
            return p.e2etest;
        });
        expect(stored).toBe("end-to-end works");

        // Also verify the row renders in the UI when the Ungrouped
        // group is expanded — proves the SnippetsTab re-render hit
        // after save.
        const expandUngrouped = win.getByRole("button", {
            name: "Expand group Ungrouped",
        });
        if (await expandUngrouped.isVisible().catch(() => false)) {
            await expandUngrouped.click();
        }
        const triggerCell = win.locator(".snippet-trigger", {
            hasText: "e2etest",
        });
        await expect(triggerCell).toBeVisible();
    });

    test("filter input narrows the snippet list", async ({ win }) => {
        // The pristine vault seeds `brb` / `h1` / `callout` snippets
        // (see data.json in e2e-vault.pristine). Typing "brb" into
        // the toolbar filter should leave one row.
        await win.evaluate(() => {
            const a = (globalThis as unknown as {
                app?: { setting?: { open?: () => void; openTabById?: (id: string) => void } };
            }).app;
            a?.setting?.open?.();
            a?.setting?.openTabById?.("snipsidian");
        });

        const filter = win.getByRole("textbox", { name: "Filter snippets" });
        await filter.waitFor({ state: "visible" });
        await filter.fill("brb");

        // The result-count badge (B-099) should surface "1 of N".
        // We don't assert the exact total to keep the test stable
        // if the seed list grows.
        const countBadge = win.locator(".snipsy-filter-count");
        await expect(countBadge).toBeVisible();
        await expect(countBadge).toContainText("1 of");
    });
});
