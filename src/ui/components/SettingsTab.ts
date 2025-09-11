import { App, PluginSettingTab } from "obsidian";
import type SnipSidianPlugin from "../../main";
import { BasicTab } from "./BasicTab";
import { PackagesTab } from "./PackagesTab";
import { SnippetsTab } from "./SnippetsTab";
import { FeedbackTab } from "./FeedbackTab";
import { UIStateManager } from "../utils/ui-state";

export class SnipSidianSettingTab extends PluginSettingTab {
    plugin: SnipSidianPlugin;
    private uiState: UIStateManager;
    private basicTab: BasicTab;
    private packagesTab: PackagesTab;
    private snippetsTab: SnippetsTab;
    private feedbackTab: FeedbackTab;

    constructor(app: App, plugin: SnipSidianPlugin) {
        super(app, plugin);
        this.plugin = plugin;
        this.uiState = new UIStateManager(this.plugin.settings);
        this.basicTab = new BasicTab(app, plugin);
        this.packagesTab = new PackagesTab(app, plugin);
        this.snippetsTab = new SnippetsTab(app, plugin);
        this.feedbackTab = new FeedbackTab(app, plugin);
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        if (!containerEl.classList.contains("snipsidian-settings")) {
            containerEl.addClass("snipsidian-settings");
        }

        // Header
        const header = containerEl.createDiv({ cls: "snipsy-header" });
        header.createEl("h2", { text: "Snipsy Settings" });

        // Tab navigation
        const tabs = [
            { id: "basic" as const, label: "Basic" },
            { id: "packages" as const, label: "Packages" },
            { id: "snippets" as const, label: "Snippets" },
            { id: "feedback" as const, label: "Feedback" },
        ];

        const tabContainer = containerEl.createDiv({ cls: "snipsy-tabs" });
        const tabButtons = tabContainer.createDiv({ cls: "tab-buttons" });
        const tabContent = tabContainer.createDiv({ cls: "tab-content" });

        // Load active tab from settings
        const activeTab = this.uiState.loadActiveTab();
        this.uiState.setActiveTab(activeTab);

        // Create tab buttons
        for (const t of tabs) {
            const btn = tabButtons.createEl("button", {
                text: t.label,
                cls: `tab-button ${this.uiState.getActiveTab() === t.id ? "active" : ""}`,
            });

            btn.onclick = () => {
                this.uiState.setActiveTab(t.id);
                this.renderTabContent(tabContent);
                this.updateTabButtons(tabButtons, tabs);
            };
        }

        // Render initial content
        this.renderTabContent(tabContent);
    }

    private renderTabContent(container: HTMLElement) {
        container.empty();

        switch (this.uiState.getActiveTab()) {
            case "basic":
                this.basicTab.render(container);
                break;
            case "packages":
                this.packagesTab.render(container);
                break;
            case "snippets":
                this.snippetsTab.render(container);
                break;
            case "feedback":
                this.feedbackTab.render(container);
                break;
        }
    }

    private updateTabButtons(container: HTMLElement, tabs: Array<{ id: string; label: string }>) {
        const buttons = container.querySelectorAll(".tab-button");
        buttons.forEach((btn, index) => {
            const tab = tabs[index];
            if (tab && this.uiState.getActiveTab() === tab.id) {
                btn.classList.add("active");
            } else {
                btn.classList.remove("active");
            }
        });
    }
}
