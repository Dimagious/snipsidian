import { App, Plugin, PluginSettingTab, Setting, Notice, Modal, Platform } from "obsidian";

// --- настройки ---
interface SnipSidianSettings {
    snippets: Record<string, string>;
}
const DEFAULT_SETTINGS: SnipSidianSettings = {
    snippets: { brb: "be right back", omw: "on my way" },
};

export default class SnipSidianPlugin extends Plugin {
    settings: SnipSidianSettings;

    async onload() {
        console.log("SnipSidian plugin loaded!");
        await this.loadSettings();

        this.addCommand({
            id: "insert-hello-world",
            name: "Insert Hello World",
            editorCallback: (editor) => editor.replaceSelection("Hello World"),
        });

        this.addSettingTab(new SnipSidianSettingTab(this.app, this));
    }

    onunload() {
        console.log("SnipSidian plugin unloaded!");
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}

// ====== НАСТРОЙКИ (UI) ======
class SnipSidianSettingTab extends PluginSettingTab {
    plugin: SnipSidianPlugin;

    constructor(app: App, plugin: SnipSidianPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl("h2", { text: "SnipSidian Settings" });

        // --- Snippets (editable list) ---
        containerEl.createEl("h3", { text: "Snippets" });
        const listEl = containerEl.createDiv();

        const renderList = () => {
            listEl.empty();

            const entries = Object.entries(this.plugin.settings.snippets);
            if (!entries.length) {
                const empty = listEl.createDiv({ text: "No snippets yet." });
                empty.addClass("snipsidian-empty");
            }

            entries.forEach(([trigger, replacement]) => {
                const row = new Setting(listEl);
                let currentKey = trigger;

                row.addText((t) =>
                    t
                        .setPlaceholder("trigger (e.g. brb)")
                        .setValue(trigger)
                        .onChange(async (newKey) => {
                            if (!newKey || newKey === currentKey) return;
                            const map = this.plugin.settings.snippets;
                            const val = map[currentKey];
                            delete map[currentKey];
                            if (newKey in map) {
                                new Notice(`Trigger "${newKey}" already exists`);
                                map[currentKey] = val; // rollback
                                (t.inputEl as HTMLInputElement).value = currentKey;
                                return;
                            }
                            map[newKey] = val;
                            currentKey = newKey;
                            await this.plugin.saveSettings();
                        })
                );

                row.addTextArea((ta) =>
                    ta
                        .setPlaceholder("replacement (e.g. be right back)")
                        .setValue(replacement)
                        .onChange(async (val) => {
                            this.plugin.settings.snippets[currentKey] = val;
                            await this.plugin.saveSettings();
                        })
                );

                row.addExtraButton((btn) =>
                    btn
                        .setIcon("trash")
                        .setTooltip("Delete snippet")
                        .onClick(async () => {
                            delete this.plugin.settings.snippets[currentKey];
                            await this.plugin.saveSettings();
                            renderList();
                        })
                );
            });

            new Setting(listEl).addButton((b) =>
                b
                    .setButtonText("+ Add snippet")
                    .setCta()
                    .onClick(async () => {
                        let base = "trigger";
                        let key = base;
                        let i = 1;
                        while (this.plugin.settings.snippets[key] !== undefined) {
                            key = `${base}${i++}`;
                        }
                        this.plugin.settings.snippets[key] = "";
                        await this.plugin.saveSettings();
                        renderList();
                    })
            );
        };

        renderList();

        // --- Advanced ---
        containerEl.createEl("h3", { text: "Advanced" });

        // Export / Import JSON
        new Setting(containerEl)
            .setName("Export / Import")
            .setDesc("Backup or restore snippets as JSON.")
            .addButton((b) =>
                b.setButtonText("Export JSON").onClick(async () => {
                    const json = JSON.stringify(this.plugin.settings.snippets, null, 2);
                    try {
                        await navigator.clipboard.writeText(json);
                        new Notice("Snippets copied to clipboard");
                    } catch {
                        const modal = new JSONModal(this.app, json, "Copy the JSON below");
                        modal.open();
                    }
                })
            )
            .addButton((b) =>
                b.setButtonText("Import JSON").onClick(async () => {
                    const modal = new JSONModal(
                        this.app,
                        JSON.stringify(this.plugin.settings.snippets, null, 2),
                        "Paste JSON and press Apply"
                    );
                    modal.onApply = async (text) => {
                        try {
                            this.plugin.settings.snippets = JSON.parse(text);
                            await this.plugin.saveSettings();
                            renderList();
                            new Notice("Snippets imported");
                        } catch (e) {
                            new Notice("Invalid JSON");
                            console.error(e);
                        }
                    };
                    modal.open();
                })
            );

        // Reveal data.json (desktop only)
        new Setting(containerEl)
            .setName("Reveal data.json")
            .setDesc("Open the plugin data file in your file manager (desktop only).")
            .addButton((b) =>
                b.setButtonText("Reveal").onClick(async () => {
                    try {
                        if (!Platform.isDesktopApp) throw new Error("Not desktop");
                        // @ts-ignore
                        const adapter = this.app.vault.adapter;
                        // @ts-ignore
                        if (!adapter.getBasePath) throw new Error("Not supported on this platform");
                        // @ts-ignore
                        const base = adapter.getBasePath() as string;
                        const path = `${base}/.obsidian/plugins/snipsidian/data.json`;
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const electron = (window as any).require?.("electron");
                        if (!electron?.shell?.showItemInFolder) throw new Error("Electron shell not available");
                        electron.shell.showItemInFolder(path);
                    } catch (e) {
                        new Notice("Reveal unsupported on this platform. Use Export/Import instead.");
                        console.warn(e);
                    }
                })
            );
    }
}

/** Простая модалка для копипасты JSON */
class JSONModal extends Modal {
    text: string;
    title: string;
    onApply?: (text: string) => void;

    constructor(app: App, text: string, title = "JSON") {
        super(app);
        this.text = text;
        this.title = title;
    }

    onOpen(): void {
        const { contentEl, titleEl } = this;
        titleEl.setText(this.title);

        const ta = contentEl.createEl("textarea", { text: this.text });
        ta.style.width = "100%";
        ta.style.height = "300px";

        const footer = contentEl.createDiv({ cls: "modal-button-container" });
        const apply = footer.createEl("button", { text: "Apply" });
        apply.onclick = () => {
            this.onApply?.(ta.value);
            this.close();
        };

        const close = footer.createEl("button", { text: "Close" });
        close.onclick = () => this.close();
    }
}