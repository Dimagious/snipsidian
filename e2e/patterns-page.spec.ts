import { test, expect, type SnipsyApp } from "./fixtures";
import type { ObsidianHelpers } from "obsidian-plugin-dev-kit/e2e";
import type { Page } from "@playwright/test";

/**
 * E2E (ADR-0008, Patterns page; NOT run by the maker: it needs a real Obsidian window): the Patterns page of the
 * settings, end to end.
 *
 * Contract pinned here:
 *   - the typography set can be added from the page, and typing `1/2 ` in a note then gives `½ `;
 *   - a rule with an invalid pattern shows its error under the field and cannot be saved;
 *   - Try it explains early firing for an Instant `1/2` rule (`1/23` gives `½3`).
 *
 * The page is a declarative page on Obsidian 1.13+ (one click deep) and a fourth tab below it; `openPatternsPage`
 * covers both, like `ui.openSnippetsPage` does for Snippets.
 */

const PLUGIN_ID = "snipsidian";

async function openPatternsPage(win: Page, obsidian: ObsidianHelpers): Promise<void> {
    await obsidian.openSettings("snipsidian");
    const addRule = win.getByRole("button", { name: "Add rule" }).first();
    if (await addRule.isVisible().catch(() => false)) return;
    const tab = win.getByRole("tab", { name: "Patterns" });
    if (await tab.isVisible().catch(() => false)) await tab.click();
    else await win.locator(".setting-item.mod-navigable", { hasText: "Patterns" }).first().click();
    await addRule.waitFor({ state: "visible", timeout: 10_000 });
}

async function readPatterns(obsidian: ObsidianHelpers): Promise<Array<{ source: string; replacement: string; mode: string }>> {
    return await obsidian.evaluate((app: SnipsyApp, id: string) => {
        const settings = app.plugins.plugins[id]?.settings as { patterns?: Array<{ source: string; replacement: string; mode: string }> } | undefined;
        return (settings?.patterns ?? []).map((p) => ({ source: p.source, replacement: p.replacement, mode: p.mode }));
    }, PLUGIN_ID);
}

test.describe("[ADR-0008] Patterns page", () => {
    test("adds the typography set from the empty state, and typing 1/2 then a space gives a half", async ({ win, obsidian }) => {
        await obsidian.editor().clear();
        await openPatternsPage(win, obsidian);

        await expect(win.getByText("No pattern rules yet.")).toBeVisible();
        await win.getByRole("button", { name: "Add typography set" }).click();
        await expect(win.locator(".snipsy-pattern-row")).toHaveCount(32);
        expect(await readPatterns(obsidian)).toHaveLength(32);

        await obsidian.closeSettings();
        await obsidian.editor().type("1/2 ");
        await expect.poll(() => obsidian.editor().text()).toBe("½ ");
    });

    test("an invalid pattern shows its error under the field and Save stays disabled", async ({ win, obsidian }) => {
        await openPatternsPage(win, obsidian);

        await win.getByRole("button", { name: "Add rule" }).click();
        const pattern = win.getByLabel("Pattern", { exact: true });
        await pattern.fill("/a$/g");
        const error = win.locator(".snipsy-pattern-editor .snipsidian-error").first();
        await expect(error).toHaveText("Flag g isn't allowed. Use i or none.");
        await expect(pattern).toHaveAttribute("aria-invalid", "true");
        const save = win.locator(".snipsy-pattern-editor").getByRole("button", { name: "Save", exact: true });
        await expect(save).toBeDisabled();
        expect(await readPatterns(obsidian)).toHaveLength(0);

        // A good pattern clears the error and enables Save.
        await pattern.fill("/a$/i");
        await expect(error).toHaveText("");
        await expect(save).toBeEnabled();
    });

    test("Try it says an Instant 1/2 rule fires early on 1/23, and After a separator lets it finish", async ({ win, obsidian }) => {
        await openPatternsPage(win, obsidian);

        await win.getByRole("button", { name: "Add rule" }).click();
        await win.getByLabel("Pattern", { exact: true }).fill("/1\\/2$/");
        await win.getByLabel("Replacement", { exact: true }).fill("½");
        await win.getByLabel("Try it", { exact: true }).fill("1/23");

        const result = win.locator(".snipsy-tryit-result");
        const status = win.locator(".snipsy-tryit-status");
        await expect(result).toHaveText("½3");
        await expect(status).toHaveText("Fired at 1/2, before 3. To type 1/23, choose After a separator.");

        await win.getByLabel("Fires", { exact: true }).selectOption("separator");
        await expect(result).toHaveText("1/23");
        await expect(status).toHaveText("No match.");
    });
});
