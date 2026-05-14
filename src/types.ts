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
