import { App, Notice, Platform, PluginSettingTab, Setting, Modal, TextComponent, ButtonComponent } from "obsidian";
import type SnipSidianPlugin from "../main";
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
import { JSONModal, PackagePreviewModal, GroupPickerModal, TextPromptModal } from "./components/Modals";

type SnippetMap = Record<string, string>;
type GroupKey = string; // '' means Ungrouped

export class SnipSidianSettingTab extends PluginSettingTab {
    plugin: SnipSidianPlugin;

    // UI state
    private groupOpen = new Map<string, boolean>();
    private searchQuery = "";

    // selection mode
    private selectionMode = false;
    private selected = new Set<string>();

    constructor(app: App, plugin: SnipSidianPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    // ---- helpers (local, UI-level) ----
    private ensureUiState() {
        const anySettings = this.plugin.settings as any;
        if (!anySettings.ui) anySettings.ui = {};
        if (!anySettings.ui.groupOpen) anySettings.ui.groupOpen = {};
    }
    private loadOpenState(group: string, defaultOpen = true): boolean {
        this.ensureUiState();
        const store = (this.plugin.settings as any).ui.groupOpen as Record<string, boolean>;
        if (store[group] === undefined) store[group] = defaultOpen;
        return store[group];
    }
    private saveOpenState(group: string, open: boolean) {
        this.ensureUiState();
        const store = (this.plugin.settings as any).ui.groupOpen as Record<string, boolean>;
        store[group] = open;
    }

    private allGroupsFrom(map: SnippetMap): GroupKey[] {
        const s = new Set<string>();
        for (const k of Object.keys(map)) {
            const g = k.includes("/") ? k.split("/", 1)[0] : "Ungrouped";
            s.add(g);
        }
        return Array.from(s).sort((a, b) => a.localeCompare(b));
    }

    private safeRenameKey(map: SnippetMap, oldKey: string, newKey: string): { ok: boolean; reason?: string } {
        if (oldKey === newKey) return { ok: true };
        if (newKey in map) return { ok: false, reason: `Trigger "${newKey}" already exists` };
        const val = map[oldKey];
        if (val === undefined) return { ok: false, reason: "Original key missing" };
        delete map[oldKey];
        map[newKey] = val;
        // keep selection
        if (this.selected.has(oldKey)) {
            this.selected.delete(oldKey);
            this.selected.add(newKey);
        }
        return { ok: true };
    }

    private bulkMoveKeys(targetGroup: GroupKey, keys: string[]): { moved: number; skipped: number } {
        const map = this.plugin.settings.snippets;
        // pre-check conflicts to avoid half-applied state
        let skipped = 0;
        const ops: Array<{ oldKey: string; newKey: string }> = [];
        for (const k of keys) {
            const { name } = splitKey(k);
            const newKey = targetGroup ? `${targetGroup}/${name}` : name;
            if (newKey in map && !keys.includes(newKey)) {
                skipped++;
                continue;
            }
            ops.push({ oldKey: k, newKey });
        }
        let moved = 0;
        for (const { oldKey, newKey } of ops) {
            if (oldKey === newKey) continue;
            const r = this.safeRenameKey(map, oldKey, newKey);
            if (r.ok) moved++;
            else skipped++;
        }
        return { moved, skipped };
    }

    private promptNewGroup(initial = ""): GroupKey | null {
        const label = window.prompt("Folder name (pretty label). Leave empty for Ungrouped:", initial ?? "");
        if (label === null) return null; // cancelled
        const slug = slugifyGroup(label);
        return slug || ""; // '' -> Ungrouped
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        if (!containerEl.classList.contains("snipsidian-settings")) {
            containerEl.addClass("snipsidian-settings");
        }

        containerEl.createEl("h2", { text: "Snipsy – Snippet Manager" });

        const debounce = <T extends (...a: any[]) => any>(fn: T, ms: number) => {
            let t: number | undefined;
            return (...args: Parameters<T>) => {
                if (t) window.clearTimeout(t);
                t = window.setTimeout(() => fn(...args), ms) as unknown as number;
            };
        };

        const saveSoft = debounce(async () => {
            await this.plugin.saveSettings();
        }, 400);

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
            .setDesc("Open the raw data.json file that stores all snippets (advanced users).")
            .addButton((b) =>
                b.setButtonText("Reveal").onClick(async () => {
                    try {
                        if (!Platform.isDesktopApp) throw new Error("Not desktop");
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const adapter: any = this.app.vault.adapter as any;
                        if (typeof adapter.getBasePath !== "function") throw new Error("Not supported on this platform");
                        const base: string = adapter.getBasePath();
                        const configDir: string = (this.app.vault as any).configDir ?? ".obsidian";
                        const path = `${base}/${configDir}/plugins/snipsidian/data.json`;
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

        // --- Search row ---
        new Setting(containerEl)
            .setName("Search")
            .setDesc("Filter by trigger or replacement text.")
            .addText((t) =>
                t.setPlaceholder("Type to filter…").onChange((q) => {
                    this.searchQuery = q.trim().toLowerCase();
                    renderList();
                })
            );

        // --- Selection mode ---
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

        // --- Groups: single toggle (expand/collapse all) ---
        const groupsRow = new Setting(containerEl)
            .setName("Groups")
            .setDesc("Expand or collapse all groups at once.");

        let groupsToggle: import("obsidian").ToggleComponent | undefined;

        const allGroups = (): string[] => this.allGroupsFrom(this.plugin.settings.snippets);

        // ensure open state exists for all current groups
        allGroups().forEach((g) => {
            if (!this.groupOpen.has(g)) this.groupOpen.set(g, this.loadOpenState(g, true));
        });

        const areAllOpen = (): boolean =>
            allGroups().every((g) => this.groupOpen.get(g) === true);

        const applyAll = (open: boolean) => {
            for (const g of allGroups()) {
                this.groupOpen.set(g, open);
                this.saveOpenState(g, open);
            }
            renderList();
            groupsToggle?.setValue(open);
        };

        groupsRow.addToggle((tg) => {
            groupsToggle = tg;
            tg.setTooltip("Toggle all groups open/closed")
                .setValue(areAllOpen())
                .onChange((v) => applyAll(v));
        });

        // ---- list mount point
        const listEl = containerEl.createDiv();

        const renderList = () => {
            listEl.empty();

            // Bulk bar
            const renderBulkBar = () => {
                if (!this.selectionMode) return;
                const bar = listEl.createDiv({ cls: "snipsidian-bulkbar" });

                const left = bar.createDiv({ cls: "snipsidian-bulk-left" });
                left.createSpan({ text: `${this.selected.size} selected` });

                bar.createSpan({ cls: "snipsy-flex-spacer" });

                // Move to...
                const moveBtn = bar.createEl("button", { text: "Move to…" });
                moveBtn.disabled = this.selected.size === 0;
                moveBtn.onclick = () => {
                    if (this.selected.size === 0) return;
                    const groups = this.allGroupsFrom(this.plugin.settings.snippets).filter(
                        (g) => g !== "Ungrouped"
                    );
                    const modal = new GroupPickerModal(this.app, {
                        title: `Move ${this.selected.size} snippet(s) to…`,
                        groups,
                        allowUngrouped: true,
                    });
                    modal.onSubmit = async (target) => {
                        if (target === null) return;
                        const { moved, skipped } = this.bulkMoveKeys(
                            target,
                            Array.from(this.selected)
                        );
                        await this.plugin.saveSettings();
                        const openKey = target || "Ungrouped";
                        this.groupOpen.set(openKey, true);
                        this.saveOpenState(openKey, true);
                        renderList();
                        new Notice(
                            `Moved ${moved} item(s)${skipped ? `, skipped ${skipped} (conflicts)` : ""}.`
                        );
                    };
                    modal.open();
                };

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
                });

            if (!entries.length) {
                const empty = listEl.createDiv({ text: "No snippets match the filter." });
                empty.addClass("snipsidian-empty");
                return;
            }

            // Build groups
            const groups = new Map<string, Array<[string, string]>>();
            for (const e of entries) {
                const [k] = e;
                const group = k.includes("/") ? k.split("/", 1)[0] : "Ungrouped";
                if (!groups.has(group)) groups.set(group, []);
                groups.get(group)!.push(e);
            }

            // ensure groupOpen has defaults (and persisted values)
            for (const g of groups.keys()) {
                if (!this.groupOpen.has(g)) this.groupOpen.set(g, this.loadOpenState(g, false));
            }

            for (const [group, items] of groups) {
                // Header
                const hdr = listEl.createDiv({ cls: "snipsidian-group-header" });
                const toggleBtn = hdr.createEl("button", { text: this.groupOpen.get(group) ? "▾" : "▸" });
                toggleBtn.addEventListener("click", () => {
                    const next = !this.groupOpen.get(group);
                    this.groupOpen.set(group, next);
                    this.saveOpenState(group, next);
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

                // Group actions (rename / delete)
                if (group !== "Ungrouped") {
                    const actions = hdr.createDiv({ cls: "snipsidian-group-actions" });

                    const renameBtn = actions.createEl("button", { text: "Rename" });
                    renameBtn.onclick = (ev) => {
                        ev.preventDefault();
                        ev.stopPropagation();

                        new TextPromptModal(this.app, {
                            title: "Rename group",
                            initial: title,
                            placeholder: "New group name",
                            cta: "Rename",
                            validate: (v) => {
                                const slug = slugifyGroup(v);
                                if (!slug) return "Name cannot be empty.";
                                if (slug === group) return "Name is unchanged.";
                                const exists = Object.keys(this.plugin.settings.snippets).some(k =>
                                    k.startsWith(slug + "/")
                                );
                                return exists ? `Group "${displayGroupTitle(slug)}" already exists.` : null;
                            },
                            onSubmit: async (newLabel) => {
                                const newSlug = slugifyGroup(newLabel);
                                const map = this.plugin.settings.snippets;

                                for (const [k] of items) {
                                    const { name } = splitKey(k);
                                    const newKey = `${newSlug}/${name}`;
                                    if (newKey in map && !items.find(([kk]) => kk === newKey)) {
                                        new Notice(`Conflict for "${newKey}". Rename aborted.`);
                                        return;
                                    }
                                }

                                let moved = 0;
                                for (const [k] of items) {
                                    const { name } = splitKey(k);
                                    const newKey = `${newSlug}/${name}`;
                                    const r = this.safeRenameKey(map, k, newKey);
                                    if (r.ok) moved++;
                                }
                                await this.plugin.saveSettings();

                                this.groupOpen.delete(group);
                                this.saveOpenState(group, undefined as unknown as boolean);
                                this.groupOpen.set(newSlug, true);
                                this.saveOpenState(newSlug, true);

                                renderList();
                                new Notice(`Renamed group to "${displayGroupTitle(newSlug)}" (${moved} moved).`);
                            }
                        }).open();
                    };


                    const deleteBtn = actions.createEl("button", { text: "Delete group" });
                    deleteBtn.onclick = async (ev) => {
                        ev.preventDefault();
                        ev.stopPropagation(); // <-- и здесь, чтобы клик не сворачивал группу
                        if (items.length === 0) {
                            this.groupOpen.delete(group);
                            this.saveOpenState(group, undefined as unknown as boolean);
                            renderList();
                            return;
                        }
                        const choice = window.confirm(
                            `Delete group "${title}" with ${items.length} snippet(s)?\n` +
                            "OK = Delete all,  Cancel = Move to another folder…"
                        );
                        if (choice) {
                            // delete all
                            for (const [k] of items) delete this.plugin.settings.snippets[k];
                            await this.plugin.saveSettings();
                            this.groupOpen.delete(group);
                            this.saveOpenState(group, undefined as unknown as boolean);
                            renderList();
                            new Notice(`Deleted ${items.length} snippet(s) from "${title}".`);
                        } else {
                            // move to…
                            const newG = this.promptNewGroup("");
                            if (newG === null) return;
                            const { moved, skipped } = this.bulkMoveKeys(newG, items.map(([k]) => k));
                            await this.plugin.saveSettings();
                            this.groupOpen.set(newG || "Ungrouped", true);
                            this.saveOpenState(newG || "Ungrouped", true);
                            renderList();
                            new Notice(
                                `Moved ${moved} from "${title}" to "${displayGroupTitle(newG || "Ungrouped")}"` +
                                (skipped ? `, skipped ${skipped} (conflicts)` : "")
                            );
                        }
                    };
                }

                if (!this.groupOpen.get(group)) continue;

                // Items
                const existingGroups = Array.from(groups.keys()).filter((g) => g !== group && g !== "Ungrouped").sort();

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
                            renderList();
                        };
                        row.controlEl.insertAdjacentElement("afterbegin", cb);
                    }

                    let currentKey = trigger;
                    const { group: grp, name: tail } = splitKey(trigger);

                    // per-row group selector
                    row.addDropdown((dd) => {
                        dd.addOption("", "Ungrouped");
                        const all = this.allGroupsFrom(this.plugin.settings.snippets).filter((g) => g !== "Ungrouped");
                        for (const g of all) dd.addOption(g, displayGroupTitle(g));
                        dd.addOption("__new__", "New group…");
                        dd.setValue(grp || "");
                        dd.onChange(async (val) => {
                            if (val === "__new__") {
                                const ng = this.promptNewGroup("");
                                if (ng === null) {
                                    dd.setValue(grp || "");
                                    return;
                                }
                                await moveTo(ng);
                                dd.setValue(ng || "");
                            } else {
                                await moveTo(val);
                            }
                        });

                        const moveTo = async (targetGroup: GroupKey) => {
                            const newKey = targetGroup ? `${targetGroup}/${tail}` : tail;
                            if (newKey === currentKey) return;
                            if (newKey in this.plugin.settings.snippets) {
                                new Notice(`Trigger "${newKey}" already exists`);
                                dd.setValue(grp || "");
                                return;
                            }
                            const r = this.safeRenameKey(this.plugin.settings.snippets, currentKey, newKey);
                            if (!r.ok) {
                                new Notice(r.reason ?? "Failed to move");
                                dd.setValue(grp || "");
                                return;
                            }
                            currentKey = newKey;
                            this.groupOpen.set(targetGroup || "Ungrouped", true);
                            this.saveOpenState(targetGroup || "Ungrouped", true);
                            await this.plugin.saveSettings();
                            renderList();
                        };
                    });

                    // --- trigger input ---
                    row.addText((t) => {
                        t.setPlaceholder("trigger")
                            .setValue(tail)
                            .onChange((rawTail) => {
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
                            });
                        t.inputEl.addEventListener("blur", () => { saveSoft(); });
                    });

                    row.addTextArea((ta) => {
                        ta.setPlaceholder("replacement (e.g. be right back)")
                            .setValue(replacement)
                            .onChange((val) => {
                                this.plugin.settings.snippets[currentKey] = val;
                            });

                        ta.inputEl.rows = 2;
                        ta.inputEl.addEventListener("blur", () => { saveSoft(); });
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

            // Add snippet button
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
