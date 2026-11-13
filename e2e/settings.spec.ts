import { test, expect, ui, readSnippets } from "./fixtures";
import type { ObsidianHelpers } from "obsidian-plugin-dev-kit/e2e";
import type { Page } from "@playwright/test";

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
 *
 * B-158: Obsidian 1.13 can open Settings as a separate popout window.
 * The kit's fixture sets `settingsPopoutWindow: false` in the vault, so
 * `obsidian.openSettings` renders Settings inside `win` and every UI
 * locator below runs there. Data reads still go through `win.evaluate`.
 */

test.describe("settings: Add snippet flow", () => {
    test("adds a new snippet via the Add snippet modal and shows it in the list", async ({
        win,
        app,
        obsidian,
    }) => {
        // Open Settings → Snipsy tab via Obsidian's internal API.
        // Avoids guessing at sidebar selectors / re-typing the
        // plugin name in the search input.
        await obsidian.openSettings("snipsidian");
        // B-151/ADR-0007: "Snippets" is a page entry one click deep on
        // Obsidian 1.13+ (a no-op below 1.13, where it is the default
        // landing tab already).
        await ui.openSnippetsPage(win);

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
            name: "Example: brb",
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
        const stored = (await readSnippets(obsidian)).e2etest;
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

    test("filter input narrows the snippet list", async ({ win, obsidian }) => {
        // The pristine vault seeds `brb` / `h1` / `callout` snippets
        // (see data.json in e2e-vault.pristine). Typing "brb" into
        // the toolbar filter should leave one row.
        await obsidian.openSettings("snipsidian");
        // B-151/ADR-0007: "Snippets" is a page entry one click deep on
        // Obsidian 1.13+ (a no-op below 1.13, where it is the default
        // landing tab already).
        await ui.openSnippetsPage(win);

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

test.describe("settings: Add snippet validation (B-107)", () => {
    async function openAddSnippetModal(
        obsidian: ObsidianHelpers,
        win: Page,
    ): Promise<void> {
        await obsidian.openSettings("snipsidian");
        // B-151/ADR-0007: "Snippets" is a page entry one click deep on
        // Obsidian 1.13+ (a no-op below 1.13, where it is the default
        // landing tab already).
        await ui.openSnippetsPage(win);
        await win
            .getByRole("button", { name: "Add snippet" })
            .first()
            .click();
        await win
            .getByRole("textbox", { name: "Example: brb" })
            .waitFor({ state: "visible" });
    }

    test("blocks submit when replacement is empty (in-modal error)", async ({
        win,
        obsidian,
    }) => {
        await openAddSnippetModal(obsidian, win);

        // Fill trigger but leave replacement empty.
        await win
            .getByRole("textbox", { name: "Example: brb" })
            .fill("e2e-empty");

        // Submit (second "Add snippet" button — the modal's CTA).
        await win.getByRole("button", { name: "Add snippet" }).nth(1).click();

        // Modal stays open and shows the in-line error.
        const err = win.locator(".snipsidian-modal .snipsidian-error");
        await expect(err).toBeVisible();
        await expect(err).toContainText("required");

        // Settings unchanged.
        const after = await readSnippets(obsidian);
        expect(after["e2e-empty"]).toBeUndefined();
    });

    test("blocks submit when group slugifies to empty", async ({ win, obsidian }) => {
        await openAddSnippetModal(obsidian, win);

        await win
            .getByRole("textbox", { name: "Example: brb" })
            .fill("e2e-badgroup");
        await win
            .getByRole("textbox", { name: "Example: hello, world!" })
            .fill("ok");
        // `!!!` slugifies to "" — AddSnippetModal rejects this
        // explicitly so a non-empty group can't silently route into
        // Ungrouped (B-022 territory).
        await win
            .getByRole("textbox", { name: "Example: greetings" })
            .fill("!!!");

        await win.getByRole("button", { name: "Add snippet" }).nth(1).click();

        const err = win.locator(".snipsidian-modal .snipsidian-error");
        await expect(err).toBeVisible();
        await expect(err).toContainText("letter or number");

        const after = await readSnippets(obsidian);
        expect(after["e2e-badgroup"]).toBeUndefined();
    });

    test("rejects a duplicate trigger via an in-modal error, modal stays open (no overwrite)", async ({
        win,
        obsidian,
    }) => {
        await openAddSnippetModal(obsidian, win);

        // `brb` is seeded in the pristine vault. Trying to add it
        // again must NOT overwrite the existing replacement (B-023
        // collision territory).
        await win
            .getByRole("textbox", { name: "Example: brb" })
            .fill("brb");
        await win
            .getByRole("textbox", { name: "Example: hello, world!" })
            .fill("SHOULD NOT WIN");

        await win.getByRole("button", { name: "Add snippet" }).nth(1).click();

        // B-133: `planAddSnippet` failures (this collision included)
        // now render inline and keep the modal open, instead of
        // firing a `Notice` and closing — closing on failure used to
        // discard everything the user had typed.
        const err = win.locator(".snipsidian-modal .snipsidian-error");
        await expect(err).toBeVisible();
        await expect(err).toContainText("already exists");

        // Original replacement preserved.
        const after = await readSnippets(obsidian);
        expect(after.brb).toBe("be right back");
    });
});
