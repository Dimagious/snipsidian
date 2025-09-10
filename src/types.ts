export interface SnipSidianSettings {
    snippets: Record<string, string>;
    ui?: {
        groupOpen?: Record<string, boolean>;
        activeTab?: "basic" | "packages" | "snippets";
    };
}
