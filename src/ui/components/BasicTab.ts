import { App, Notice, Platform, Setting } from "obsidian";
import type SnipSidianPlugin from "../../main";
import { isRecordOfString } from "../../services/utils";

export class BasicTab {
    constructor(
        private app: App,
        private plugin: SnipSidianPlugin
    ) {}

    render(root: HTMLElement) {
        // Helper function for creating sections
        const section = (title: string, hint?: string, specialClass?: string) => {
            const wrap = root.createDiv({ cls: `snipsy-section ${specialClass || ""}` });
            new Setting(wrap)
                .setHeading()
                .setName(title);
            if (hint) wrap.createEl("p", { text: hint, cls: "snipsy-hint" });
            return wrap;
        };

        // Commands section
        const commandsSection = section("Commands", "Configure hotkeys for Snipsy commands.", "snipsy-commands-section");

        new Setting(commandsSection)
            .setName("Insert snippet")
            .setDesc("Open the snippet picker to insert snippets")
            .addButton((btn) =>
                btn
                    .setButtonText("Set hotkey")
                    .setCta()
                    .onClick(() => {
                        // Open hotkey settings for the insert-snippet command
                        // @ts-expect-error - Obsidian API works correctly at runtime
                        this.app.setting.open();
                        // @ts-expect-error - Obsidian API works correctly at runtime
                        this.app.setting.openTabById("hotkeys");
                        // Focus on our command
                        setTimeout(() => {
                            const hotkeyTab = document.querySelector('.setting-item[data-id="snipsidian:insert-snippet"]');
                            if (hotkeyTab) {
                                hotkeyTab.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            }
                        }, 100);
                    })
            );

        new Setting(commandsSection)
            .setName("Open Snipsy settings")
            .setDesc("Quick access to Snipsy settings")
            .addButton((btn) =>
                btn
                    .setButtonText("Set hotkey")
                    .setCta()
                    .onClick(() => {
                        // Open hotkey settings for the open-settings command
                        // @ts-expect-error - Obsidian API works correctly at runtime
                        this.app.setting.open();
                        // @ts-expect-error - Obsidian API works correctly at runtime
                        this.app.setting.openTabById("hotkeys");
                        // Focus on our command
                        setTimeout(() => {
                            const hotkeyTab = document.querySelector('.setting-item[data-id="snipsidian:open-settings"]');
                            if (hotkeyTab) {
                                hotkeyTab.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            }
                        }, 100);
                    })
            );

        // Export/Import section
        const exportSection = section("Export & Import", "Backup your snippets or share them between devices.", "snipsy-export-section");

        new Setting(exportSection)
            .setName("Export snippets")
            .setDesc("Download your snippets as a JSON file")
            .addButton((btn) =>
                btn
                    .setButtonText("Export JSON")
                    .setCta()
                    .onClick(() => {
                        const data = JSON.stringify(this.plugin.settings.snippets, null, 2);
                        const blob = new Blob([data], { type: "application/json" });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = "snipsidian-snippets.json";
                        a.click();
                        URL.revokeObjectURL(url);
                    })
            );

        new Setting(exportSection)
            .setName("Import snippets")
            .setDesc("Upload a JSON file to replace your current snippets")
            .addButton((btn) =>
                btn
                    .setButtonText("Import JSON")
                    .setCta()
                    .onClick(() => {
                        const input = document.createElement("input");
                        input.type = "file";
                        input.accept = ".json";
                        input.onchange = async (e) => {
                            const file = (e.target as HTMLInputElement).files?.[0];
                            if (!file) return;

                            try {
                                const text = await file.text();
                                const parsed = JSON.parse(text);
                                if (!isRecordOfString(parsed)) {
                                    new Notice("Invalid JSON: must be an object of { trigger: replacement } strings");
                                    return;
                                }
                                this.plugin.settings.snippets = parsed;
                                await this.plugin.saveSettings();
                                new Notice("Snippets imported successfully");
                            } catch (err) {
                                new Notice(`Import failed: ${err}`);
                            }
                        };
                        input.click();
                    })
            );

        new Setting(exportSection)
            .setName("Reveal data file")
            .setDesc("Open the snippets data file in your file manager")
            .addButton((btn) =>
                btn
                    .setButtonText("Reveal")
                    .setCta()
                    .onClick(async () => {
                        try {
                            if (Platform.isDesktop) {
                                // @ts-expect-error Obsidian internal API - vault.adapter.getBasePath exists at runtime but is not in type definitions
                                const adapter = this.app.vault.adapter as { getBasePath?: () => string };
                                if (typeof adapter.getBasePath !== "function") throw new Error("Not supported on this platform");
                                const base: string = adapter.getBasePath();
                                const configDir: string = this.app.vault.configDir;
                                const path = `${base}/${configDir}/plugins/snipsidian/data.json`;
                                // @ts-expect-error Electron internal API - window.require exists at runtime in Electron environment
                                const electron = (window as { require?: (module: string) => { shell?: { showItemInFolder?: (path: string) => void } } }).require?.("electron");
                                if (!electron?.shell?.showItemInFolder) throw new Error("Electron shell not available");
                                electron.shell.showItemInFolder(path);
                            } else {
                                new Notice("File manager access is only available on desktop");
                            }
                        } catch (err) {
                            new Notice(`Failed to reveal file: ${err}`);
                        }
                    })
            );

        // Help section
        const helpSection = section("Help & Resources", "Learn more about Snipsy and text expansion.", "snipsy-help-section");

        new Setting(helpSection)
            .setName("Documentation")
            .setDesc("Visit the GitHub repository for documentation and examples")
            .addButton((btn) =>
                btn
                    .setButtonText("Open GitHub")
                    .setCta()
                    .onClick(() => {
                        window.open("https://github.com/Dimagious/snipsidian", "_blank");
                    })
            );

        new Setting(helpSection)
            .setName("Espanso hub")
            .setDesc("Browse thousands of community-created packages")
            .addButton((btn) =>
                btn
                    .setButtonText("Browse packages")
                    .setCta()
                    .onClick(() => {
                        window.open("https://hub.espanso.org/", "_blank");
                    })
            );

        new Setting(helpSection)
            .setName("Demo GIF")
            .setDesc("See Snipsy in action")
            .addButton((btn) =>
                btn
                    .setButtonText("View demo")
                    .setCta()
                    .onClick(() => {
                        try {
                            // @ts-expect-error Obsidian internal API - vault.adapter.getBasePath exists at runtime but is not in type definitions
                            const adapter = this.app.vault.adapter as { getBasePath?: () => string };
                            const base: string = adapter?.getBasePath?.() ?? "";
                            const configDir: string = this.app.vault.configDir;
                            const absPath = `${base}/${configDir}/plugins/snipsidian/docs/screens/espanso-demo.gif`;
                            window.open(absPath, "_blank");
                        } catch (err) {
                            new Notice(`Failed to open demo: ${err}`);
                        }
                    })
            );
    }
}
