import type { PackageItem } from "./services/community-packages";

// Augment Obsidian's App type with internal APIs we rely on. These exist at
// runtime but aren't part of the public obsidian.d.ts.
declare module "obsidian" {
    interface App {
        setting: {
            open(): void;
            openTabById(id: string): void;
        };
        version: string;
    }
}

export interface SnipSidianSettings {
    snippets: Record<string, string>;
    /**
     * B-137: opt-in trigger-prefix mode. Additive, defaults preserve
     * current behavior exactly — `requirePrefix` unset/`false` means
     * "off" (byte-identical to pre-1.3.0). `prefixChar` defaults to
     * `":"` when unset. One global mode; no per-snippet opt-out.
     */
    expansion?: {
        requirePrefix?: boolean;
        prefixChar?: string;
    };
    /**
     * B-138: per-group enable/disable. Top-level (not under `ui`) —
     * this is behavior (disabled groups don't expand and are hidden
     * from the picker), not UI display state. Group slugs listed
     * here are skipped by `getDict`/`getAllSnippetsFlat`. Ungrouped
     * entries (empty group slug `""`) can never appear here — the
     * UI has no affordance to disable "Ungrouped".
     */
    disabledGroups?: string[];
    ui?: {
        groupOpen?: Record<string, boolean>;
        /** Stored as a string for forward-compatibility — runtime narrowing
         *  + migration of pre-1.1.0 values happens in `UIStateManager.loadActiveTab`. */
        activeTab?: string;
    };
    communityPackages?: {
        cache?: {
            packages: PackageItem[];
            lastUpdated: number;
        };
    };
}

export interface SnippetItem {
    id: string;            // stable id, can use folder/trigger as key
    folder: string;        // "arrows", "callouts", ...
    trigger: string;       // "->"
    replacement: string;   // "→" or callout block
    keywords?: string[];   // optional: for search
}

export interface SnippetSearchQuery {
    text: string;          // search string
    folder?: string;       // folder filter (optional)
    limit?: number;        // results threshold (e.g., 100)
}
