import { App, Notice, Setting } from "obsidian";
import type SnipSidianPlugin from "../../main";
import { normalizeTrigger, isBadTrigger, splitKey, joinKey, slugifyGroup } from "../../services/utils";
import { GroupManager } from "../utils/group-utils";
import { UIStateManager } from "../utils/ui-state";
import { AddSnippetModal, ConfirmModal, GroupPickerModal, TextPromptModal } from "./Modals";
import { hasTriggerCollision } from "../../store/snippets";

interface EditData {
    trigger: string;
    triggerName: string;
    replacement: string;
    triggerInput: HTMLInputElement;
    replacementInput: HTMLTextAreaElement;
    saveBtn: HTMLButtonElement;
    cancelBtn: HTMLButtonElement;
    editBtn: HTMLButtonElement;
}

interface SettingWithEditData extends Setting {
    editData?: EditData;
}

export class SnippetsTab {
    private groupManager: GroupManager;
    private uiState: UIStateManager;

    constructor(
        private app: App,
        private plugin: SnipSidianPlugin
    ) {
        this.groupManager = new GroupManager();
        this.uiState = new UIStateManager(this.plugin.settings, () => this.plugin.saveSettings());
    }

    render(root: HTMLElement) {
        // Main Snippet Manager section
        const managerSection = root.createDiv({ cls: "snipsy-section snipsy-snippet-manager" });
        new Setting(managerSection)
            .setHeading()
            .setName("Snippet manager")
            .setDesc("Manage your text expansion snippets with search, bulk operations, and organization tools");

        // Search subsection
        const searchSubsection = managerSection.createDiv({ cls: "snipsy-subsection" });
        new Setting(searchSubsection)
            .setHeading()
            .setName("Search & filter");
        
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
        new Setting(controlsSubsection)
            .setHeading()
            .setName("Management tools");
        
        // Selection mode and group controls in one row
        const controlsRow = controlsSubsection.createDiv({ cls: "snipsy-controls-row" });
        
        // Selection mode
        const selectionModeDiv = controlsRow.createDiv({ cls: "snipsy-control-item" });
        new Setting(selectionModeDiv)
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
        const groupControlsDiv = controlsRow.createDiv({ cls: "snipsy-control-item" });
        new Setting(groupControlsDiv)
            .setName("Expand all groups")
            .setDesc("Toggle all groups open/closed")
            .addToggle((toggle) => {
                // Check if all groups are open
                const groups = this.groupManager.allGroupsFrom(this.plugin.settings.snippets);
                const allOpen = groups.length > 0 && groups.every(group => this.uiState.loadOpenState(group, false));
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
            .setName("Add new snippet")
            .setDesc("Create a new text expansion snippet")
            .addButton((btn) => {
                btn.setButtonText("Add new snippet");
                btn.setCta();
                btn.onClick(() => {
                    this.showAddSnippetModal();
                });
            });

        // Snippets subsection (created once)
        const snippetsSubsection = managerSection.createDiv({ cls: "snipsy-subsection" });
        new Setting(snippetsSubsection)
            .setHeading()
            .setName("Your snippets");
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
            const { group } = splitKey(k);
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
            header.createSpan({ text: title, cls: "group-title" });

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
                    validate: (v) => {
                        const trimmed = v.trim();
                        if (!trimmed) return "Group name cannot be empty";
                        if (!slugifyGroup(trimmed)) return "Group name must contain at least one letter or number";
                        return null;
                    },
                    onSubmit: (newTitle) => {
                        void this.renameGroup(root, group, title, items, isOpen, newTitle);
                    },
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
                const modal = new ConfirmModal(this.app, {
                    title: "Delete group",
                    message: `Delete group "${title}" with ${items.length} snippet(s)?`,
                    confirmText: "Delete",
                    onConfirm: async () => {
                        for (const [key] of items) {
                            delete this.plugin.settings.snippets[key];
                        }
                        await this.plugin.saveSettings();
                        this.uiState.getGroupOpen().delete(group);
                        this.renderSnippetList(root);
                        new Notice(`Deleted ${items.length} snippet(s) from "${title}".`);
                    }
                });
                modal.open();
            };

            // Group content
            if (isOpen) {
                const content = groupEl.createDiv({ cls: "group-content" });
                
                for (const [trigger, replacement] of items) {
                    const row = new Setting(content);
                    const { name: triggerName } = splitKey(trigger);
                    row.setName(triggerName);
                    row.setDesc(replacement || "");
                    
                    
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
                    
                    // Edit button click handler
                    editBtn.onclick = () => {
                        if (isEditing) {
                            // Save changes
                            const root = activeDocument.querySelector('.snipsidian-settings');
                            if (root) {
                                void this.saveSnippetChanges(row, trigger, triggerName, replacement, root as HTMLElement);
                            }
                        } else {
                            // Enter edit mode
                            this.enterEditMode(row, trigger, triggerName, replacement, editBtn);
                            isEditing = true;
                        }
                    };
                    
                    // Delete button click handler
                    deleteBtn.onclick = () => {
                        const modal = new ConfirmModal(this.app, {
                            title: "Delete snippet",
                            message: `Delete snippet "${triggerName}"?`,
                            confirmText: "Delete",
                            onConfirm: async () => {
                                delete this.plugin.settings.snippets[trigger];
                                await this.plugin.saveSettings();
                                this.renderSnippetList(root);
                            }
                        });
                        modal.open();
                    };
                }
            }
        }

    }

