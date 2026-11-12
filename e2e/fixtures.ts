import { createObsidianTest } from "obsidian-plugin-dev-kit/e2e";
import type { Locator, Page } from "@playwright/test";

/**
 * The kit launches Obsidian's own app.asar through the project-local electron (the bundled binary rejects the
 * debugging port since the 2024 fuse change), copies `e2e-vault.pristine/` for every test, installs the built plugin
 * into the copy, trusts it and waits for it to load. The pristine copy is committed with a `data.json` that seeds
 * `brb`, `h1` and `callout`, and a `workspace.json` that opens `Welcome.md`. `OPDK_E2E_VAULT` replaces the vault for
 * a run.
 *
 * Each test gets four fixtures: `win` (the Obsidian window), `app` (the Electron app), `vault` (the per-test copy of
 * the vault) and `obsidian` (the kit's helpers: settings, commands, the editor, reload).
 */
export const { test, expect, onlyWhen } = createObsidianTest({
    seedVault: "e2e-vault.pristine",
});

/** Snipsy's own page objects. Everything generic lives in the kit's `obsidian` fixture. */
export const ui = {
    /** Locator for the active CodeMirror editor's contenteditable. */
    activeEditor(win: Page): Locator {
        return win.locator(".cm-content[contenteditable=true]").first();
    },

    /** Types `query` into the open picker's filter and waits until the filter has been applied: the list got shorter
     *  than the unfiltered one and the row Enter would insert (`aria-selected="true"`) shows `trigger`. The picker
     *  filters after a 200 ms debounce, so before that the full list is still on screen, and its first row can
     *  already be the wanted trigger: the row count is what tells the two states apart. Call it on an unfiltered
     *  picker. */
    async fillPickerFilter(win: Page, query: string, trigger: string): Promise<void> {
        const rows = win.locator(".snippet-picker-modal .snippet-item");
        const unfiltered = await rows.count();
        expect(unfiltered, "fillPickerFilter needs the picker's full list on screen").toBeGreaterThan(0);
        await win.locator(".snippet-picker-modal input[role='combobox']").fill(query);
        await expect
            .poll(() => rows.count(), {
                message: `picker list did not shrink for "${query}": does it match every row, or was the picker already filtered?`,
            })
            .toBeLessThan(unfiltered);
        await expect(
            win.locator(".snippet-picker-modal .snippet-item[aria-selected='true'] .snippet-name"),
        ).toHaveText(trigger);
    },

    /** Navigates to the Snippets page content, regardless of whether
     *  Settings rendered the pre-1.13 tab strip (Snippets is the
     *  default landing tab there — `TABS[0]` in `SettingsTab.ts`) or
     *  the 1.13+ declarative root, where "Snippets" is a
     *  `SettingDefinitionPage` entry one click deeper (B-151/
     *  ADR-0007). Idempotent — a no-op when the toolbar is already
     *  visible, so callers can call this unconditionally after
     *  `obsidian.openSettings("snipsidian")`.
     *
     *  The 1.13+ page entry is a `.setting-item.mod-navigable` row
     *  with no ARIA `role` (verified against the real 1.13.7 DOM via
     *  the obsidian-probe approach) — not a `<button>` — so it's
     *  targeted by its row class + text rather than `getByRole`. */
    async openSnippetsPage(win: Page): Promise<void> {
        const toolbar = win.getByRole("button", { name: "Add snippet" }).first();
        if (await toolbar.isVisible().catch(() => false)) return;
        await win
            .locator(".setting-item.mod-navigable", { hasText: "Snippets" })
            .first()
            .click();
        await toolbar.waitFor({ state: "visible", timeout: 10_000 });
    },
};
