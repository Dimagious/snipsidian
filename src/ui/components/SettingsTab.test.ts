// @vitest-environment jsdom

import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { installObsidianDomHelpers } from "../../test/dom-polyfill";
import { makeMockPlugin } from "../../test/factories/plugin";
import { SnipSidianSettingTab } from "./SettingsTab";
import { __setRequireApiVersionResult } from "../../test/stubs/obsidian";
import type {
    App,
    SettingDefinitionAction,
    SettingDefinitionControl,
    SettingDefinitionGroup,
    SettingDefinitionItem,
    SettingDefinitionPage,
    SettingGroupItem,
} from "obsidian";
import type SnipSidianPlugin from "../../main";

/**
 * Finding #10: structural type guards for the declarative tree's
 * large union, instead of `as any` at each call site. `getSettingDefinitions()`
 * returns `SettingDefinitionItem[]` — a union of page/group/list/leaf
 * shapes discriminated by a `type`/shape check, not a single
 * discriminant property, so each guard checks the field that actually
 * distinguishes that shape (mirrors `setting-definitions.ts`'s own
 * `isControlDef`/`isActionDef`-style guards for the same union family).
 */
function isPageItem(item: SettingDefinitionItem): item is SettingDefinitionPage {
    return "type" in item && item.type === "page";
}
function isGroupItem(item: SettingDefinitionItem): item is SettingDefinitionGroup {
    return "type" in item && (item.type === "group" || item.type === "list");
}
function isControlItem(item: SettingGroupItem): item is SettingDefinitionControl {
    return "control" in item && !!item.control;
}
function isActionItem(item: SettingGroupItem): item is SettingDefinitionAction {
    return "action" in item && typeof item.action === "function";
}
function findGroup(defs: SettingDefinitionItem[], heading: string): SettingDefinitionGroup {
    const group = defs.filter(isGroupItem).find((g) => g.heading === heading);
    if (!group) throw new Error(`Group "${heading}" not found`);
    return group;
}
function findActionByName(items: SettingGroupItem[] | undefined, name: string): SettingDefinitionAction {
    const item = (items ?? []).find((i) => i.name === name);
    if (!item || !isActionItem(item)) throw new Error(`Action row "${name}" not found`);
    return item;
}

/**
 * B-151/ADR-0007: `SnipSidianSettingTab` is now version-gated —
 * `getSettingDefinitions()` returns the full declarative tree
 * (`SettingDefinitionPage` "Snippets"/"Packages" plus the General and
 * About groups) on Obsidian 1.13+, and `[]` below 1.13 so `display()`
 * (the tab-strip fallback) keeps running. This replaces the old
 * "always returns []" pin from the 0.4.1 scorecard-parity batch (PR
 * #63) — see `.claude/brain/decisions/0007-declarative-settings-
 * b151.md` for the decision and its spike report for the API
 * constraints that shaped this design.
 *
 * `requireApiVersion` is mocked in `src/test/stubs/obsidian.ts`
 * (`__setRequireApiVersionResult`); every test here sets it
 * explicitly and restores the default (`true`) in `afterEach` so
 * other test files (which never touch `SnipSidianSettingTab`) aren't
 * affected by leftover state.
 */

beforeAll(() => {
    installObsidianDomHelpers();
});