    private renderBulkOperations(container: HTMLElement, root: HTMLElement) {
        const bulkControls = container.createDiv({ cls: "snipsy-section snipsy-bulk-operations" });
        new Setting(bulkControls)
            .setHeading()
                .setName("Bulk operations");

        const selectedCount = this.uiState.getSelected().size;
        
        new Setting(bulkControls)
            .setName(`Selected: ${selectedCount} snippet${selectedCount === 1 ? '' : 's'}`)
            .setDesc("Perform actions on selected snippets")
            .addButton((btn) => {
                 
                btn.setButtonText("Move to…");
                btn.onClick(() => {
                    const groups = this.groupManager.allGroupsFrom(this.plugin.settings.snippets);
                    const modal = new GroupPickerModal(this.app, {
                        title: "Move to group:",
                        groups,
                        allowUngrouped: true
                    });
                    modal.onSubmit = (targetGroup) => {
                        if (targetGroup === null) return;
                        void this.moveSelectedSnippets(root, targetGroup);
                    };
                    modal.open();
                });
            })
            .addButton((btn) => {
                btn.setButtonText("Delete selected");
                btn.onClick(() => {
                    const n = this.uiState.getSelected().size;
                    const modal = new ConfirmModal(this.app, {
                        title: "Delete snippets",
                        message: `Delete ${n} snippet(s)?`,
                        confirmText: "Delete",
                        onConfirm: async () => {
                            for (const key of this.uiState.getSelected()) {
                                delete this.plugin.settings.snippets[key];
                            }
                            await this.plugin.saveSettings();
                            this.uiState.setSelected(new Set());
                            this.renderSnippetList(root);
                            new Notice(`Deleted ${n} snippet(s).`);
                        }
                    });
                    modal.open();
                });
            });
    }

    private async moveSelectedSnippets(root: HTMLElement, targetGroup: string) {
        const keys = Array.from(this.uiState.getSelected());
        if (keys.length === 0) return;

        const { moved, skipped } = this.groupManager.bulkMoveKeys(this.plugin.settings.snippets, targetGroup, keys);
        if (moved === 0) {
            new Notice(`Moved 0 item(s)${skipped ? `, skipped ${skipped} (conflicts)` : ""}.`);
            return;
        }

        try {
            await this.plugin.saveSettings();
            this.uiState.setSelected(new Set());
            this.renderSnippetList(root);
            new Notice(`Moved ${moved} item(s)${skipped ? `, skipped ${skipped} (conflicts)` : ""}.`);
        } catch {
            new Notice("Failed to move snippets");
        }
    }

    private async renameGroup(
        root: HTMLElement,
        group: string,
        title: string,
        items: Array<[string, string]>,
        isOpen: boolean,
        newTitle: string
    ) {
        if (!newTitle || newTitle === title) return;

        const newSlug = slugifyGroup(newTitle);
        if (newSlug === group) return;

        const { moved, skipped } = this.groupManager.bulkMoveKeys(
            this.plugin.settings.snippets,
            newSlug,
            items.map(([k]) => k)
        );
        if (moved === 0) {
            new Notice(`Renamed group failed: no snippets moved${skipped ? `, skipped ${skipped}` : ""}.`);
            return;
        }

        try {
            await this.plugin.saveSettings();
            this.uiState.setGroupOpen(newSlug, isOpen);
            this.uiState.getGroupOpen().delete(group);
            this.renderSnippetList(root);
            const groupName = newSlug === "" ? "Ungrouped" : this.groupManager.displayGroupTitle(newSlug);
            new Notice(`Renamed group to "${groupName}" (${moved} moved${skipped ? `, skipped ${skipped}` : ""}).`);
        } catch {
            new Notice("Failed to rename group");
        }
    }


