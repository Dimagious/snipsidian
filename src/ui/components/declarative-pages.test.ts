import { describe, it, expect, afterEach, vi } from "vitest";
import { makeMockPlugin } from "../../test/factories/plugin";
import { __setRequireApiVersionResult } from "../../test/stubs/obsidian";
import { createDeclarativePages } from "./declarative-pages";
import { SnippetsTab } from "./SnippetsTab";
import { CommunityTab } from "./CommunityTab";
import { PatternsTab } from "./PatternsTab";
import type { App } from "obsidian";
import type SnipSidianPlugin from "../../main";

/**
 * B-151/ADR-0007: `createDeclarativePages` builds the "Snippets" and
 * "Packages" `SettingDefinitionPage` entries. These tests cover what
 * `SettingsTab.test.ts`'s structural checks don't: actually
 * constructing and mounting a page (`page()` factory → `display()`),
 * the `snipsidian-settings` CSS scope class landing on the PAGE's own
 * `containerEl` (not the tab's — the spike found the tab's
 * `containerEl` is detached while a page is open), state surviving a
 * close/reopen because both pages reuse the same `SnippetsTab`/
 * `CommunityTab` instance, and `hide()` being callable without
 * throwing.
 */

afterEach(() => {
    __setRequireApiVersionResult(true);
});

function setup() {
    const mockPlugin = makeMockPlugin({ settings: { snippets: { hello: "world" } } });
    const app = mockPlugin.app as unknown as App;
    const plugin = mockPlugin as unknown as SnipSidianPlugin;
    const snippetsTab = new SnippetsTab(app, plugin);
    const communityTab = new CommunityTab(app, plugin);
    const patternsTab = new PatternsTab(app, plugin);
    return { plugin, snippetsTab, communityTab, patternsTab };
}

describe("createDeclarativePages — version gating", () => {
    it("returns null below 1.13.0", () => {
        __setRequireApiVersionResult(false);
        const { plugin, snippetsTab, communityTab, patternsTab } = setup();
        expect(createDeclarativePages(plugin, snippetsTab, communityTab, patternsTab)).toBeNull();
    });

    it("returns Snippets and Packages page entries on 1.13+", () => {
        __setRequireApiVersionResult(true);
        const { plugin, snippetsTab, communityTab, patternsTab } = setup();
        const pages = createDeclarativePages(plugin, snippetsTab, communityTab, patternsTab);
        expect(pages).not.toBeNull();
        expect(pages!.snippets.type).toBe("page");
        expect(pages!.snippets.name).toBe("Snippets");
        expect(pages!.packages.type).toBe("page");
        expect(pages!.packages.name).toBe("Packages");
    });
});

describe("createDeclarativePages — SnippetsPage", () => {
    it("display() adds the snipsidian-settings scope class to its OWN containerEl and mounts the snippet list", () => {
        const { plugin, snippetsTab, communityTab, patternsTab } = setup();
        const pages = createDeclarativePages(plugin, snippetsTab, communityTab, patternsTab)!;

        const page = pages.snippets.page!();
        page.display();

        expect(page.containerEl.classList.contains("snipsidian-settings")).toBe(true);
        expect(page.containerEl.querySelector(".snipsy-snippet-list")).not.toBeNull();
    });

    it("hide() does not throw", () => {
        const { plugin, snippetsTab, communityTab, patternsTab } = setup();
        const pages = createDeclarativePages(plugin, snippetsTab, communityTab, patternsTab)!;
        const page = pages.snippets.page!();
        page.display();
        expect(() => page.hide()).not.toThrow();
    });

    it("reopening (a fresh page() call) restores UI state, since both share the same SnippetsTab/UIStateManager instance", () => {
        const { plugin, snippetsTab, communityTab, patternsTab } = setup();
        const pages = createDeclarativePages(plugin, snippetsTab, communityTab, patternsTab)!;

        const page1 = pages.snippets.page!();
        page1.display();
        const search = page1.containerEl.querySelector("input[type=text]") as HTMLInputElement;
        search.value = "hello";
        search.dispatchEvent(new Event("input"));
        page1.hide();

        // A brand-new SettingPage instance (as the framework builds on
        // every open, per the spike) — but the SAME snippetsTab, so its
        // UIStateManager still holds the query.
        const page2 = pages.snippets.page!();
        page2.display();
        const search2 = page2.containerEl.querySelector("input[type=text]") as HTMLInputElement;
        expect(search2.value).toBe("hello");
    });

    it("displayValue reports the live snippet/group counts, refreshed on every page() call", () => {
        const { plugin, snippetsTab, communityTab, patternsTab } = setup();
        const pages = createDeclarativePages(plugin, snippetsTab, communityTab, patternsTab)!;
        expect(pages.snippets.displayValue).not.toBeUndefined();
        const displayValue = pages.snippets.displayValue as () => string;
        // Finding #6: no "in 0 groups" claim when there are none.
        expect(displayValue()).toBe("1 snippet");

        plugin.settings.snippets["group/two"] = "second";
        expect(displayValue()).toBe("2 snippets in 1 group");
    });
});

