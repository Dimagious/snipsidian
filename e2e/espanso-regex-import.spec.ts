import { test, expect, type SnipsyApp } from "./fixtures";
import type { ObsidianHelpers } from "obsidian-plugin-dev-kit/e2e";
import type { Page } from "@playwright/test";

/**
 * E2E (ADR-0008, Espanso regex import; NOT run by the maker: it needs a real Obsidian window): a `regex:` entry of an
 * Espanso file becomes a pattern rule.
 *
 * Contract pinned here:
 *   - the Packages page import preview lists the rule in its own "Pattern rules" section, and Apply stores it;
 *   - typing the matched text in a note gives the replacement (an instant rule, named group `{{word}}`);
 *   - the Patterns page lists the imported rule in the import's group.
 */

const PLUGIN_ID = "snipsidian";

const YAML = String.raw`matches:
  - trigger: ":zzdemo"
    replace: "demo text"
  - regex: ':(?P<word>\w+):'
    replace: "[{{word}}]"
`;

type StoredRule = { source: string; replacement: string; mode: string; group?: string; enabled: boolean };

async function readPatterns(obsidian: ObsidianHelpers): Promise<StoredRule[]> {
    return await obsidian.evaluate((app: SnipsyApp, id: string) => {
        const settings = app.plugins.plugins[id]?.settings as { patterns?: StoredRule[] } | undefined;
        return (settings?.patterns ?? []).map((p) => ({ source: p.source, replacement: p.replacement, mode: p.mode, group: p.group, enabled: p.enabled }));
    }, PLUGIN_ID);
}

/** The settings page `name`: a page entry on Obsidian 1.13+, a tab below it. */
async function openPage(win: Page, name: string): Promise<void> {
    const tab = win.getByRole("tab", { name });
    if (await tab.isVisible().catch(() => false)) await tab.click();
    else await win.locator(".setting-item.mod-navigable", { hasText: name }).first().click();
}

test.describe("[ADR-0008] Espanso regex import", () => {
    test("a regex entry imports as a pattern rule, fires when typed, and shows on the Patterns page", async ({ win, obsidian }) => {
        await obsidian.editor().clear();
        await obsidian.openSettings("snipsidian");
        await openPage(win, "Packages");

        const group = win.locator(".setting-group:has(.snipsy-espanso-section)");
        await group.scrollIntoViewIfNeeded();
        await group.getByLabel("Group name for the imported snippets").fill("Regex pack");
        await group.getByLabel("Espanso YAML to import").fill(YAML);
        await group.getByRole("button", { name: "Import snippets" }).click();

        const preview = win.locator(".modal", { hasText: "Import from Espanso YAML" });
        await expect(preview).toBeVisible();
        await expect(preview.locator(".snipsy-espanso-patterns")).toContainText("Pattern rules");
        await expect(preview.locator(".snipsy-espanso-pattern-rows code")).toHaveText(String.raw`/:(?<word>\w+):$/`);
        await expect(preview.locator(".snipsy-espanso-pattern-rows")).toContainText("[{{word}}]");
        await preview.getByRole("button", { name: "Apply" }).click();

        await expect
            .poll(() => readPatterns(obsidian))
            .toEqual([{ source: String.raw`/:(?<word>\w+):$/`, replacement: "[{{word}}]", mode: "instant", group: "regex-pack", enabled: true }]);

        // The Patterns page lists the imported rule.
        await obsidian.closeSettings();
        await obsidian.openSettings("snipsidian");
        await openPage(win, "Patterns");
        const rows = win.locator(".snipsy-pattern-row");
        await expect(rows).toHaveCount(1);
        await expect(rows.first()).toContainText(String.raw`/:(?<word>\w+):$/`);
        await expect(rows.first()).toContainText("Regex Pack");

        // Typing the matched text gives the replacement.
        await obsidian.closeSettings();
        await obsidian.editor().clear();
        await obsidian.editor().type(":smile:");
        await expect.poll(() => obsidian.editor().text()).toBe("[smile]");

        // The literal snippet of the same file works as before.
        await obsidian.editor().clear();
        await obsidian.editor().type("zzdemo ");
        await expect.poll(() => obsidian.editor().text()).toBe("demo text ");
    });
});
