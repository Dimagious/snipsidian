import { App, PluginSettingTab } from "obsidian";
import type SnipSidianPlugin from "../../main";
import { BasicTab } from "./BasicTab";
import { SnippetsTab } from "./SnippetsTab";
import { FeedbackTab } from "./FeedbackTab";
import { CommunityTab } from "./CommunityTab";
import { UIStateManager, type TabId } from "../utils/ui-state";

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

    constructor(app: App, plugin: SnipSidianPlugin) {
        super(app, plugin);
        this.plugin = plugin;
        this.uiState = new UIStateManager(this.plugin.settings, () => this.plugin.saveSettings());
        this.basicTab = new BasicTab(app, plugin);
        this.snippetsTab = new SnippetsTab(app, plugin);
        this.feedbackTab = new FeedbackTab(app, plugin);
        this.communityTab = new CommunityTab(app, plugin);
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