    private showAddSnippetModal() {
        const modal = new AddSnippetModal(this.app, async (snippet) => {
            if (snippet.trigger && snippet.replacement) {
                const normalizedTrigger = normalizeTrigger(snippet.trigger);
                if (isBadTrigger(normalizedTrigger)) {
                    new Notice("Invalid trigger: contains separators or is empty");
                    return;
                }
                const normalizedGroup = slugifyGroup(snippet.group);
                const key = normalizedGroup
                    ? `${normalizedGroup}/${normalizedTrigger}`
                    : normalizedTrigger;

                if (this.plugin.settings.snippets[key] !== undefined) {
                    new Notice(`Snippet "${normalizedTrigger}" already exists`);
                    return;
                }

                if (hasTriggerCollision(this.plugin.settings, normalizedTrigger, key)) {
                    new Notice(`Trigger "${normalizedTrigger}" already exists in another group`);
                    return;
                }
                
                this.plugin.settings.snippets[key] = snippet.replacement;
                await this.plugin.saveSettings();
                
                // Refresh the list
                const root = activeDocument.querySelector('.snipsidian-settings');
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
        
        // Get the actual replacement from settings if it's not provided
        const actualReplacement = replacement || this.plugin.settings.snippets[trigger] || "";
        
        // Add trigger input
        const triggerInput = row.controlEl.createEl("input", {
            type: "text",
            placeholder: "Trigger",
            cls: "snippet-edit-input"
        });
        triggerInput.value = triggerName || "";
        
        // Add replacement textarea
        const replacementInput = row.controlEl.createEl("textarea", {
            placeholder: "Replacement",
            cls: "snippet-edit-textarea"
        });
        replacementInput.value = actualReplacement;
        
        // Add action buttons
        const actionsContainer = row.controlEl.createDiv({ cls: "snippet-actions" });
        
        const saveBtn = actionsContainer.createEl("button", { 
            text: "💾", 
            cls: "snippet-action save-btn",
            title: "Save changes"
        });
        
        const cancelBtn = actionsContainer.createEl("button", { 
            text: "Cancel", 
            cls: "snippet-action cancel-btn",
            title: "Cancel editing"
        });
        
        // Update edit button
        editBtn.empty();
        editBtn.createSpan({ text: "💾" });
        editBtn.title = "Save changes";
        
        // Store references for save/cancel
        (row as SettingWithEditData).editData = {
            trigger,
            triggerName,
            replacement: actualReplacement,
            triggerInput,
            replacementInput,
            saveBtn,
            cancelBtn,
            editBtn
        };
        
        // Add event handlers
        saveBtn.onclick = () => {
            const root = activeDocument.querySelector('.snipsidian-settings');
            if (root) {
                void this.saveSnippetChanges(row, trigger, triggerName, replacement, root as HTMLElement);
            }
        };
        
        cancelBtn.onclick = () => {
            this.cancelEditMode(row, editBtn);
        };
    }

    private async saveSnippetChanges(row: Setting, originalTrigger: string, _originalTriggerName: string, _originalReplacement: string, root: HTMLElement) {
        const editData = (row as SettingWithEditData).editData;
        if (!editData) return;
        
        const newTriggerName = editData.triggerInput.value.trim();
        const newReplacement = editData.replacementInput.value;
        
        // Validate trigger
        const normalized = normalizeTrigger(newTriggerName);
        if (isBadTrigger(normalized)) {
            new Notice("Invalid trigger: contains separators or is empty");
            return;
        }

        if (newReplacement.length === 0) {
            new Notice("Replacement cannot be empty");
            return;
        }
        
        // Check if trigger changed
        const { group: grp } = splitKey(originalTrigger);
        const newKey = joinKey(grp, normalized);
        if (hasTriggerCollision(this.plugin.settings, normalized, originalTrigger)) {
            new Notice(`Trigger "${normalized}" already exists in another group`);
            return;
        }
        
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
            
        } catch {
            new Notice("Failed to save changes");
        }
    }

    private cancelEditMode(row: Setting, editBtn: HTMLButtonElement) {
        // Reset edit button
        editBtn.empty();
        editBtn.createSpan({ text: "✏️" });
        editBtn.title = "Edit snippet";
        
        // Clear edit data
        delete (row as SettingWithEditData).editData;
        
        // Re-render the snippet list to return to normal view
        const root = activeDocument.querySelector('.snipsidian-settings') as HTMLElement;
        if (root) {
            this.renderSnippetList(root);
        }
    }
}
