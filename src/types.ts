export interface SnipSidianSettings {
    snippets: Record<string, string>;
    ui?: {
        groupOpen?: Record<string, boolean>;
        activeTab?: "basic" | "packages" | "snippets";
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