describe("createDeclarativePages — PackagesPage", () => {
    it("display() adds the snipsidian-settings scope class to its own containerEl and mounts CommunityTab", () => {
        const { plugin, snippetsTab, communityTab, patternsTab } = setup();
        const renderSpy = vi.spyOn(communityTab, "render").mockResolvedValue(undefined);
        const pages = createDeclarativePages(plugin, snippetsTab, communityTab, patternsTab)!;

        const page = pages.packages.page!();
        page.display();

        expect(page.containerEl.classList.contains("snipsidian-settings")).toBe(true);
        expect(renderSpy).toHaveBeenCalledWith(page.containerEl);
    });

    it("hide() does not throw", () => {
        const { plugin, snippetsTab, communityTab, patternsTab } = setup();
        vi.spyOn(communityTab, "render").mockResolvedValue(undefined);
        const pages = createDeclarativePages(plugin, snippetsTab, communityTab, patternsTab)!;
        const page = pages.packages.page!();
        page.display();
        expect(() => page.hide()).not.toThrow();
    });
});

describe("createDeclarativePages — PatternsPage", () => {
    it("is named Patterns and describes what it does", () => {
        const { plugin, snippetsTab, communityTab, patternsTab } = setup();
        const pages = createDeclarativePages(plugin, snippetsTab, communityTab, patternsTab)!;
        expect(pages.patterns.name).toBe("Patterns");
        expect(pages.patterns.desc).toBe("Replace text that matches a regular expression, like 1/2 with ½.");
    });

    it("display() adds the scope class to its own containerEl and mounts PatternsTab there", () => {
        const { plugin, snippetsTab, communityTab, patternsTab } = setup();
        const renderSpy = vi.spyOn(patternsTab, "render");
        const pages = createDeclarativePages(plugin, snippetsTab, communityTab, patternsTab)!;
        const page = pages.patterns.page!();
        page.display();
        expect(page.containerEl.classList.contains("snipsidian-settings")).toBe(true);
        expect(renderSpy).toHaveBeenCalledWith(page.containerEl);
        expect(page.containerEl.querySelector(".snipsy-pattern-list, .snipsy-patterns-empty")).not.toBeNull();
        expect(() => page.hide()).not.toThrow();
    });

    it("displayValue and status follow the rules: none, one, many, and one with an error", () => {
        const { plugin, snippetsTab, communityTab, patternsTab } = setup();
        const pages = createDeclarativePages(plugin, snippetsTab, communityTab, patternsTab)!;
        const value = pages.patterns.displayValue as () => string;
        const status = pages.patterns.status as () => "warning" | null;
        expect(value()).toBe("No rules");
        expect(status()).toBeNull();

        const good = { id: "a", source: "/a$/", replacement: "b", enabled: true, mode: "instant" as const };
        plugin.settings.patterns = [good];
        expect(value()).toBe("1 rule");
        plugin.settings.patterns = [good, { ...good, id: "b" }];
        expect(value()).toBe("2 rules");
        expect(status()).toBeNull();

        plugin.settings.patterns = [good, { ...good, id: "b", source: "/a$/g" }];
        expect(value()).toBe("2 rules, 1 with an error");
        expect(status()).toBe("warning");
    });
});

describe("createDeclarativePages: a saved patterns value that is not a list", () => {
    for (const odd of [{}, "x", 5]) {
        it(`displayValue and status do not throw for ${JSON.stringify(odd)}`, () => {
            const { plugin, snippetsTab, communityTab, patternsTab } = setup();
            (plugin.settings as unknown as { patterns: unknown }).patterns = odd;
            const pages = createDeclarativePages(plugin, snippetsTab, communityTab, patternsTab)!;
            const value = pages.patterns.displayValue as () => string;
            const status = pages.patterns.status as () => "warning" | null;
            expect(value()).toBe("Could not be read");
            expect(status()).toBe("warning");
        });
    }
});
