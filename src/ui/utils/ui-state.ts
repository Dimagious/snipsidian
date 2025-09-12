import type { SnipSidianSettings } from "../../types";

export type TabId = "basic" | "snippets" | "community" | "feedback";

export class UIStateManager {
    private activeTab: TabId = "basic";
    private groupOpen = new Map<string, boolean>();
    private searchQuery = "";
    private selectionMode = false;
    private selected = new Set<string>();

    constructor(private settings: SnipSidianSettings) {}

    // ---- UI state management ----
    ensureUiState() {
        if (!this.settings.ui) {
            this.settings.ui = {};
        }
        if (!this.settings.ui.groupOpen) {
            this.settings.ui.groupOpen = {};
        }
        if (!this.settings.ui.activeTab) {
            this.settings.ui.activeTab = this.activeTab;
        }
    }

    loadOpenState(group: string, defaultOpen = false): boolean {
        this.ensureUiState();
        const store = this.settings.ui!.groupOpen!;
        if (store[group] === undefined) store[group] = defaultOpen;
        return store[group];
    }

    saveOpenState(group: string, open: boolean | undefined) {
        this.ensureUiState();
        const store = this.settings.ui!.groupOpen!;
        if (open === undefined) delete store[group];
        else store[group] = open;
    }

    loadActiveTab(): TabId {
        this.ensureUiState();
        const v = this.settings.ui!.activeTab;
        if (v === "basic" || v === "snippets" || v === "community" || v === "feedback") return v;
        return "basic";
    }

    saveActiveTab(tab: TabId) {
        this.ensureUiState();
        this.settings.ui!.activeTab = tab;
    }

    // ---- Getters and setters ----
    getActiveTab(): TabId {
        return this.activeTab;
    }

    setActiveTab(tab: TabId) {
        this.activeTab = tab;
        this.saveActiveTab(tab);
    }

    getGroupOpen(): Map<string, boolean> {
        return this.groupOpen;
    }

    setGroupOpen(group: string, open: boolean) {
        this.groupOpen.set(group, open);
        this.saveOpenState(group, open);
    }

    getSearchQuery(): string {
        return this.searchQuery;
    }

    setSearchQuery(query: string) {
        this.searchQuery = query;
    }

    getSelectionMode(): boolean {
        return this.selectionMode;
    }

    setSelectionMode(mode: boolean) {
        this.selectionMode = mode;
    }

    getSelected(): Set<string> {
        return this.selected;
    }

    setSelected(selected: Set<string>) {
        this.selected = selected;
    }
}
