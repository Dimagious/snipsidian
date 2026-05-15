import { App, Notice, Platform } from "obsidian";
import type SnipSidianPlugin from "../../main";
import { isRecordOfString } from "../../shared/guards";
import { ImportPreviewModal } from "./Modals";

/**
 * General tab. Visually aligned with the About tab: one section
 * heading at the top, then UPPERCASE-style subheadings (`<h4>`) and
 * bordered-list cards for each group. Help & Resources is gone —
 * it overlapped with the About tab, which is the canonical home for
 * documentation / community links.
 *
 * All actions here are equally-weighted utilities, so no buttons
 * carry `.setCta()` (HANDOFF §2c). Import flow opens
 * `ImportPreviewModal` so the user can preview merge vs replace
 * before the write (B-038).
 */
export class BasicTab {
    constructor(
        private app: App,
        private plugin: SnipSidianPlugin,
    ) {}

    render(root: HTMLElement) {
        root.empty();
        root.createEl("h3", { text: "Snipsy settings", cls: "snipsy-tab-heading" });

        // ---- Commands ----
        root.createEl("h4", { text: "Commands", cls: "snipsy-tab-subheading" });
        const commands = root.createDiv({ cls: "snipsy-about-list" });

        this.renderRow(commands, {
            title: "Insert snippet",
            description: "Open the snippet picker.",
            buttonText: "Set hotkey",
            onClick: () => this.openHotkeyTab("snipsidian:insert-snippet"),
        });

        this.renderRow(commands, {
            title: "Open settings",
            description: "Jump straight to Snipsy settings.",
            buttonText: "Set hotkey",
            onClick: () => this.openHotkeyTab("snipsidian:open-settings"),
        });

        // ---- Backup ----
        root.createEl("h4", { text: "Backup", cls: "snipsy-tab-subheading" });
        const backup = root.createDiv({ cls: "snipsy-about-list" });

        this.renderRow(backup, {
            title: "Export snippets",
            description: "Download your library as JSON.",
            buttonText: "Export JSON",
            onClick: () => this.exportJson(),
        });

        this.renderRow(backup, {
            title: "Import snippets",
            description: "Preview a JSON file before merge or replace.",
            buttonText: "Import JSON",
            onClick: () => this.startImport(),
        });

        this.renderRow(backup, {
            title: "Reveal data file",
            description: "Open the data file in your file manager.",
            buttonText: "Reveal",
            onClick: () => this.revealDataFile(),
        });
    }

    private renderRow(
        parent: HTMLElement,
        opts: {
            title: string;
            description: string;
            buttonText: string;
            onClick: () => void;
        },
    ) {
        const row = parent.createDiv({ cls: "snipsy-about-row" });
        const text = row.createDiv({ cls: "snipsy-about-text" });
        text.createDiv({ cls: "snipsy-about-row-title", text: opts.title });
        text.createDiv({ cls: "snipsy-about-row-desc", text: opts.description });

        const btn = row.createEl("button", {
            cls: "snipsy-about-row-action",
            text: opts.buttonText,
            attr: { type: "button", "aria-label": `${opts.buttonText}: ${opts.title}` },
        });
        btn.addEventListener("click", opts.onClick);
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
}
