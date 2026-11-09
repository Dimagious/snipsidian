// Obsidian's public typings omit the plugin and command registries. The
// library hands tests a plain `App`, so the two members the smoke tests read
// are declared here (integration tsconfig only; the shipped plugin never
// touches them).
import "obsidian";

declare module "obsidian" {
    interface App {
        plugins: {
            enabledPlugins: Set<string>;
            plugins: Record<
                string,
                { manifest: { version: string }; settings?: { snippets?: Record<string, string> } } | undefined
            >;
        };
        commands: {
            commands: Record<string, { id: string; name: string } | undefined>;
        };
    }
}
