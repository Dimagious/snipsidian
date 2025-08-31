import { App, Modal, Notice, Platform, PluginSettingTab, Setting } from "obsidian";
import type SnipSidianPlugin from "../main";
import { DEFAULT_SNIPPETS } from "../presets";

/** Runtime helpers **/
function isRecordOfString(x: unknown): x is Record<string, string> {
    if (!x || typeof x !== "object") return false;
    for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
        if (typeof k !== "string" || typeof v !== "string") return false;
    }
    return true;
}

function normalizeTrigger(raw: string): string {
    return raw.trim();
}

function isBadTrigger(key: string): boolean {
    // Disallow spaces and the same separators that the expander uses
    return /[\s.,!?;:()\[\]{}"'\-\\/]/.test(key) || key.length === 0;
}

/** Settings tab: grouped snippets list + search + export/import + reveal + merge defaults + reload */
export class SnipSidianSettingTab extends PluginSettingTab {
    plugin: SnipSidianPlugin;

    // UI state (not persisted)
    private groupOpen = new Map<string, boolean>(); // group -> isOpen
    private searchQuery = "";

    constructor(app: App, plugin: SnipSidianPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.addClass("snipsidian-settings"); // scope CSS
        containerEl.createEl("h2", { text: "SnipSidian Settings" });

        // ===== Advanced first =====
        containerEl.createEl("h3", { text: "Advanced" });

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
                            const parsed = JSON.parse(text);
                            if (!isRecordOfString(parsed)) {
                                new Notice("Invalid JSON: must be an object of { trigger: replacement } strings");
                                return;
                            }
                            const MAX = 2000;
                            if (Object.keys(parsed).length > MAX) {
                                new Notice(`Too many snippets (>${MAX}).`);
                                return;
                            }
                            this.plugin.settings.snippets = parsed;
                            await this.plugin.saveSettings();
                            this.display();
                            new Notice("Snippets imported");
                        } catch (e) {
                            new Notice("Invalid JSON");
                            console.error(e);
                        }
                    };
                    modal.open();
                })
            );

        new Setting(containerEl)
            .setName("Add missing defaults")
            .setDesc("Merge any new default snippets into your current list (user snippets are not overwritten).")
            .addButton((b) =>
                b.setButtonText("Apply").onClick(async () => {
                    const before = Object.keys(this.plugin.settings.snippets).length;
                    this.plugin.settings.snippets = {
                        ...DEFAULT_SNIPPETS,
                        ...this.plugin.settings.snippets,
                    };
                    await this.plugin.saveSettings();
                    const after = Object.keys(this.plugin.settings.snippets).length;
                    new Notice(`Defaults merged (${after - before} added).`);
                    this.display();
                })
            );

        new Setting(containerEl)
            .setName("Reload snippets")
            .setDesc("Re-read data.json and refresh the UI.")
            .addButton((b) =>
                b.setButtonText("Reload").onClick(async () => {
                    await this.plugin.loadSettings();
                    await this.plugin.saveSettings();
                    this.display();
                    new Notice("Snippets reloaded");
                })
            );

        new Setting(containerEl)
            .setName("Reveal data.json")
            .setDesc("Open the plugin data file in your file manager (desktop only).")
            .addButton((b) =>
                b.setButtonText("Reveal").onClick(async () => {
                    try {
                        if (!Platform.isDesktopApp) throw new Error("Not desktop");
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const adapter: any = this.app.vault.adapter as any;
                        if (typeof adapter.getBasePath !== "function") throw new Error("Not supported on this platform");
                        const base: string = adapter.getBasePath();
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

        // ===== Snippets (with search and grouping) =====
        containerEl.createEl("h3", { text: "Snippets" });

        // Search input
        const searchSetting = new Setting(containerEl)
            .setName("Search")
            .setDesc("Filter by trigger or replacement text.");
        searchSetting.addText((t) =>
            t.setPlaceholder("Type to filter…").onChange((q) => {
                this.searchQuery = q.trim().toLowerCase();
                renderList();
            })
        );

        const listEl = containerEl.createDiv();

        const renderList = () => {
            listEl.empty();

            // Filter + group by prefix before '/'
            const entries = Object.entries(this.plugin.settings.snippets)
                .filter(([k, v]) => {
                    if (!this.searchQuery) return true;
                    return k.toLowerCase().includes(this.searchQuery) || v.toLowerCase().includes(this.searchQuery);
                })
                .sort(([a], [b]) => a.localeCompare(b));

            if (!entries.length) {
                const empty = listEl.createDiv({ text: "No snippets match the filter." });
                empty.addClass("snipsidian-empty");
                return;
            }

            const groups = new Map<string, Array<[string, string]>>();
            for (const e of entries) {
                const [k] = e;
                const group = k.includes("/") ? k.split("/", 1)[0] : "Ungrouped";
                if (!groups.has(group)) groups.set(group, []);
                groups.get(group)!.push(e);
            }

            for (const [group, items] of groups) {
                if (!this.groupOpen.has(group)) this.groupOpen.set(group, true);

                // Group header with toggle
                const hdr = listEl.createDiv({ cls: "snipsidian-group-header" });
                const toggle = hdr.createEl("button", { text: this.groupOpen.get(group) ? "▾" : "▸" });
                toggle.addEventListener("click", () => {
                    this.groupOpen.set(group, !this.groupOpen.get(group));
                    renderList();
                });
                hdr.createEl("span", { text: ` ${group} (${items.length})` });

                if (!this.groupOpen.get(group)) continue;

                // Items
                items.forEach(([trigger, replacement]) => {
                    const row = new Setting(listEl);
                    let currentKey = trigger;

                    row.addText((t) =>
                        t
                            .setPlaceholder("trigger (e.g. dev/brb)")
                            .setValue(trigger)
                            .onChange(async (raw) => {
                                const newKey = normalizeTrigger(raw);
                                if (!newKey || newKey === currentKey) return;
                                if (isBadTrigger(newKey)) {
                                    new Notice("Trigger cannot be empty or contain spaces/punctuation");
                                    (t.inputEl as HTMLInputElement).value = currentKey;
                                    return;
                                }
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
                                renderList(); // group may change
                            })
                    );

                    row.addTextArea((ta) => {
                        ta
                            .setPlaceholder("replacement (e.g. be right back)")
                            .setValue(replacement)
                            .onChange(async (val) => {
                                this.plugin.settings.snippets[currentKey] = val;
                                await this.plugin.saveSettings();
                            });
                        // Make textarea taller (fix for previous error: use TextAreaComponent.inputEl)
                        ta.inputEl.rows = 2;
                    });

                    row.addExtraButton((btn) =>
                        btn
                            .setIcon("trash")
                            .setTooltip("Delete snippet")
                            .onClick(async () => {
                                if (!confirm(`Delete snippet "${currentKey}"?`)) return;
                                delete this.plugin.settings.snippets[currentKey];
                                await this.plugin.saveSettings();
                                renderList();
                            })
                    );
                });
            }

            // Add snippet button at the end
            new Setting(listEl).addButton((b) =>
                b
                    .setButtonText("+ Add snippet")
                    .setCta()
                    .onClick(async () => {
                        let base = this.searchQuery ? this.searchQuery : "trigger";
                        base = base.replace(/\s+/g, "-");
                        if (isBadTrigger(base)) base = "trigger";

                        let key = base;
                        let i = 1;
                        while (this.plugin.settings.snippets[key] !== undefined) key = `${base}${i++}`;
                        this.plugin.settings.snippets[key] = "";
                        await this.plugin.saveSettings();
                        this.groupOpen.set(key.includes("/") ? key.split("/", 1)[0] : "Ungrouped", true);
                        renderList();
                    })
            );
        };

        renderList();
    }
}

/** Simple modal for JSON copy/paste */
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
