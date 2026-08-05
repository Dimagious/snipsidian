// @vitest-environment jsdom

import { describe, it, expect, beforeAll } from "vitest";
import { installObsidianDomHelpers } from "../../test/dom-polyfill";
import { makeMockPlugin } from "../../test/factories/plugin";
import { SnipSidianSettingTab } from "./SettingsTab";
import type { App } from "obsidian";
import type SnipSidianPlugin from "../../main";

/**
 * Scorecard parity (0.4.1) — `obsidianmd/settings-tab/prefer-setting-
 * definitions` now requires a `getSettingDefinitions()` method on every
 * `PluginSettingTab` subclass. These tests pin the deliberate design
 * decision documented on the method itself (see SettingsTab.ts):
 *
 *   - The rule is satisfied by presence alone, so we implement the
 *     method but return `[]` rather than real per-field definitions.
 *   - A non-empty return would make Obsidian 1.13+ stop calling
 *     `display()` entirely (per `SettingTab#display()`'s own doc:
 *     "Not called when getSettingDefinitions returns a non-empty
 *     array") — and `display()` is what mounts this plugin's whole
 *     custom tab-strip (Snippets / Packages / General / About), not
 *     just the General tab's scalar fields. Shipping real definitions
 *     for General alone would silently delete the other three tabs
 *     for anyone on Obsidian 1.13+.
 *
 * If a future change moves toward real declarative definitions, these
 * tests are the tripwire: the "returns []" test needs a conscious
 * update, and the "display() still renders all four tabs" test proves
 * whatever replaces it hasn't broken the tab strip.
 */

beforeAll(() => {
    installObsidianDomHelpers();
});

function mount(): { tab: SnipSidianSettingTab; containerEl: HTMLElement } {
    const mockPlugin = makeMockPlugin({ settings: { snippets: {} } });
    const app = mockPlugin.app as unknown as App;
    const plugin = mockPlugin as unknown as SnipSidianPlugin;
    const tab = new SnipSidianSettingTab(app, plugin);
    const containerEl = document.createElement("div");
    document.body.appendChild(containerEl);
    // The `obsidian` module is aliased to a lightweight test stub
    // (`PluginSettingTab` there is an empty class) — unlike the real
    // Obsidian runtime, it never sets `containerEl` for us, so mount
    // tests wire it up manually before calling `display()`.
    tab.containerEl = containerEl;
    return { tab, containerEl };
}

describe("SnipSidianSettingTab.getSettingDefinitions (scorecard 0.4.1 parity)", () => {
    it("implements getSettingDefinitions() as a real method (satisfies prefer-setting-definitions)", () => {
        const { tab } = mount();
        expect(typeof tab.getSettingDefinitions).toBe("function");
    });

    it("returns an empty array — deliberate stub, not real per-field definitions", () => {
        const { tab } = mount();
        expect(tab.getSettingDefinitions()).toEqual([]);
    });

    it("calling getSettingDefinitions() does not itself touch the DOM or plugin settings", () => {
        const { tab } = mount();
        const before = JSON.stringify(tab.plugin.settings);
        tab.getSettingDefinitions();
        expect(JSON.stringify(tab.plugin.settings)).toBe(before);
    });

    it("display() still renders all four tab-strip entries in order after getSettingDefinitions() has been called", () => {
        const { tab, containerEl } = mount();
        // Obsidian calls getSettingDefinitions() once for search
        // indexing before ever calling display() — simulate that
        // ordering here.
        tab.getSettingDefinitions();
        tab.display();
        const labels = Array.from(containerEl.querySelectorAll(".snipsy-tab")).map(
            (el) => el.textContent,
        );
        expect(labels).toEqual(["Snippets", "Packages", "General", "About"]);
    });

    it("display() renders a tabpanel so at least one sub-tab's content is mounted", () => {
        const { tab, containerEl } = mount();
        tab.display();
        expect(containerEl.querySelector(".snipsy-tab-content")).not.toBeNull();
        // Default landing tab is "snippets" (see TABS[0] / uiState default).
        expect(containerEl.querySelector('[id="snipsy-panel-snippets"]')).not.toBeNull();
    });
});
