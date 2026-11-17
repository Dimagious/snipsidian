import { test, expect, readSnippets } from "./fixtures";
import type { AppWithInternals } from "obsidian-plugin-dev-kit/e2e";

/**
 * E2E (NOT run by the maker: needs a real Obsidian window): the Text Snippets
 * import keeps non-Latin triggers. A data.json with `прив : Привет!` is placed
 * where the other plugin keeps it, the Packages page imports it, and typing the
 * trigger plus a space in a note expands it.
 */

/** What the spec reads of the app beyond the kit's `AppWithInternals`. */
type AppWithVault = AppWithInternals & {
    vault: { configDir: string; adapter: { exists(p: string): Promise<boolean>; mkdir(p: string): Promise<void>; write(p: string, data: string): Promise<void> } };
};

test.describe("Text Snippets import: Unicode triggers", () => {
    test("`прив : Привет!` is imported and expands as you type", async ({ win, obsidian }) => {
        await obsidian.evaluate(async (app: AppWithVault, data: string) => {
            const dir = `${app.vault.configDir}/plugins/text-snippets-obsidian`;
            if (!(await app.vault.adapter.exists(dir))) await app.vault.adapter.mkdir(dir);
            await app.vault.adapter.write(`${dir}/data.json`, data);
        }, JSON.stringify({ snippets_file: "прив : Привет!\nx\u{1F600} : smile" }));

        await obsidian.openSettings("snipsidian");
        await win.locator(".setting-item.mod-navigable", { hasText: "Packages" }).first().click();
        await win.getByRole("button", { name: "Import snippets from the Text Snippets plugin" }).click();

        const preview = win.locator(".modal", { hasText: "Import from Text Snippets" }).last();
        await expect(preview).toBeVisible();
        // The emoji trigger is named as skipped, the Cyrillic one is not.
        await expect(preview).toContainText("1 skipped");
        await preview.getByRole("button", { name: "Apply" }).click();

        await expect.poll(async () => (await readSnippets(obsidian))["text-snippets/прив"]).toBe("Привет!");

        await obsidian.closeSettings();
        await obsidian.editor().clear();
        await obsidian.editor().type("прив ");
        expect(await obsidian.editor().text()).toBe("Привет! ");
    });
});
