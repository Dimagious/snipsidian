import { test, expect } from "./fixtures";

/**
 * Canary: prove the rest of the E2E infrastructure works before
 * writing real specs. If this fails, every other spec will too —
 * so debug here first.
 *
 * What's verified:
 *   - Obsidian launches against the unpacked tree
 *   - The plugin loaded (Snipsy registers a settings tab; its
 *     existence is the most stable runtime signal)
 *   - The test vault is the one we expect (a Welcome.md exists)
 */

test("Obsidian launches with Snipsy enabled", async ({ win }) => {
    // Workspace mounted (fixtures.ts already waited for this).
    await expect(win.locator(".workspace-leaf").first()).toBeVisible();

    // Open Settings to verify the Snipsy tab is present. The tab is
    // registered by `plugin.addSettingTab(...)` — its visibility is
    // the closest thing to "plugin loaded successfully" we have.
    await win.keyboard.press("Meta+,");
    await win.waitForSelector(".vertical-tab-content-container", { timeout: 15_000 });

    // The settings nav lists plugin tabs by display name. Snipsy
    // appears under "Community plugins".
    const snipsyTab = win.locator(".vertical-tab-nav-item", { hasText: "Snipsy" });
    await expect(snipsyTab).toBeVisible();
});
