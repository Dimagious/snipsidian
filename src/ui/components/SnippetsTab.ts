import { App, Notice, Setting } from "obsidian";
import type SnipSidianPlugin from "../../main";
import { normalizeTrigger, isBadTrigger, splitKey, joinKey, displayGroupTitle } from "../../services/utils";
import { GroupManager } from "../utils/group-utils";
import { UIStateManager } from "../utils/ui-state";
import { AddSnippetModal, GroupPickerModal, TextPromptModal } from "./Modals";

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
        // Main Snippet Manager section
        const managerSection = root.createDiv({ cls: "snipsy-section snipsy-snippet-manager" });
        managerSection.createEl("h3", { text: "Snippet Manager" });
        managerSection.createEl("p", { text: "Manage your text expansion snippets with search, bulk operations, and organization tools", cls: "snipsy-hint" });

        // Search subsection
        const searchSubsection = managerSection.createDiv({ cls: "snipsy-subsection" });
        searchSubsection.createEl("h4", { text: "Search & Filter" });
        
        new Setting(searchSubsection)
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

        // Controls subsection
        const controlsSubsection = managerSection.createDiv({ cls: "snipsy-subsection" });
        controlsSubsection.createEl("h4", { text: "Management Tools" });
        
        // Selection mode and group controls in one row
        const controlsRow = controlsSubsection.createDiv({ cls: "snipsy-controls-row" });
        
        // Selection mode
        const selectionModeDiv = controlsRow.createDiv({ cls: "snipsy-control-item" });
        new Setting(selectionModeDiv)
            .setName("Selection Mode")
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
        const groupControlsDiv = controlsRow.createDiv({ cls: "snipsy-control-item" });
        new Setting(groupControlsDiv)
            .setName("Expand All Groups")
            .setDesc("Toggle all groups open/closed")
            .addToggle((toggle) => {
                // Check if all groups are open
                const groups = this.groupManager.allGroupsFrom(this.plugin.settings.snippets);
                const allOpen = groups.length > 0 && groups.every(group => this.uiState.loadOpenState(group, true));
                toggle.setValue(allOpen);
                
                toggle.onChange((value) => {
                    groups.forEach((group) => {
                        this.uiState.setGroupOpen(group, value);
                    });
                    this.renderSnippetList(root);
                });
            });

        // Add new snippet button in management tools
        const addSnippetDiv = controlsSubsection.createDiv({ cls: "snipsy-add-snippet" });
        new Setting(addSnippetDiv)
            .setName("Add New Snippet")
            .setDesc("Create a new text expansion snippet")
            .addButton((btn) => {
                btn.setButtonText("Add New Snippet");
                btn.setCta();
                btn.onClick(() => {
                    this.showAddSnippetModal();
                });
            });

        // Snippets subsection (created once)
        const snippetsSubsection = managerSection.createDiv({ cls: "snipsy-subsection" });
        snippetsSubsection.createEl("h4", { text: "Your Snippets" });
        const listEl = snippetsSubsection.createDiv({ cls: "snippet-list" });
        
        // Render snippet list content
        this.renderSnippetListContent(listEl, root);
    }

    private renderSnippetList(root: HTMLElement) {
        // Find existing list container
        const listEl = root.querySelector(".snippet-list");
        if (!listEl) return;

        // Clear existing content
        listEl.empty();

        // Render bulk operations if in selection mode and items are selected
        if (this.uiState.getSelectionMode() && this.uiState.getSelected().size > 0) {
            this.renderBulkOperations(listEl as HTMLElement, root);
        }

        // Render snippet list content
        this.renderSnippetListContent(listEl as HTMLElement, root);
    }

    private renderSnippetListContent(listEl: HTMLElement, root: HTMLElement) {

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
            
            // Select all checkbox (in selection mode)
            if (this.uiState.getSelectionMode()) {
                const selectAllCb = actions.createEl("input", { type: "checkbox" });
                selectAllCb.checked = items.every(([key]) => this.uiState.getSelected().has(key));
                selectAllCb.onchange = () => {
                    if (selectAllCb.checked) {
                        items.forEach(([key]) => this.uiState.getSelected().add(key));
                    } else {
                        items.forEach(([key]) => this.uiState.getSelected().delete(key));
                    }
                    // Re-render to update bulk operations section
                    this.renderSnippetList(root);
                };
                selectAllCb.title = "Select all in group";
            }
            
            // Rename group
            const renameBtn = actions.createEl("button", { 
                text: "✏️", 
                cls: "group-action-btn rename-btn",
                title: "Rename group"
            });
            renameBtn.onclick = () => {
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
            const deleteBtn = actions.createEl("button", { 
                text: "🗑️", 
                cls: "group-action-btn delete-btn",
                title: "Delete group"
            });
            deleteBtn.onclick = () => {
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
                    const { name: triggerName } = splitKey(trigger);
                    row.setName(triggerName);
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
                            // Re-render to update bulk operations section
                            this.renderSnippetList(root);
                        };
                        row.controlEl.insertAdjacentElement("afterbegin", cb);
                    }

                    // Action buttons container
                    const actionsContainer = row.controlEl.createDiv({ cls: "snippet-actions" });
                    
                    // Edit button
                    const editBtn = actionsContainer.createEl("button", { 
                        text: "✏️", 
                        cls: "snippet-action edit-btn",
                        title: "Edit snippet"
                    });
                    
                    // Delete button
                    const deleteBtn = actionsContainer.createEl("button", { 
                        text: "🗑️", 
                        cls: "snippet-action delete-btn",
                        title: "Delete snippet"
                    });
                    
                    // Edit mode state
                    let isEditing = false;
                    let originalTrigger = triggerName;
                    let originalReplacement = replacement;
                    
                    // Edit button click handler
                    editBtn.onclick = () => {
                        if (isEditing) {
                            // Save changes
                            this.saveSnippetChanges(row, trigger, originalTrigger, originalReplacement, root);
                        } else {
                            // Enter edit mode
                            this.enterEditMode(row, trigger, triggerName, replacement, editBtn);
                            isEditing = true;
                        }
                    };
                    
                    // Delete button click handler
                    deleteBtn.onclick = async () => {
                        if (confirm(`Delete snippet "${triggerName}"?`)) {
                            delete this.plugin.settings.snippets[trigger];
                            await this.plugin.saveSettings();
                            this.renderSnippetList(root);
                        }
                    };
                }
            }
        }

    }

    private renderBulkOperations(container: HTMLElement, root: HTMLElement) {
        const bulkControls = container.createDiv({ cls: "snipsy-section snipsy-bulk-operations" });
        bulkControls.createEl("h3", { text: "Bulk Operations" });

        const selectedCount = this.uiState.getSelected().size;
        
        new Setting(bulkControls)
            .setName(`Selected: ${selectedCount} snippet${selectedCount === 1 ? '' : 's'}`)
            .setDesc("Perform actions on selected snippets")
            .addButton((btn) => {
                btn.setButtonText("📁 Move to...");
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


    private showAddSnippetModal() {
        const modal = new AddSnippetModal(this.app, (snippet) => {
            if (snippet.trigger && snippet.replacement) {
                const key = snippet.group 
                    ? `${snippet.group}/${snippet.trigger}`
                    : snippet.trigger;
                
                this.plugin.settings.snippets[key] = snippet.replacement;
                this.plugin.saveSettings();
                
                // Refresh the list
                const root = document.querySelector('.snipsidian-settings');
                if (root) {
                    this.renderSnippetList(root as HTMLElement);
                }
            }
        });
        modal.open();
    }

    private enterEditMode(row: Setting, trigger: string, triggerName: string, replacement: string, editBtn: HTMLButtonElement) {
        // Clear existing controls
        row.controlEl.empty();
        
        // Debug: log the values
        console.log("Entering edit mode:", { trigger, triggerName, replacement });
        
        // Add trigger input
        const triggerInput = row.controlEl.createEl("input", {
            type: "text",
            value: triggerName || "",
            placeholder: "Trigger",
            cls: "snippet-edit-input"
        });
        
        // Add replacement textarea
        const replacementInput = row.controlEl.createEl("textarea", {
            value: replacement || "",
            placeholder: "Replacement",
            cls: "snippet-edit-textarea"
        });
        
        // Add action buttons
        const actionsContainer = row.controlEl.createDiv({ cls: "snippet-actions" });
        
        const saveBtn = actionsContainer.createEl("button", { 
            text: "💾", 
            cls: "snippet-action save-btn",
            title: "Save changes"
        });
        
        const cancelBtn = actionsContainer.createEl("button", { 
            text: "❌", 
            cls: "snippet-action cancel-btn",
            title: "Cancel editing"
        });
        
        // Update edit button
        editBtn.textContent = "💾";
        editBtn.title = "Save changes";
        
        // Store references for save/cancel
        (row as any).editData = {
            trigger,
            triggerName,
            replacement,
            triggerInput,
            replacementInput,
            saveBtn,
            cancelBtn,
            editBtn
        };
        
        // Add event handlers
        saveBtn.onclick = () => {
            this.saveSnippetChanges(row, trigger, triggerName, replacement, document.querySelector('.snipsidian-settings') as HTMLElement);
        };
        
        cancelBtn.onclick = () => {
            this.cancelEditMode(row, editBtn);
        };
    }

    private async saveSnippetChanges(row: Setting, originalTrigger: string, originalTriggerName: string, originalReplacement: string, root: HTMLElement) {
        const editData = (row as any).editData;
        if (!editData) return;
        
        const newTriggerName = editData.triggerInput.value.trim();
        const newReplacement = editData.replacementInput.value.trim();
        
        // Validate trigger
        const normalized = normalizeTrigger(newTriggerName);
        if (isBadTrigger(normalized)) {
            new Notice("Invalid trigger: contains separators or is empty");
            return;
        }
        
        // Check if trigger changed
        const { group: grp } = splitKey(originalTrigger);
        const newKey = joinKey(grp, normalized);
        
        try {
            // Update snippet data
            if (newKey !== originalTrigger) {
                // Trigger changed - need to rename
                const result = this.groupManager.safeRenameKey(this.plugin.settings.snippets, originalTrigger, newKey);
                if (!result.ok) {
                    new Notice(result.reason || "Failed to rename");
                    return;
                }
                
                // Update selection
                if (this.uiState.getSelected().has(originalTrigger)) {
                    this.uiState.getSelected().delete(originalTrigger);
                    this.uiState.getSelected().add(newKey);
                }
            }
            
            // Update replacement
            this.plugin.settings.snippets[newKey] = newReplacement;
            
            await this.plugin.saveSettings();
            this.renderSnippetList(root);
            
        } catch (error) {
            new Notice("Failed to save changes");
        }
    }

    private cancelEditMode(row: Setting, editBtn: HTMLButtonElement) {
        // Reset edit button
        editBtn.textContent = "✏️";
        editBtn.title = "Edit snippet";
        
        // Clear edit data
        delete (row as any).editData;
        
        // Re-render the snippet list to return to normal view
        const root = document.querySelector('.snipsidian-settings') as HTMLElement;
        if (root) {
            this.renderSnippetList(root);
        }
    }
}
