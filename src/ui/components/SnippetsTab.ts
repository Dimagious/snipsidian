import { App, Notice, Setting } from "obsidian";
import type SnipSidianPlugin from "../../main";
import { normalizeTrigger, isBadTrigger, splitKey, joinKey, displayGroupTitle } from "../../services/utils";
import { GroupManager } from "../utils/group-utils";
import { UIStateManager } from "../utils/ui-state";
import { GroupPickerModal, TextPromptModal } from "./Modals";

export class SnippetsTab {
    private groupManager: GroupManager;
    private uiState: UIStateManager;

    constructor(
        private app: App,
        private plugin: SnipSidianPlugin
    ) {
        this.groupManager = new GroupManager(this.plugin.settings.snippets);
        this.uiState = new UIStateManager(this.plugin.settings);
    }

    render(root: HTMLElement) {
        const section = (title: string, hint?: string) => {
            const wrap = root.createDiv({ cls: "snipsy-section" });
            wrap.createEl("h3", { text: title });
            if (hint) wrap.createEl("p", { text: hint, cls: "snipsy-hint" });
            return wrap;
        };

        // Search and controls
        section("Search & Controls");

        new Setting(root)
            .setName("Search snippets")
            .setDesc("Filter snippets by trigger or replacement text")
            .addText((text) => {
                text
                    .setPlaceholder("Search...")
                    .setValue(this.uiState.getSearchQuery())
                    .onChange((value) => {
                        this.uiState.setSearchQuery(value);
                        this.renderSnippetList(root);
                    });
            });

        new Setting(root)
            .setName("Selection mode")
            .setDesc("Enable multi-select for bulk operations")
            .addToggle((toggle) => {
                toggle
                    .setValue(this.uiState.getSelectionMode())
                    .onChange((value) => {
                        this.uiState.setSelectionMode(value);
                        this.uiState.setSelected(new Set());
                        this.renderSnippetList(root);
                    });
            });

        // Group controls
        const groupControls = root.createDiv({ cls: "snipsy-section" });
        groupControls.createEl("h3", { text: "Group Controls" });

        new Setting(groupControls)
            .setName("Expand/Collapse All")
            .setDesc("Toggle all groups open/closed")
            .addButton((btn) => {
                btn.setButtonText("Expand All");
                btn.onClick(() => {
                    const groups = this.groupManager.allGroupsFrom(this.plugin.settings.snippets);
                    groups.forEach((group) => {
                        this.uiState.setGroupOpen(group, true);
                    });
                    this.renderSnippetList(root);
                });
            })
            .addButton((btn) => {
                btn.setButtonText("Collapse All");
                btn.onClick(() => {
                    const groups = this.groupManager.allGroupsFrom(this.plugin.settings.snippets);
                    groups.forEach((group) => {
                        this.uiState.setGroupOpen(group, false);
                    });
                    this.renderSnippetList(root);
                });
            });

        // Bulk operations (only show in selection mode)
        if (this.uiState.getSelectionMode()) {
            const bulkControls = root.createDiv({ cls: "snipsy-section" });
            bulkControls.createEl("h3", { text: "Bulk Operations" });

            new Setting(bulkControls)
                .setName("Move Selected")
                .setDesc(`Move ${this.uiState.getSelected().size} selected snippets`)
                .addButton((btn) => {
                    btn.setButtonText("Move to...");
                    btn.setDisabled(this.uiState.getSelected().size === 0);
                    btn.onClick(() => {
                        const groups = this.groupManager.allGroupsFrom(this.plugin.settings.snippets);
                        const modal = new GroupPickerModal(this.app, {
                            title: "Move to group:",
                            groups,
                            allowUngrouped: true
                        });
                        modal.onSubmit = (targetGroup) => {
                            if (targetGroup === null) return;
                            const keys = Array.from(this.uiState.getSelected());
                            const { moved, skipped } = this.groupManager.bulkMoveKeys(targetGroup, keys);
                            this.uiState.setSelected(new Set());
                            this.renderSnippetList(root);
                            new Notice(`Moved ${moved} item(s)${skipped ? `, skipped ${skipped} (conflicts)` : ""}.`);
                        };
                        modal.open();
                    });
                })
                .addButton((btn) => {
                    btn.setButtonText("Delete Selected");
                    btn.setDisabled(this.uiState.getSelected().size === 0);
                    btn.onClick(() => {
                        const n = this.uiState.getSelected().size;
                        if (confirm(`Delete ${n} snippet(s)?`)) {
                            for (const key of this.uiState.getSelected()) {
                                delete this.plugin.settings.snippets[key];
                            }
                            this.plugin.saveSettings();
                            this.uiState.setSelected(new Set());
                            this.renderSnippetList(root);
                            new Notice(`Deleted ${n} snippet(s).`);
                        }
                    });
                });
        }

        // Snippet list
        this.renderSnippetList(root);
    }

