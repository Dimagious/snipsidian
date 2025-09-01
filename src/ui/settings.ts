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
    displayGroupTitle
} from "../services/utils";

import { JSONModal, PackagePreviewModal } from "./components/Modals";

/** Settings tab: packages (Espanso), grouped snippets list, search, export/import, reveal, merge defaults, reload */
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
        containerEl.addClass("snipsidian-settings");
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

        // ===== Packages (Espanso-compatible) =====
        containerEl.createEl("h3", { text: "Packages (Espanso-compatible)" });

        // Brief explainer (no URL install due to CORS)
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

        // Folder label (human name) -> slug group key for storage
        let folderLabelTouched = false;
        let folderLabel = PACKAGE_CATALOG.find(p => p.id === selectedPkgId)?.label ?? "Package";
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
                    folderLabel = PACKAGE_CATALOG.find(p => p.id === v)?.label ?? "Package";
                    if (folderInputEl) folderInputEl.value = folderLabel;
                }
            });
        });

        // Human folder label (pretty), keys use slug(folderLabel)
        pkgRow.addText((t) => {
            t.setPlaceholder("Folder label (e.g. Obsidian Callouts)")
                .setValue(folderLabel)
                .onChange((v) => { folderLabelTouched = true; folderLabel = v; });
            folderInputEl = t.inputEl;
        }).setDesc("This label is shown in the UI; keys are stored under a slug derived from it.");

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

                        // prefix triggers with slug(folder label)
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

        // Paste YAML area (Espanso package.yml)
        // ⬇️ REPLACE FROM HERE: "Install from YAML" block
        // Paste YAML area (Espanso package.yml) — with required Folder label
        let pastedYaml = "";
        let yamlFolderLabel = "";
        let yamlOverwrite = false;

        const pasteRow = new Setting(containerEl)
            .setName("Install from YAML")
            .setDesc("Paste Espanso YAML here, choose a folder label, and click Install.");

        // 1) Folder label (required). Keys will be stored under slug(label)/<trigger>
        pasteRow.addText((t) => {
            t.setPlaceholder("Folder label (e.g. Obsidian Callouts)")
                .onChange((v) => {
                    yamlFolderLabel = v;
                    // enable/disable install button below when user types
                    if (installYamlBtn) installYamlBtn.setDisabled(!yamlFolderLabel.trim());
                });
        });

        // 2) YAML textarea
        pasteRow.addTextArea((ta) => {
            ta.setPlaceholder('matches:\n  - trigger: ":brb"\n    replace: "be right back"\n');
            ta.onChange((v) => (pastedYaml = v));
            ta.inputEl.rows = 6;
        });

        // 3) Overwrite toggle (same semantics as catalog)
        pasteRow.addToggle((tg) =>
            tg
                .setTooltip("Overwrite existing triggers (incoming values win on conflict)")
                .onChange((v) => (yamlOverwrite = v))
        );

        // 4) Install button (disabled until folder label is provided)
        let installYamlBtn: import("obsidian").ButtonComponent | null = null;
        pasteRow.addButton((b) => {
            installYamlBtn = b;
            b.setButtonText("Install pasted YAML")
                .setCta()
                .setDisabled(true) // until folder label is non-empty
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

                        // prefix all triggers with slug(folder label)
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
        // ⬆️ REPLACE UNTIL HERE


        // helper: merge + save + refresh
        const applySnippetsMerge = async (incoming: Record<string, string>, overwriteToggle: boolean) => {
            if (!incoming || !Object.keys(incoming).length) {
                new Notice("No snippets found in package");
                return;
            }

            // Diff first
            const diff = diffIncoming(incoming, this.plugin.settings.snippets);

            // If there are no conflicts and the user enabled overwriteToggle, we will add them anyway (speeding up UX)
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

            // Open preview modal to resolve conflicts item-by-item
            const modal = new PackagePreviewModal(this.app, this.plugin, "Preview package changes", diff);
            modal.onConfirm = async (resolvedMap) => {
                this.plugin.settings.snippets = resolvedMap;
                await this.plugin.saveSettings();
                new Notice(`Installed ${diff.added.length} new; resolved ${diff.conflicts.length} conflict(s).`);
                this.display();
            };
            modal.open();
        };

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

                const title = group === "Ungrouped" ? "Ungrouped" : displayGroupTitle(group);
                hdr.createEl("span", { text: ` ${title} (${items.length})` });

                if (!this.groupOpen.get(group)) continue;

                // Items
                items.forEach(([trigger, replacement]) => {
                    const row = new Setting(listEl);
                    let currentKey = trigger;

                    const { group: grp, name: tail } = splitKey(trigger);

                    // input only for tail (no visual prefix)
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
                                if (newKey in map) {
                                    new Notice(`Trigger "${newKey}" already exists`);
                                    map[currentKey] = val; // rollback
                                    (t.inputEl as HTMLInputElement).value = splitKey(currentKey).name;
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
                        ta.inputEl.rows = 2; // taller editor
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
