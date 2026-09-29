import { App, PluginSettingTab, requireApiVersion, type SettingDefinitionItem } from "obsidian";
import type SnipSidianPlugin from "../../main";
import { BasicTab } from "./BasicTab";
import { SnippetsTab } from "./SnippetsTab";
import { FeedbackTab } from "./FeedbackTab";
import { CommunityTab } from "./CommunityTab";
import { UIStateManager, type TabId } from "../utils/ui-state";
import { createDeclarativePages } from "./declarative-pages";
import { buildGeneralDefinitions } from "./general-definitions";
import { buildAboutDefinitions } from "./about-definitions";
import { createControlHost, type ControlHost } from "../utils/settings-control-path";

/** Tab strip metadata. Order = visual order. Position 1 (`snippets`) is
 *  the landing tab — that's where day-to-day work happens per the 1.1.0
 *  redesign (designer Q1 answer). Internal component names below stay
 *  legacy (`basicTab`/`communityTab`/`feedbackTab`) — the user-facing
 *  label change doesn't require renaming the files. */
const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
    { id: "snippets", label: "Snippets" },
    { id: "packages", label: "Packages" },
    { id: "general", label: "General" },
    { id: "about", label: "About" },
];

export class SnipSidianSettingTab extends PluginSettingTab {
    plugin: SnipSidianPlugin;
    private uiState: UIStateManager;
    private basicTab: BasicTab;
    private snippetsTab: SnippetsTab;
    private feedbackTab: FeedbackTab;
    private communityTab: CommunityTab;
    private controlHost: ControlHost;

    constructor(app: App, plugin: SnipSidianPlugin) {
        super(app, plugin);
        this.plugin = plugin;
        this.uiState = new UIStateManager(this.plugin.settings, () => this.plugin.saveSettings());
        this.basicTab = new BasicTab(app, plugin, () => this.refreshDeclarative());
        this.snippetsTab = new SnippetsTab(app, plugin);
        this.feedbackTab = new FeedbackTab(app, plugin);
        this.communityTab = new CommunityTab(app, plugin);
        this.controlHost = createControlHost(plugin);
    }

    /**
     * B-151/ADR-0007 (option A — see `.claude/brain/decisions/0007-
     * declarative-settings-b151.md` and the spike report it links):
     * on Obsidian 1.13+, returns the full declarative tree —
     * `SettingDefinitionPage` entries for "Snippets" and "Packages"
     * (imperative `page:` factories, see `declarative-pages.ts`, since
     * that content is stateful/network-backed and doesn't fit a plain
     * list of definitions) plus the General and About groups
     * (`general-definitions.ts`/`about-definitions.ts` — real
     * `control`/`action`/`render` rows, so those sections ALSO drive
     * global settings search, which the previous `[]` stub could not).
     *
     * Below 1.13.0, `SettingPage` isn't usable (see
     * `createDeclarativePages`'s doc comment) and `getSettingDefinitions`
     * must return `[]` so `display()` — the tab-strip fallback below —
     * keeps running (`SettingTab#display()`'s own doc: "Not called when
     * getSettingDefinitions returns a non-empty array"). `display()`
     * itself is retained unconditionally: `eslint-plugin-obsidianmd`'s
     * `settings-tab/require-display` rule wants it present whenever
     * `minAppVersion` (1.5.0) is below 1.13, and keeping it also means
     * `1.13.0` (no `.9` before it) — matching the version string used
     * by every guard in `declarative-pages.ts` — is the only thing gating
     * the two behaviours apart.
     */
    getSettingDefinitions(): SettingDefinitionItem[] {
        const pages = createDeclarativePages(this.plugin, this.snippetsTab, this.communityTab);
        if (!pages) return [];

        const meta = this.feedbackTab.collectMetaForDefinitions();
        return [
            pages.snippets,
            pages.packages,
            ...buildGeneralDefinitions(this.plugin, this.basicTab.definitionHandlers()),
            ...buildAboutDefinitions(meta, this.feedbackTab.definitionHandlers()),
        ];
    }

    /** Overrides `SettingTab`'s default `this.app.vault.getConfig`-based
     *  lookup so `control` rows with a dotted key (`expansion.
     *  requirePrefix`, `expansion.prefixChar`) read/write the plugin's
     *  own nested settings object instead (spike report, Q3 — the
     *  default flat lookup does not resolve a dotted key). Shared with
     *  the pre-1.13 `renderDefinitionGroups` adapter via the same
     *  `ControlHost`, so both render paths persist through one path. */
    getControlValue(key: string): unknown {
        return this.controlHost.getControlValue(key);
    }

    setControlValue(key: string, value: unknown): void | Promise<void> {
        return this.controlHost.setControlValue(key, value);
    }

