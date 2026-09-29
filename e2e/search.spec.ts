import { test, expect, ui } from "./fixtures";

/**
 * E2E: global settings search finds Snipsy (B-151/ADR-0007).
 *
 * Before this batch, `getSettingDefinitions()` returned `[]`
 * unconditionally, so Obsidian's global "Search settings..." box
 * found nothing from Snipsy at all — searching "prefix" turned up
 * only core/other-plugin matches. This pins the fix: on the real
 * Obsidian 1.13.7 runtime, a search for "prefix" (a real row's name)
 * and for "hotstring" (an alias on the "Insert snippet" row — the
 * word doesn't appear in that row's name/desc, only in its
 * `aliases`, so a hit proves aliases are actually indexed) both
 * surface a "Snipsy" result group.
 *
 * Verified against the real DOM shape (not asserted on version, since
 * this spec's whole point is Obsidian's own search feature): a hit
 * renders `.setting-search-result-group` entries, each with a
 * `.setting-search-result-tab-label` naming the owning tab.
 */

test.describe("Settings search finds Snipsy (B-151)", () => {
    test("searching 'prefix' surfaces a Snipsy result group", async ({ win, app }) => {
        const sw = await ui.openSettings(app, win);

        const searchInput = sw.getByPlaceholder("Search settings...");
        await searchInput.waitFor({ state: "visible" });
        await searchInput.fill("prefix");
        await sw.waitForTimeout(400);

        const snipsyGroup = sw.locator(".setting-search-result-tab-label", {
            hasText: "Snipsy",
        });
        await expect(snipsyGroup).toBeVisible();
    });

    test("searching 'hotstring' (an alias, not row text) also surfaces a Snipsy result group", async ({
        win,
        app,
    }) => {
        const sw = await ui.openSettings(app, win);

        const searchInput = sw.getByPlaceholder("Search settings...");
        await searchInput.waitFor({ state: "visible" });
        await searchInput.fill("hotstring");
        await sw.waitForTimeout(400);

        const snipsyGroup = sw.locator(".setting-search-result-tab-label", {
            hasText: "Snipsy",
        });
        await expect(snipsyGroup).toBeVisible();
    });
});
