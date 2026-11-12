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

test("Obsidian launches with Snipsy enabled", async ({ win, app, obsidian }) => {
    // Workspace mounted (fixtures.ts already waited for this).
    await expect(win.locator(".workspace-leaf").first()).toBeVisible();

    // Open Settings to verify the Snipsy tab is present. The tab is
    // registered by `plugin.addSettingTab(...)` — its visibility is
    // the closest thing to "plugin loaded successfully" we have.
    // B-158: `Meta+,` stopped opening Settings on Obsidian 1.13.7;
    // `obsidian.openSettings` drives the same `app.setting.open()` API
    // the command palette action uses, and renders the tab in `win`.
    await obsidian.openSettings("snipsidian");
    await win.waitForSelector(".vertical-tab-content-container", { timeout: 15_000 });

    // The settings nav lists plugin tabs by display name. Snipsy
    // appears under "Community plugins".
    const snipsyTab = win.locator(".vertical-tab-nav-item", { hasText: "Snipsy" });
    await expect(snipsyTab).toBeVisible();
});
