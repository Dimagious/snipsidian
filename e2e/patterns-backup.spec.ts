import { test, expect, type SnipsyApp } from "./fixtures";
import type { ObsidianHelpers } from "obsidian-plugin-dev-kit/e2e";
import type { Page } from "@playwright/test";

/**
 * E2E (ADR-0008, JSON backup; NOT run by the maker: it needs a real Obsidian window): the General backup carries the
 * pattern rules.
 *
 * Contract pinned here:
 *   - Export JSON writes the rules next to the snippets (the file stays a flat object of strings, so older Snipsy
 *     versions can still read it);
 *   - after the rules are wiped, Import JSON with Replace all brings them back, and the rule fires again;
 *   - the preview lists the rules in their own "Pattern rules" section.
 *
 * The desktop export clicks a blob anchor, which can open a native save dialog in Electron. The spec keeps the blob
 * (the page's `URL.createObjectURL`) and swallows the anchor click instead of waiting for a download.
 */

const PLUGIN_ID = "snipsidian";
const RULE = { id: "bk1", source: String.raw`/\bbk(\d+)$/`, replacement: "backup {{1}}", enabled: true, mode: "separator" };

async function seed(obsidian: ObsidianHelpers, patterns: unknown[] | undefined): Promise<void> {
    await obsidian.evaluate(
        async (app: SnipsyApp, arg: { id: string; patterns: unknown[] | undefined }) => {
            const plugin = app.plugins.plugins[arg.id];
            if (!plugin?.settings || !plugin.saveSettings) throw new Error(`${arg.id} plugin is not loaded`);
            Object.assign(plugin.settings, { patterns: arg.patterns, expansion: { onType: true, onTab: false } });
            await plugin.saveSettings();
        },
        { id: PLUGIN_ID, patterns },
    );
}

async function storedPatterns(obsidian: ObsidianHelpers): Promise<unknown[]> {
    return await obsidian.evaluate((app: SnipsyApp, id: string) => {
        const settings = app.plugins.plugins[id]?.settings as { patterns?: unknown[] } | undefined;
        return settings?.patterns ?? [];
    }, PLUGIN_ID);
}

/** The Backup rows: inline on the declarative root (1.13+), on the General tab below it. */
async function reachBackup(win: Page): Promise<void> {
    const row = win.locator(".setting-item", { hasText: "Export snippets" }).first();
    if (await row.isVisible().catch(() => false)) return;
    const tab = win.getByRole("tab", { name: "General" });
    if (await tab.isVisible().catch(() => false)) await tab.click();
    await row.waitFor({ state: "visible", timeout: 10_000 });
}

test.describe("[ADR-0008] JSON backup of pattern rules", () => {
    test("export, wipe, import (Replace all): the rule is back and fires", async ({ win, obsidian }) => {
        await obsidian.editor().clear();
        await seed(obsidian, [RULE]);
        await obsidian.openSettings("snipsidian");
        await reachBackup(win);

        // Keep the exported blob; no download dialog.
        await win.evaluate(() => {
            const w = window as unknown as { __snipsyBackup?: Promise<string> };
            const create = URL.createObjectURL.bind(URL);
            URL.createObjectURL = (blob: Blob | MediaSource): string => {
                if (blob instanceof Blob) w.__snipsyBackup = blob.text();
                return create(blob);
            };
            HTMLAnchorElement.prototype.click = function (): void {};
        });
        // 1.13+ renders an action row as a tappable `.setting-item.mod-action` (no <button>); click the row itself.
        const exportRow = win.locator(".setting-item", { hasText: "Export snippets" });
        await expect(exportRow).toContainText("Download your snippets and patterns as JSON.");
        await exportRow.click();
        const text = await win.evaluate(async () => await (window as unknown as { __snipsyBackup?: Promise<string> }).__snipsyBackup);
        const file = JSON.parse(text ?? "{}") as Record<string, string>;
        expect(Object.values(file).every((v) => typeof v === "string")).toBe(true);
        expect(JSON.parse(file["snipsy patterns"] ?? "[]")).toEqual([RULE]);

        // Wipe the rules.
        await seed(obsidian, undefined);
        expect(await storedPatterns(obsidian)).toEqual([]);

        // Import the file again: pick it in the file chooser the Import row opens.
        const importRow = win.locator(".setting-item", { hasText: "Import snippets" });
        // The Import row clicks a detached `<input type=file>`; hand it the file in the page instead of a native chooser.
        await win.evaluate((content: string) => {
            HTMLInputElement.prototype.click = function (this: HTMLInputElement): void {
                if (this.type !== "file") return;
                const dt = new DataTransfer();
                dt.items.add(new File([content], "backup.json", { type: "application/json" }));
                this.files = dt.files;
                this.dispatchEvent(new Event("change"));
            };
        }, text ?? "{}");
        await importRow.click();

        const modal = win.locator(".modal:not(.mod-settings)", { hasText: "Import snippets" });
        await expect(modal).toBeVisible();
        await modal.getByLabel("Replace all").check();
        await expect(modal.locator(".snipsy-import-patterns")).toContainText("Pattern rules");
        await expect(modal.locator(".snipsy-espanso-pattern-rows code")).toHaveText(RULE.source);
        await modal.getByRole("button", { name: /Replace all/ }).click();

        await expect.poll(() => storedPatterns(obsidian)).toEqual([RULE]);

        // The rule fires again.
        await obsidian.closeSettings();
        await obsidian.editor().clear();
        await obsidian.editor().type("bk7 ");
        await expect.poll(() => obsidian.editor().text()).toBe("backup 7 ");
    });
});
