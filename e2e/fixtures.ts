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

    /** The trigger of the picker row Enter would insert (the row with `aria-selected="true"`). The picker filters
     *  after a 200 ms debounce and selects the first row again after each render, so an assertion on this locator
     *  is the wait for "the filter was applied" before Enter. */
    pickerSelectedTrigger(win: Page): Locator {
        return win.locator(".snippet-picker-modal .snippet-item[aria-selected='true'] .snippet-name");
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