    /**
     * Finding #2: refreshes the declarative tree's stale
     * `displayValue`/`disabled` state after a root-level mutation
     * (Restore defaults, Import confirm — see `BasicTab`'s
     * `onDeclarativeChange` doc comment) while the tab root itself
     * stays visible. `this.update()` re-evaluates
     * `getSettingDefinitions()` and re-renders (spike report, Q4).
     *
     * `if (requireApiVersion("1.13.0")) { this.update(); }` is the
     * EXACT guard shape `eslint-plugin-obsidianmd`'s `no-unsupported-
     * api` rule (error, type-checked) recognises for a 1.13+-only API
     * at `minAppVersion` 1.5.0 — confirmed in the spike (Q6): an
     * early-return guard (`if (!requireApiVersion(...)) return;`) is
     * NOT recognised and still errors. Below 1.13 this is a no-op:
     * `update()` doesn't exist there, and nothing needs refreshing —
     * the pre-1.13 tab strip re-renders its own tab content on every
     * `SnippetsTab`/`BasicTab` mutation already.
     */
    refreshDeclarative(): void {
        if (requireApiVersion("1.13.0")) {
            this.update();
        }
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        if (!containerEl.classList.contains("snipsidian-settings")) {
            containerEl.addClass("snipsidian-settings");
        }

        // Tab strip. WAI-ARIA tabs pattern per accessibility audit A-002
        // (B-083): the container is `role="tablist"`, each button is
        // `role="tab"` with `aria-selected` + `aria-controls` pointing
        // at the panel, the panel is `role="tabpanel"` labelled by its
        // tab. Arrow keys + Home/End move focus and activation; the
        // active tab is the only one in the tab order (roving tabindex).
        const tabList = containerEl.createDiv({ cls: "snipsy-tabs" });
        tabList.setAttr("role", "tablist");
        tabList.setAttr("aria-label", "Snipsy settings sections");

        const tabPanel = containerEl.createDiv({ cls: "snipsy-tab-content" });
        tabPanel.setAttr("role", "tabpanel");

        // Read + migrate any pre-1.1.0 stored value, then commit so the
        // saved settings reflect the new IA on the next persist.
        const initialActive = this.uiState.loadActiveTab();
        this.uiState.setActiveTab(initialActive);

        const tabButtons: HTMLButtonElement[] = [];

        const activateTab = (id: TabId, focusButton: boolean) => {
            this.uiState.setActiveTab(id);

            for (let i = 0; i < TABS.length; i++) {
                const meta = TABS[i];
                const btn = tabButtons[i];
                if (!meta || !btn) continue;
                const isActive = meta.id === id;
                btn.toggleClass("is-active", isActive);
                btn.setAttr("aria-selected", isActive ? "true" : "false");
                btn.setAttr("tabindex", isActive ? "0" : "-1");
            }

            tabPanel.setAttr("id", `snipsy-panel-${id}`);
            tabPanel.setAttr("aria-labelledby", `snipsy-tab-${id}`);
            this.renderTabContent(tabPanel, id);

            if (focusButton) {
                const idx = TABS.findIndex((t) => t.id === id);
                tabButtons[idx]?.focus();
            }
        };

        for (let i = 0; i < TABS.length; i++) {
            const meta = TABS[i];
            if (!meta) continue;
            const isActive = meta.id === initialActive;

            const btn = tabList.createEl("button", {
                text: meta.label,
                cls: `snipsy-tab${isActive ? " is-active" : ""}`,
            });
            btn.setAttr("type", "button");
            btn.setAttr("role", "tab");
            btn.setAttr("id", `snipsy-tab-${meta.id}`);
            btn.setAttr("aria-controls", `snipsy-panel-${meta.id}`);
            btn.setAttr("aria-selected", isActive ? "true" : "false");
            // Roving tabindex: only the active tab is in the page tab
            // order. Arrow keys move both focus and activation.
            btn.setAttr("tabindex", isActive ? "0" : "-1");

            // Mouse click — don't refocus, the user's pointer is already
            // there and forcing focus back fights screen-reader users
            // who may have arrowed elsewhere.
            btn.onclick = () => activateTab(meta.id, false);

            btn.addEventListener("keydown", (e) => {
                let nextIdx: number | null = null;
                switch (e.key) {
                    case "ArrowRight":
                        nextIdx = (i + 1) % TABS.length;
                        break;
                    case "ArrowLeft":
                        nextIdx = (i - 1 + TABS.length) % TABS.length;
                        break;
                    case "Home":
                        nextIdx = 0;
                        break;
                    case "End":
                        nextIdx = TABS.length - 1;
                        break;
                }
                if (nextIdx !== null) {
                    e.preventDefault();
                    const target = TABS[nextIdx];
                    if (target) activateTab(target.id, true);
                }
            });

            tabButtons.push(btn);
        }

        // Initial panel render.
        tabPanel.setAttr("id", `snipsy-panel-${initialActive}`);
        tabPanel.setAttr("aria-labelledby", `snipsy-tab-${initialActive}`);
        this.renderTabContent(tabPanel, initialActive);
    }

    private renderTabContent(container: HTMLElement, id: TabId) {
        container.empty();

        switch (id) {
            case "snippets":
                this.snippetsTab.render(container);
                break;
            case "packages":
                void this.communityTab.render(container);
                break;
            case "general":
                this.basicTab.render(container);
                break;
            case "about":
                this.feedbackTab.render(container);
                break;
        }
    }
}