    private renderSnippetList(root: HTMLElement) {
        // Remove existing list
        const existingList = root.querySelector(".snippet-list");
        if (existingList) {
            existingList.remove();
        }

        const listEl = root.createDiv({ cls: "snippet-list" });
        const searchQuery = this.uiState.getSearchQuery().toLowerCase();
        const entries = Object.entries(this.plugin.settings.snippets)
            .filter(([key, value]) => 
                !searchQuery || 
                key.toLowerCase().includes(searchQuery) || 
                value.toLowerCase().includes(searchQuery)
            )
            .sort(([a], [b]) => a.localeCompare(b));

        // Group snippets
        const groups = new Map<string, Array<[string, string]>>();
        for (const e of entries) {
            const [k] = e;
            const group = k.includes("/") ? k.split("/", 1)[0] ?? "Ungrouped" : "Ungrouped";
            if (!groups.has(group)) groups.set(group, []);
            groups.get(group)!.push(e);
        }

        // Ensure groupOpen has defaults
        for (const g of groups.keys()) {
            if (!this.uiState.getGroupOpen().has(g)) {
                this.uiState.setGroupOpen(g, this.uiState.loadOpenState(g, false));
            }
        }

        // Render groups
        for (const [group, items] of groups.entries()) {
            const isOpen = this.uiState.getGroupOpen().get(group) ?? false;
            const title = group === "" ? "Ungrouped" : this.groupManager.displayGroupTitle(group);
            
            const groupEl = listEl.createDiv({ cls: "snippet-group" });
            const header = groupEl.createDiv({ cls: "group-header" });
            
            // Group toggle
            const toggle = header.createEl("button", { 
                cls: `group-toggle ${isOpen ? "open" : ""}`,
                text: isOpen ? "▼" : "▶"
            });
            toggle.onclick = () => {
                this.uiState.setGroupOpen(group, !isOpen);
                this.renderSnippetList(root);
            };

            // Group title
            header.createEl("span", { text: title, cls: "group-title" });

            // Group actions
            const actions = header.createDiv({ cls: "group-actions" });
            
            // Rename group
            actions.createEl("button", { text: "Rename", cls: "group-action" }).onclick = () => {
                const modal = new TextPromptModal(this.app, {
                    title: "Rename group:",
                    initial: title,
                    onSubmit: (newTitle) => {
                        if (!newTitle || newTitle === title) return;
                        const newSlug = newTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
                        if (newSlug === group) return;
                        
                        const { moved } = this.groupManager.bulkMoveKeys(newSlug, items.map(([k]) => k));
                        this.uiState.setGroupOpen(newSlug, isOpen);
                        this.uiState.getGroupOpen().delete(group);
                        this.renderSnippetList(root);
                        new Notice(`Renamed group to "${this.groupManager.displayGroupTitle(newSlug)}" (${moved} moved).`);
                    }
                });
                modal.open();
            };

            // Delete group
            actions.createEl("button", { text: "Delete", cls: "group-action" }).onclick = () => {
                if (confirm(`Delete group "${title}" with ${items.length} snippets?`)) {
                    for (const [key] of items) {
                        delete this.plugin.settings.snippets[key];
                    }
                    this.plugin.saveSettings();
                    this.uiState.getGroupOpen().delete(group);
                    this.renderSnippetList(root);
                    new Notice(`Deleted ${items.length} snippet(s) from "${title}".`);
                }
            };

            // Group content
            if (isOpen) {
                const content = groupEl.createDiv({ cls: "group-content" });
                
                for (const [trigger, replacement] of items) {
                    const row = new Setting(content);
                    row.setName(trigger);
                    row.setDesc(replacement);
                    
                    // Selection checkbox (in selection mode)
                    if (this.uiState.getSelectionMode()) {
                        const cb = row.controlEl.createEl("input", { type: "checkbox" });
                        cb.checked = this.uiState.getSelected().has(trigger);
                        cb.onchange = () => {
                            if (cb.checked) {
                                this.uiState.getSelected().add(trigger);
                            } else {
                                this.uiState.getSelected().delete(trigger);
                            }
                        };
                        row.controlEl.insertAdjacentElement("afterbegin", cb);
                    }

                    // Edit trigger
                    row.addText((t) => {
                        t.setValue(trigger);
                        t.onChange(async (value) => {
                            const normalized = normalizeTrigger(value);
                            if (isBadTrigger(normalized)) {
                                new Notice("Invalid trigger: contains separators or is empty");
                                return;
                            }
                            
                            const { group: grp, name: tail } = splitKey(trigger);
                            const newKey = joinKey(grp, normalized);
                            
                            if (newKey !== trigger) {
                                const result = this.groupManager.safeRenameKey(this.plugin.settings.snippets, trigger, newKey);
                                if (!result.ok) {
                                    new Notice(result.reason || "Failed to rename");
                                    t.setValue(trigger);
                                    return;
                                }
                                
                                // Update selection
                                if (this.uiState.getSelected().has(trigger)) {
                                    this.uiState.getSelected().delete(trigger);
                                    this.uiState.getSelected().add(newKey);
                                }
                                
                                await this.plugin.saveSettings();
                                this.renderSnippetList(root);
                            }
                        });
                    });

                    // Edit replacement
                    row.addTextArea((t) => {
                        t.setValue(replacement);
                        t.onChange(async (value) => {
                            this.plugin.settings.snippets[trigger] = value;
                            await this.plugin.saveSettings();
                        });
                    });

                    // Group selector
                    row.addDropdown((dd) => {
                        dd.addOption("", "Ungrouped");
                        const allGroups = this.groupManager.allGroupsFrom(this.plugin.settings.snippets);
                        for (const g of allGroups) {
                            if (g !== group) {
                                dd.addOption(g, this.groupManager.displayGroupTitle(g));
                            }
                        }
                        dd.addOption("__new__", "New group...");
                        
                        const { group: currentGroup } = splitKey(trigger);
                        dd.setValue(currentGroup);
                        
                        dd.onChange(async (value) => {
                            if (value === "__new__") {
                                const newGroup = this.groupManager.promptNewGroup();
                                if (newGroup === null) return;
                                const newKey = joinKey(newGroup, splitKey(trigger).name);
                                const result = this.groupManager.safeRenameKey(this.plugin.settings.snippets, trigger, newKey);
                                if (result.ok) {
                                    await this.plugin.saveSettings();
                                    this.renderSnippetList(root);
                                } else {
                                    new Notice(result.reason || "Failed to move");
                                }
                            } else {
                                const newKey = joinKey(value, splitKey(trigger).name);
                                const result = this.groupManager.safeRenameKey(this.plugin.settings.snippets, trigger, newKey);
                                if (result.ok) {
                                    await this.plugin.saveSettings();
                                    this.renderSnippetList(root);
                                } else {
                                    new Notice(result.reason || "Failed to move");
                                }
                            }
                        });
                    });

                    // Delete button
                    row.addButton((btn) => {
                        btn.setIcon("trash");
                        btn.setTooltip("Delete snippet");
                        btn.onClick(async () => {
                            delete this.plugin.settings.snippets[trigger];
                            await this.plugin.saveSettings();
                            this.renderSnippetList(root);
                        });
                    });
                }
            }
        }

        // Add new snippet
        const addSection = root.createDiv({ cls: "snipsy-section" });
        addSection.createEl("h3", { text: "Add New Snippet" });

        new Setting(addSection)
            .setName("Trigger")
            .setDesc("The text that will be expanded")
            .addText((text) => {
                text.setPlaceholder("e.g., :todo");
            })
            .setName("Replacement")
            .setDesc("The text that will replace the trigger")
            .addTextArea((text) => {
                text.setPlaceholder("e.g., - [ ] $|");
            })
            .addButton((btn) => {
                btn.setButtonText("Add Snippet");
                btn.setCta();
                btn.onClick(async () => {
                    const triggerInput = btn.buttonEl.parentElement?.querySelector('input[type="text"]') as HTMLInputElement;
                    const replacementInput = btn.buttonEl.parentElement?.querySelector('textarea') as HTMLTextAreaElement;
                    
                    const trigger = normalizeTrigger(triggerInput.value);
                    const replacement = replacementInput.value;
                    
                    if (isBadTrigger(trigger)) {
                        new Notice("Invalid trigger: contains separators or is empty");
                        return;
                    }
                    
                    if (!replacement.trim()) {
                        new Notice("Replacement cannot be empty");
                        return;
                    }
                    
                    this.plugin.settings.snippets[trigger] = replacement;
                    await this.plugin.saveSettings();
                    
                    triggerInput.value = "";
                    replacementInput.value = "";
                    this.renderSnippetList(root);
                });
            });
    }
}
