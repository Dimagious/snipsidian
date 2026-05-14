import { App, Notice, Platform, Setting } from "obsidian";
import type SnipSidianPlugin from "../../main";
import { isRecordOfString } from "../../shared/guards";
import { ImportPreviewModal } from "./Modals";

/**
 * General tab. Per the 1.1.0 redesign (HANDOFF §2c) every button here
 * is a utility, not a primary action — so none get `.setCta()`. The
 * old "8 CTAs in one tab" pattern made primary actions unreadable.
 *
 * Import flow no longer wipes the library silently (B-038). It now
 * opens `ImportPreviewModal` with the parsed payload; the user picks
 * merge vs replace and sees the diff before the write happens.
 */
export class BasicTab {
    constructor(
        private app: App,
        private plugin: SnipSidianPlugin,
    ) {}

    render(root: HTMLElement) {
        // Real <h3>s per accessibility audit B-091. `Setting().setHeading()`
        // emits a styled-div that screen readers don't pick up as a
        // section heading.
        const sectionHeading = (parent: HTMLElement, title: string, hint?: string) => {
            parent.createEl("h3", { text: title, cls: "snipsy-tab-heading" });
            if (hint) parent.createEl("p", { text: hint, cls: "snipsy-hint" });
        };

        // ---- Commands ----
        sectionHeading(root, "Commands", "Configure hotkeys for Snipsy commands.");

        new Setting(root)
            .setName("Insert snippet")
            .setDesc("Open the snippet picker to insert snippets")
            .addButton((btn) =>
                btn.setButtonText("Set hotkey").onClick(() => {
                    this.openHotkeyTab("snipsidian:insert-snippet");
                }),
            );

        new Setting(root)
            .setName("Open settings")
            .setDesc("Quick access to plugin settings")
            .addButton((btn) =>
                btn.setButtonText("Set hotkey").onClick(() => {
                    this.openHotkeyTab("snipsidian:open-settings");
                }),
            );

        // ---- Backup (export + import + reveal) ----
        sectionHeading(
            root,
            "Backup",
            "Export your snippets, restore from a backup, or open the data file.",
        );

        new Setting(root)
            .setName("Export snippets")
            .setDesc("Download your snippets as a JSON file")
            .addButton((btn) =>
                btn.setButtonText("Export JSON").onClick(() => this.exportJson()),
            );

        new Setting(root)
            .setName("Import snippets")
            .setDesc("Preview a JSON file before merging or replacing your library")
            .addButton((btn) =>
                btn.setButtonText("Import JSON").onClick(() => this.startImport()),
            );

        new Setting(root)
            .setName("Reveal data file")
            .setDesc("Open the snippets data file in your file manager")
            .addButton((btn) =>
                btn.setButtonText("Reveal").onClick(() => this.revealDataFile()),
            );

        // ---- Help & Resources ----
        sectionHeading(
            root,
            "Help & Resources",
            "Documentation, demos, and external snippet catalogs.",
        );

        new Setting(root)
            .setName("Documentation")
            .setDesc("GitHub repository — docs, examples, and source")
            .addButton((btn) =>
                btn.setButtonText("Open").onClick(() => {
                    window.open(
                        "https://github.com/Dimagious/snipsidian",
                        "_blank",
                        "noopener,noreferrer",
                    );
                }),
            );

        new Setting(root)
            .setName("Espanso hub")
            .setDesc("Thousands of community-created packages")
            .addButton((btn) =>
                btn.setButtonText("Open hub").onClick(() => {
                    window.open(
                        "https://hub.espanso.org/",
                        "_blank",
                        "noopener,noreferrer",
                    );
                }),
            );

        new Setting(root)
            .setName("Demo")
            .setDesc("See the plugin in action")
            .addButton((btn) =>
                btn.setButtonText("View demo").onClick(() => this.openDemo()),
            );
    }

    private openHotkeyTab(commandId: string) {
        this.app.setting.open();
        this.app.setting.openTabById("hotkeys");
        window.setTimeout(() => {
            const hotkeyTab = activeDocument.querySelector(
                `.setting-item[data-id="${commandId}"]`,
            );
            if (hotkeyTab) {
                hotkeyTab.scrollIntoView({ behavior: "smooth", block: "center" });
            }
        }, 100);
    }

    private exportJson() {
        const data = JSON.stringify(this.plugin.settings.snippets, null, 2);
        const blob = new Blob([data], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = createEl("a");
        a.href = url;
        a.download = "snipsidian-snippets.json";
        a.click();
        URL.revokeObjectURL(url);
    }

    private startImport() {
        const input = createEl("input");
        input.type = "file";
        input.accept = ".json";
        input.onchange = async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;

            try {
                const text = await file.text();
                const parsed: unknown = JSON.parse(text);
                if (!isRecordOfString(parsed)) {
                    new Notice(
                        "Invalid JSON: must be an object of { trigger: replacement } strings",
                    );
                    return;
                }

                new ImportPreviewModal(this.app, {
                    current: this.plugin.settings.snippets,
                    incoming: parsed,
                    onConfirm: async (mode) => {
                        // Caller owns the write per modal contract.
                        this.plugin.settings.snippets =
                            mode === "replace"
                                ? parsed
                                : { ...this.plugin.settings.snippets, ...parsed };
                        await this.plugin.saveSettings();
                        const count = Object.keys(parsed).length;
                        new Notice(
                            mode === "replace"
                                ? `Replaced library with ${count} snippet${count === 1 ? "" : "s"}`
                                : `Merged ${count} snippet${count === 1 ? "" : "s"}`,
                        );
                    },
                }).open();
            } catch (err) {
                new Notice(
                    `Import failed: ${err instanceof Error ? err.message : String(err)}`,
                );
            }
        };
        input.click();
    }

    private revealDataFile() {
        try {
            if (Platform.isDesktop) {
                const adapter = this.app.vault.adapter as { getBasePath?: () => string };
                if (typeof adapter.getBasePath !== "function") {
                    throw new Error("Not supported on this platform");
                }
                const base: string = adapter.getBasePath();
                const configDir: string = this.app.vault.configDir;
                const path = `${base}/${configDir}/plugins/snipsidian/data.json`;
                const electron = (
                    window as {
                        require?: (m: string) => {
                            shell?: { showItemInFolder?: (p: string) => void };
                        };
                    }
                ).require?.("electron");
                if (!electron?.shell?.showItemInFolder) {
                    throw new Error("Electron shell not available");
                }
                electron.shell.showItemInFolder(path);
            } else {
                new Notice("File manager access is only available on desktop");
            }
        } catch (err) {
            new Notice(
                `Failed to reveal file: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }

    private openDemo() {
        try {
            const adapter = this.app.vault.adapter as { getBasePath?: () => string };
            const base: string = adapter?.getBasePath?.() ?? "";
            const configDir: string = this.app.vault.configDir;
            const absPath = `${base}/${configDir}/plugins/snipsidian/docs/screens/espanso-demo.gif`;
            window.open(absPath, "_blank", "noopener,noreferrer");
        } catch (err) {
            new Notice(
                `Failed to open demo: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }
}
