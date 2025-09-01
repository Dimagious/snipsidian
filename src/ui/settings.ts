import { App, Notice, Platform, PluginSettingTab, Setting } from "obsidian";
import type SnipSidianPlugin from "../main";
import { DEFAULT_SNIPPETS } from "../presets";
import { espansoYamlToSnippets } from "../packages/espanso";
import { PACKAGE_CATALOG } from "../packages/catalog";
import {
    diffIncoming,
    isRecordOfString,
    normalizeTrigger,
    isBadTrigger,
    splitKey,
    joinKey,
    slugifyGroup,
    displayGroupTitle,
} from "../services/utils";
import { JSONModal, PackagePreviewModal } from "./components/Modals";

export class SnipSidianSettingTab extends PluginSettingTab {
    plugin: SnipSidianPlugin;

    private groupOpen = new Map<string, boolean>();
    private searchQuery = "";

    private selectionMode = false;
    private selected = new Set<string>();

    constructor(app: App, plugin: SnipSidianPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.addClass("snipsidian-settings");
        containerEl.createEl("h2", { text: "SnipSidian Settings" });

        // ===== Advanced =====
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
                    this.plugin.settings.snippets = { ...DEFAULT_SNIPPETS, ...this.plugin.settings.snippets };
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

        // ===== Packages =====
        containerEl.createEl("h3", { text: "Packages (Espanso-compatible)" });

        const expl = containerEl.createDiv({ cls: "snipsidian-help" });
        const p1 = expl.createEl("p");
        p1.appendText("Install ready-made text expansion packages compatible with ");
        const link = p1.createEl("a", { text: "Espanso Hub", href: "https://hub.espanso.org" });
        link.setAttr("target", "_blank");
        p1.appendText(". Use the built-in catalog below or paste YAML from the package's Source page.");
        const p2 = expl.createEl("p");
        p2.appendText("Note: Direct URL installs are disabled due to browser CORS restrictions. Open a package on the Hub → ");
        p2.appendText("Source → copy the contents of ");
        p2.appendText("package.yml");
        p2.appendText(" and paste it here.");

        let selectedPkgId = PACKAGE_CATALOG[0]?.id ?? "";
        let overwritePkg = false;

        let folderLabelTouched = false;
        let folderLabel = PACKAGE_CATALOG.find((p) => p.id === selectedPkgId)?.label ?? "Package";
        let folderInputEl: HTMLInputElement | undefined;

        const pkgRow = new Setting(containerEl)
            .setName("Install from catalog")
            .setDesc("Select a package and install it into a folder.");

        pkgRow.addDropdown((dd) => {
            PACKAGE_CATALOG.forEach((p) => dd.addOption(p.id, p.label));
            if (selectedPkgId) dd.setValue(selectedPkgId);
            dd.onChange((v) => {
                selectedPkgId = v;
                if (!folderLabelTouched) {
                    folderLabel = PACKAGE_CATALOG.find((p) => p.id === v)?.label ?? "Package";
                    if (folderInputEl) folderInputEl.value = folderLabel;
                }
            });
        });

        pkgRow
            .addText((t) => {
                t.setPlaceholder("Folder label (e.g. Obsidian Callouts)")
                    .setValue(folderLabel)
                    .onChange((v) => {
                        folderLabelTouched = true;
                        folderLabel = v;
                    });
                folderInputEl = t.inputEl;
            })
            .setDesc("This label is shown in the UI; keys are stored under a slug derived from it.");

        pkgRow.addToggle((tg) =>
            tg
                .setTooltip("Overwrite existing triggers (package values win on conflict)")
                .setValue(overwritePkg)
                .onChange((v) => (overwritePkg = v))
        );

        pkgRow.addButton((b) =>
            b
                .setButtonText("Install")
                .setCta()
                .setTooltip("Install the selected package")
                .onClick(async () => {
                    const item = PACKAGE_CATALOG.find((p) => p.id === selectedPkgId);
                    if (!item) {
                        new Notice("Package not found");
                        return;
                    }
                    try {
                        if (item.kind !== "builtin") {
                            new Notice("Only built-in catalog items are supported here.");
                            return;
                        }
                        const yamlText = item.yaml ?? "";
                        const parsed = espansoYamlToSnippets(yamlText);
                        const groupKey = slugifyGroup(folderLabel) || "package";
                        const withPrefix: Record<string, string> = Object.fromEntries(
                            Object.entries(parsed).map(([k, v]) => [`${groupKey}/${k}`, v])
                        );
                        await applySnippetsMerge(withPrefix, overwritePkg);
                    } catch (e) {
                        console.error(e);
                        new Notice("Failed to install package");
                    }
                })
        );

        // Paste YAML
        let pastedYaml = "";
        let yamlFolderLabel = "";
        let yamlOverwrite = false;

        const pasteRow = new Setting(containerEl)
            .setName("Install from YAML")
            .setDesc("Paste Espanso YAML here, choose a folder label, and click Install.");

        pasteRow.addText((t) => {
            t.setPlaceholder("Folder label (e.g. Obsidian Callouts)").onChange((v) => {
                yamlFolderLabel = v;
                if (installYamlBtn) installYamlBtn.setDisabled(!yamlFolderLabel.trim());
            });
        });

        pasteRow.addTextArea((ta) => {
            ta.setPlaceholder('matches:\n  - trigger: ":brb"\n    replace: "be right back"\n');
            ta.onChange((v) => (pastedYaml = v));
            ta.inputEl.rows = 6;
        });

        pasteRow.addToggle((tg) =>
            tg.setTooltip("Overwrite existing triggers (incoming values win on conflict)").onChange((v) => (yamlOverwrite = v))
        );

        let installYamlBtn: import("obsidian").ButtonComponent | null = null;
        pasteRow.addButton((b) => {
            installYamlBtn = b;
            b.setButtonText("Install pasted YAML")
                .setCta()
                .setDisabled(true)
                .setTooltip("Convert pasted YAML and install into the chosen folder")
                .onClick(async () => {
                    try {
                        const label = yamlFolderLabel.trim();
                        if (!label) {
                            new Notice("Please provide a folder label.");
                            return;
                        }
                        const parsed = espansoYamlToSnippets(pastedYaml || "");
                        if (!Object.keys(parsed).length) {
                            new Notice("No snippets found in YAML.");
                            return;
                        }
                        const groupKey = slugifyGroup(label) || "package";
                        const withPrefix: Record<string, string> = Object.fromEntries(
                            Object.entries(parsed).map(([k, v]) => [`${groupKey}/${k}`, v])
                        );
                        await applySnippetsMerge(withPrefix, yamlOverwrite);
                    } catch (e) {
                        console.error(e);
                        new Notice("Failed to parse or install YAML");
                    }
                });
        });

        // helper: merge + save + refresh
        const applySnippetsMerge = async (incoming: Record<string, string>, overwriteToggle: boolean) => {
            if (!incoming || !Object.keys(incoming).length) {
                new Notice("No snippets found in package");
                return;
            }
            const diff = diffIncoming(incoming, this.plugin.settings.snippets);

            if (diff.conflicts.length === 0) {
                const before = Object.keys(this.plugin.settings.snippets).length;
                const next = overwriteToggle
                    ? { ...this.plugin.settings.snippets, ...incoming }
                    : { ...incoming, ...this.plugin.settings.snippets };
                this.plugin.settings.snippets = next;
                await this.plugin.saveSettings();
                const after = Object.keys(this.plugin.settings.snippets).length;
                new Notice(`Installed ${Object.keys(incoming).length} snippet(s) (+${after - before}).`);
                this.display();
                return;
            }

            const modal = new PackagePreviewModal(this.app, this.plugin, "Preview package changes", diff);
            modal.onConfirm = async (resolvedMap) => {
                this.plugin.settings.snippets = resolvedMap;
                await this.plugin.saveSettings();
                new Notice(`Installed ${diff.added.length} new; resolved ${diff.conflicts.length} conflict(s).`);
                this.display();
            };
            modal.open();
        };

        // ===== Snippets =====
        containerEl.createEl("h3", { text: "Snippets" });

        // Search row
        const searchSetting = new Setting(containerEl).setName("Search").setDesc("Filter by trigger or replacement text.");
        searchSetting.addText((t) =>
            t.setPlaceholder("Type to filter…").onChange((q) => {
                this.searchQuery = q.trim().toLowerCase();
                renderList();
            })
        );

        // Selection mode row
        let selectionToggle: import("obsidian").ToggleComponent | undefined;
        new Setting(containerEl)
            .setName("Selection mode")
            .setDesc("Enable multi-select (checkboxes) to perform bulk actions. Use group checkboxes for “Select all”.")
            .addToggle((tg) => {
                selectionToggle = tg;
                tg.setTooltip("Enable selection mode to pick multiple snippets")
                    .setValue(this.selectionMode)
                    .onChange((v) => {
                        this.selectionMode = v;
                        if (!v) this.selected.clear();
                        renderList();
                    });
            });

        const listEl = containerEl.createDiv();

        const renderList = () => {
            listEl.empty();

            // Bulk bar
            const renderBulkBar = () => {
                if (!this.selectionMode) return;
                const bar = listEl.createDiv({ cls: "snipsidian-bulkbar" });

                const left = bar.createDiv({ cls: "snipsidian-bulk-left" });
                left.createSpan({ text: `${this.selected.size} selected` });

                const middle = bar.createSpan();
                (middle as HTMLSpanElement).style.flex = "1";

                const exitBtn = bar.createEl("button", { text: "Exit selection" });
                exitBtn.onclick = () => {
                    this.selectionMode = false;
                    this.selected.clear();
                    selectionToggle?.setValue(false);
                    renderList();
                };

                const delBtn = bar.createEl("button", { text: `Delete (${this.selected.size})` });
                delBtn.disabled = this.selected.size === 0;
                delBtn.onclick = async () => {
                    if (this.selected.size === 0) return;
                    const n = this.selected.size;
                    if (!confirm(`Delete ${n} selected snippet(s)?`)) return;
                    for (const k of this.selected) delete this.plugin.settings.snippets[k];
                    await this.plugin.saveSettings();
                    this.selected.clear();
                    renderList();
                    new Notice(`Deleted ${n} snippet(s).`);
                };
            };
            renderBulkBar();

            // Filter + group by prefix
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

                const hdr = listEl.createDiv({ cls: "snipsidian-group-header" });
                const toggle = hdr.createEl("button", { text: this.groupOpen.get(group) ? "▾" : "▸" });
                toggle.addEventListener("click", () => {
                    this.groupOpen.set(group, !this.groupOpen.get(group));
                    renderList();
                });

                if (this.selectionMode) {
                    const cb = document.createElement("input");
                    cb.type = "checkbox";
                    cb.classList.add("snipsidian-group-checkbox");
                    const keysInGroup = items.map(([k]) => k);
                    const allSelected = keysInGroup.every((k) => this.selected.has(k));
                    const someSelected = !allSelected && keysInGroup.some((k) => this.selected.has(k));
                    cb.checked = allSelected;
                    cb.indeterminate = someSelected;
                    cb.title = "Select all in group";
                    cb.onchange = () => {
                        if (cb.checked) keysInGroup.forEach((k) => this.selected.add(k));
                        else keysInGroup.forEach((k) => this.selected.delete(k));
                        renderList();
                    };
                    hdr.insertAdjacentElement("beforeend", cb);
                }

                const title = group === "Ungrouped" ? "Ungrouped" : displayGroupTitle(group);
                hdr.createEl("span", { text: ` ${title} (${items.length})` });

                if (!this.groupOpen.get(group)) continue;

                items.forEach(([trigger, replacement]) => {
                    const row = new Setting(listEl);

                    if (this.selectionMode) {
                        const cb = document.createElement("input");
                        cb.type = "checkbox";
                        cb.classList.add("snipsidian-row-checkbox");
                        cb.checked = this.selected.has(trigger);
                        cb.onchange = () => {
                            if (cb.checked) this.selected.add(trigger);
                            else this.selected.delete(trigger);
                            renderList(); // <-- обновляем счётчик и tri-state в хедере
                        };
                        row.controlEl.insertAdjacentElement("afterbegin", cb);
                    }

                    let currentKey = trigger;
                    const { group: grp, name: tail } = splitKey(trigger);

                    row.addText((t) =>
                        t
                            .setPlaceholder("trigger")
                            .setValue(tail)
                            .onChange(async (rawTail) => {
                                const newTail = normalizeTrigger(rawTail);
                                if (!newTail) return;

                                const newKey = joinKey(grp, newTail);
                                if (newKey === currentKey) return;
                                if (isBadTrigger(newTail)) {
                                    new Notice("Trigger cannot be empty or contain spaces/punctuation");
                                    (t.inputEl as HTMLInputElement).value = splitKey(currentKey).name;
                                    return;
                                }

                                const map = this.plugin.settings.snippets;
                                const val = map[currentKey];
                                delete map[currentKey];

                                if (this.selected.has(currentKey)) {
                                    this.selected.delete(currentKey);
                                    this.selected.add(newKey);
                                }

                                if (newKey in map) {
                                    new Notice(`Trigger "${newKey}" already exists`);
                                    map[currentKey] = val;
                                    (t.inputEl as HTMLInputElement).value = splitKey(currentKey).name;
                                    return;
                                }
                                map[newKey] = val;
                                currentKey = newKey;
                                await this.plugin.saveSettings();
                                renderList();
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
