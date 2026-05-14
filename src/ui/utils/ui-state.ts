import type { SnipSidianSettings } from "../../types";

/** Tab identifiers used inside the new 1.1.0 IA. Storage may still
 *  contain pre-1.1.0 IDs (`basic` / `community` / `feedback`) — those
 *  are migrated transparently in `loadActiveTab()`. */
export type TabId = "snippets" | "packages" | "general" | "about";

/** Migration map from pre-1.1.0 stored IDs to the new IA labels.
 *  - old `basic` (General tab) → new `general` (position 3)
 *  - old `community` (Community Packages tab) → new `packages` (position 2)
 *  - old `feedback` (Feedback tab) → new `about` (position 4)
 *  - old `snippets` stays as `snippets` (now position 1, landing)
 *  See ADR-0006 + designer Q1 answer. */
const LEGACY_TAB_ID_MAP: Record<string, TabId> = {
    basic: "general",
    snippets: "snippets",
    community: "packages",
    feedback: "about",
};

const VALID_TAB_IDS: ReadonlySet<TabId> = new Set<TabId>([
    "snippets",
    "packages",
    "general",
    "about",
]);

/** Persist callback. Called whenever UI state that lives in
 *  `settings.ui` is mutated. May be sync (returns void) or async. */
type Persist = () => void | Promise<void>;

export class UIStateManager {
    /** Default landing tab. "Snippets" because that's where day-to-day
     *  work happens — most users open Settings to manage their library
     *  (designer Q1 answer). */
    private activeTab: TabId = "snippets";
    private groupOpen = new Map<string, boolean>();
    private searchQuery = "";
    private selectionMode = false;
    private selected = new Set<string>();

    /** Debounce timer for `setGroupOpen` — bulk-expand triggers N saves in
     *  quick succession; we coalesce into one. */
    private groupOpenSaveTimer: number | null = null;

    constructor(
        private settings: SnipSidianSettings,
        private persist: Persist = () => {},
    ) {}

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
        const raw = this.settings.ui!.activeTab as string | undefined;

        // New-ID happy path.
        if (raw && VALID_TAB_IDS.has(raw as TabId)) return raw as TabId;

        // Pre-1.1.0 stored IDs — migrate to the new IA. We also
        // overwrite the stored value in-memory so future reads land in
        // the happy path. (The actual disk write happens on the next
        // `saveActiveTab` call.)
        if (raw && LEGACY_TAB_ID_MAP[raw]) {
            const migrated = LEGACY_TAB_ID_MAP[raw];
            this.settings.ui!.activeTab = migrated;
            return migrated;
        }

        // Corrupted / first-launch — default to landing.
        return "snippets";
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
        // Tab changes happen once per click — persist immediately.
        void this.persist();
    }

    getGroupOpen(): Map<string, boolean> {
        return this.groupOpen;
    }

    setGroupOpen(group: string, open: boolean) {
        this.groupOpen.set(group, open);
        this.saveOpenState(group, open);
        // Group toggles can fire in bursts (Expand-all writes N states in
        // a tight loop). Coalesce to one save 250ms after the last call.
        if (this.groupOpenSaveTimer !== null) {
            window.clearTimeout(this.groupOpenSaveTimer);
        }
        this.groupOpenSaveTimer = window.setTimeout(() => {
            this.groupOpenSaveTimer = null;
            void this.persist();
        }, 250);
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