afterEach(() => {
    __setRequireApiVersionResult(true);
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

describe("SnipSidianSettingTab — version gating (B-151/ADR-0007)", () => {
    it("below 1.13: getSettingDefinitions() returns [] and display() renders the tab strip", () => {
        __setRequireApiVersionResult(false);
        const { tab, containerEl } = mount();

        expect(tab.getSettingDefinitions()).toEqual([]);

        tab.display();
        const labels = Array.from(containerEl.querySelectorAll(".snipsy-tab")).map(
            (el) => el.textContent,
        );
        expect(labels).toEqual(["Snippets", "Packages", "General", "About"]);
    });

    it("1.13+: getSettingDefinitions() returns a non-empty declarative tree", () => {
        __setRequireApiVersionResult(true);
        const { tab } = mount();

        const defs = tab.getSettingDefinitions();
        expect(defs.length).toBeGreaterThan(0);
    });

    it("calling getSettingDefinitions() does not itself touch plugin settings", () => {
        const { tab } = mount();
        const before = JSON.stringify(tab.plugin.settings);
        tab.getSettingDefinitions();
        expect(JSON.stringify(tab.plugin.settings)).toBe(before);
    });

    it("display() still renders all four tab-strip entries below 1.13, even after getSettingDefinitions() ran first", () => {
        __setRequireApiVersionResult(false);
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

    it("display() renders a tabpanel so at least one sub-tab's content is mounted, below 1.13", () => {
        __setRequireApiVersionResult(false);
        const { tab, containerEl } = mount();
        tab.display();
        expect(containerEl.querySelector(".snipsy-tab-content")).not.toBeNull();
        // Default landing tab is "snippets" (see TABS[0] / uiState default).
        expect(containerEl.querySelector('[id="snipsy-panel-snippets"]')).not.toBeNull();
    });
});

describe("SnipSidianSettingTab — declarative definition tree shape (1.13+)", () => {
    function defs(plugin?: Parameters<typeof makeMockPlugin>[0]) {
        const mockPlugin = makeMockPlugin(plugin);
        const app = mockPlugin.app as unknown as App;
        const tab = new SnipSidianSettingTab(app, mockPlugin as unknown as SnipSidianPlugin);
        tab.containerEl = document.createElement("div");
        return tab.getSettingDefinitions();
    }

    it("root items are, in order: Snippets page, Packages page, then the General and About groups", () => {
        const items = defs();
        const shape = items.map((i) => {
            if (isPageItem(i)) return { type: i.type, name: i.name, heading: undefined };
            if (isGroupItem(i)) return { type: i.type, name: undefined, heading: i.heading };
            throw new Error(`Unexpected root item shape: ${JSON.stringify(i)}`);
        });
        expect(shape).toEqual([
            { type: "page", name: "Snippets", heading: undefined },
            { type: "page", name: "Packages", heading: undefined },
            { type: "group", name: undefined, heading: "Expansion" },
            { type: "group", name: undefined, heading: "Commands" },
            { type: "group", name: undefined, heading: "Backup" },
            { type: "group", name: undefined, heading: "Defaults" },
            { type: "group", name: undefined, heading: "Feedback" },
            { type: "group", name: undefined, heading: "Resources" },
            { type: "group", name: undefined, heading: "More from the author" },
        ]);
    });

    it("the Snippets and Packages pages carry a `page` factory and a function-form displayValue", () => {
        const items = defs();
        const snippetsPage = items[0];
        const packagesPage = items[1];
        if (!snippetsPage || !isPageItem(snippetsPage)) throw new Error("Snippets page not found");
        if (!packagesPage || !isPageItem(packagesPage)) throw new Error("Packages page not found");
        expect(typeof snippetsPage.page).toBe("function");
        expect(typeof packagesPage.page).toBe("function");
        expect(typeof snippetsPage.displayValue).toBe("function");
        expect(typeof packagesPage.displayValue).toBe("function");
    });

    it("the Snippets page displayValue reflects the current snippet/group counts", () => {
        const items = defs({ settings: { snippets: { "a/x": "1", "a/y": "2", z: "3" } } });
        const snippetsPage = items[0];
        if (!snippetsPage || !isPageItem(snippetsPage) || typeof snippetsPage.displayValue !== "function") {
            throw new Error("Snippets page displayValue not found");
        }
        expect(snippetsPage.displayValue()).toBe("3 snippets in 1 group");
    });

    it("the Prefix character control is disabled while Require-a-prefix is off, and enabled when it's on", () => {
        const itemsOff = defs({ settings: { snippets: {}, expansion: { requirePrefix: false } } });
        const expansionOff = findGroup(itemsOff, "Expansion");
        const prefixCharOff = expansionOff.items?.[1];
        if (!prefixCharOff || !isControlItem(prefixCharOff) || typeof prefixCharOff.control.disabled !== "function") {
            throw new Error("Prefix character control.disabled() not found");
        }
        expect(prefixCharOff.control.disabled()).toBe(true);

        const itemsOn = defs({ settings: { snippets: {}, expansion: { requirePrefix: true } } });
        const expansionOn = findGroup(itemsOn, "Expansion");
        const prefixCharOn = expansionOn.items?.[1];
        if (!prefixCharOn || !isControlItem(prefixCharOn) || typeof prefixCharOn.control.disabled !== "function") {
            throw new Error("Prefix character control.disabled() not found");
        }
        expect(prefixCharOn.control.disabled()).toBe(false);
    });

    // Finding #5: the search-alias vocabulary shrank once the decoy
    // "Espanso hub" row was dropped — "espanso"/"package"/"catalog"
    // have no honest row to sit on any more (see
    // `about-definitions.ts`'s doc comment) and aren't asserted here.
    it("carries search aliases on the rows standing in for the page content (snippet/hotstring/trigger/import)", () => {
        const items = defs();
        const allAliases = items
            .filter(isGroupItem)
            .flatMap((group) => group.items ?? [])
            .flatMap((row) => ("aliases" in row ? (row.aliases ?? []) : []));
        for (const word of ["snippet", "hotstring", "trigger", "text expansion", "import"]) {
            expect(allAliases).toContain(word);
        }
        for (const word of ["espanso", "package", "catalog"]) {
            expect(allAliases).not.toContain(word);
        }
    });
});

describe("SnipSidianSettingTab — refreshDeclarative (finding #2)", () => {
    function updateCallsOf(tab: SnipSidianSettingTab): number {
        return (tab as unknown as { updateCalls: number }).updateCalls;
    }

    it("this.update() runs inside the requireApiVersion(1.13.0) guard, and is a no-op below 1.13", () => {
        __setRequireApiVersionResult(true);
        const { tab } = mount();
        expect(updateCallsOf(tab)).toBe(0);
        tab.refreshDeclarative();
        expect(updateCallsOf(tab)).toBe(1);

        __setRequireApiVersionResult(false);
        tab.refreshDeclarative();
        expect(updateCallsOf(tab)).toBe(1);
    });

    it("Restore default snippets calls refreshDeclarative() on the 1.13+ path", async () => {
        __setRequireApiVersionResult(true);
        const { tab } = mount();
        const restore = findActionByName(findGroup(tab.getSettingDefinitions(), "Defaults").items, "Restore default snippets");

        // The action callback is fire-and-forget (`() => void
        // handlers.restoreDefaults()`, matching how the real
        // framework invokes an `action` row) — flush the underlying
        // async write instead of awaiting the call itself.
        restore.action(document.createElement("div"), 0);
        await Promise.resolve();
        await Promise.resolve();

        expect(tab.plugin.settings.snippets).not.toEqual({});
        expect(updateCallsOf(tab)).toBe(1);
    });

    it("Restore default snippets does NOT call update() below 1.13, via the real pre-1.13 tab-strip button", async () => {
        __setRequireApiVersionResult(false);
        const { tab, containerEl } = mount();
        tab.display();

        // Land on the General tab, same as a real user click on the
        // pre-1.13 pill strip (`activateTab` in `SettingsTab.ts`).
        const generalTabBtn = Array.from(containerEl.querySelectorAll(".snipsy-tab")).find(
            (el) => el.textContent === "General",
        ) as HTMLButtonElement;
        generalTabBtn.click();

        const restoreRow = Array.from(containerEl.querySelectorAll(".setting-item")).find(
            (el) => el.querySelector(".setting-item-name")?.textContent === "Restore default snippets",
        )!;
        const restoreBtn = Array.from(restoreRow.querySelectorAll("button")).find(
            (b) => b.textContent === "Restore",
        ) as HTMLButtonElement;
        restoreBtn.click();
        await Promise.resolve();
        await Promise.resolve();

        expect(tab.plugin.settings.snippets).not.toEqual({});
        expect(updateCallsOf(tab)).toBe(0);
    });
});

describe("SnipSidianSettingTab — getControlValue/setControlValue (B-151/ADR-0007)", () => {
    it("getControlValue reads a dotted key from the nested settings object", () => {
        const mockPlugin = makeMockPlugin({ settings: { snippets: {}, expansion: { requirePrefix: true, prefixChar: ";" } } });
        const app = mockPlugin.app as unknown as App;
        const tab = new SnipSidianSettingTab(app, mockPlugin as unknown as SnipSidianPlugin);

        expect(tab.getControlValue("expansion.requirePrefix")).toBe(true);
        expect(tab.getControlValue("expansion.prefixChar")).toBe(";");
    });

    it("setControlValue writes a dotted key and persists via the plugin's save path", async () => {
        const mockPlugin = makeMockPlugin({ settings: { snippets: {} } });
        const app = mockPlugin.app as unknown as App;
        const tab = new SnipSidianSettingTab(app, mockPlugin as unknown as SnipSidianPlugin);

        await tab.setControlValue("expansion.requirePrefix", true);

        expect(mockPlugin.settings.expansion?.requirePrefix).toBe(true);
        expect(mockPlugin._saveCalls.length).toBe(1);
    });

    it("an unknown dotted key reads as undefined and writes as a no-op, rather than throwing", async () => {
        const mockPlugin = makeMockPlugin({ settings: { snippets: {} } });
        const app = mockPlugin.app as unknown as App;
        const tab = new SnipSidianSettingTab(app, mockPlugin as unknown as SnipSidianPlugin);

        expect(tab.getControlValue("nonsense.key")).toBeUndefined();
        expect(() => tab.setControlValue("nonsense.key", "x")).not.toThrow();
        expect(mockPlugin._saveCalls.length).toBe(0);
    });
});
