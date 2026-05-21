import { App, Notice, setIcon } from "obsidian";
import type SnipSidianPlugin from "../../main";
import { splitKey, slugifyGroup } from "../../store/keys";
import { GroupManager } from "../utils/group-utils";
import { UIStateManager } from "../utils/ui-state";
import { AddSnippetModal, ConfirmModal, GroupPickerModal, TextPromptModal } from "./Modals";
import { planAddSnippet, planEditSnippet } from "../../core/snippet-ops";

export class SnippetsTab {
    private groupManager: GroupManager;
    private uiState: UIStateManager;
    /** Cached root for re-renders triggered outside `render()` (e.g. after
     *  a modal resolves). Re-renders always target the list container,
     *  never the whole tab — the toolbar/heading stay mounted. */
    private listEl: HTMLElement | null = null;
    /** Search input is read by the list renderer for the result-count
     *  badge (B-099). Re-renders never recreate it, so focus and cursor
     *  position survive typing. */
    private searchInput: HTMLInputElement | null = null;
    /** Result-count badge — shown only when search is non-empty. */
    private countBadge: HTMLSpanElement | null = null;
    /** Bulk bar wrapper — toggled by selection state, never re-mounted. */
    private bulkBar: HTMLElement | null = null;

    constructor(
        private app: App,
        private plugin: SnipSidianPlugin,
    ) {
        this.groupManager = new GroupManager();
        this.uiState = new UIStateManager(this.plugin.settings, () => this.plugin.saveSettings());
    }

    render(root: HTMLElement) {
        root.empty();

        // Real heading element (B-091): screen readers need <h3>, not
        // a styled-div `.setting-item-heading`.
        root.createEl("h3", { text: "Snippets", cls: "snipsy-tab-heading" });

        this.renderToolbar(root);
        this.renderBulkBar(root);

        this.listEl = root.createDiv({ cls: "snippet-list" });
        this.renderList();
    }

    private renderToolbar(root: HTMLElement) {
        const toolbar = root.createDiv({ cls: "snipsy-snippet-toolbar" });

        // Search input — wrapped in `.snipsy-search` so the icon overlays
        // correctly (the icon is absolutely positioned inside the wrapper).
        const searchWrap = toolbar.createDiv({ cls: "snipsy-search" });
        const iconEl = searchWrap.createSpan({ cls: "snipsy-search-icon" });
        setIcon(iconEl, "search");

        const input = searchWrap.createEl("input", {
            type: "text",
            attr: {
                placeholder: "Filter triggers or replacements",
                "aria-label": "Filter snippets",
            },
        });
        input.value = this.uiState.getSearchQuery();
        input.addEventListener("input", () => {
            this.uiState.setSearchQuery(input.value);
            this.renderList();
        });
        this.searchInput = input;

        // Result-count badge (B-099). Hidden by default; the list
        // renderer fills it in when there's a non-empty search query.
        this.countBadge = toolbar.createSpan({ cls: "snipsy-filter-count is-hidden" });

        const selBtn = toolbar.createEl("button", {
            cls: "snippet-action",
            attr: { type: "button" },
        });
        this.refreshSelectionButton(selBtn);
        selBtn.addEventListener("click", () => {
            const next = !this.uiState.getSelectionMode();
            this.uiState.setSelectionMode(next);
            if (!next) this.uiState.setSelected(new Set());
            this.refreshSelectionButton(selBtn);
            this.renderList();
        });

        const expandBtn = toolbar.createEl("button", {
            cls: "snippet-action",
            attr: { type: "button" },
        });
        this.refreshExpandButton(expandBtn);
        expandBtn.addEventListener("click", () => {
            const groups = this.groupManager.allGroupsFrom(this.plugin.settings.snippets);
            const allOpen =
                groups.length > 0 &&
                groups.every((g) => this.uiState.loadOpenState(g, false));
            const target = !allOpen;
            for (const g of groups) {
                this.uiState.setGroupOpen(g, target);
            }
            this.refreshExpandButton(expandBtn);
            this.renderList();
        });

        // Single primary CTA. Plain `.mod-cta` class wires it to the
        // accent color via the scoped stylesheet.
        const addBtn = toolbar.createEl("button", {
            cls: "snippet-action mod-cta",
            text: "Add snippet",
            attr: { type: "button" },
        });
        addBtn.addEventListener("click", () => this.showAddSnippetModal());
    }

    private refreshSelectionButton(btn: HTMLButtonElement) {
        btn.textContent = this.uiState.getSelectionMode() ? "Done selecting" : "Select";
        btn.setAttr("aria-pressed", this.uiState.getSelectionMode() ? "true" : "false");
    }

    private refreshExpandButton(btn: HTMLButtonElement) {
        const groups = this.groupManager.allGroupsFrom(this.plugin.settings.snippets);
        const allOpen =
            groups.length > 0 &&
            groups.every((g) => this.uiState.loadOpenState(g, false));
        btn.textContent = allOpen ? "Collapse all" : "Expand all";
    }

    private renderBulkBar(root: HTMLElement) {
        // Sticky bar lives above the list. Hidden when nothing's selected
        // so it never wastes vertical space (designer Q3).
        //
        // B-088: aria-live="polite" so AT users hear "3 selected" /
        // "5 selected" announced as the count changes — without
        // moving keyboard focus.
        this.bulkBar = root.createDiv({
            cls: "snipsy-bulk-bar is-hidden",
            attr: { "aria-live": "polite", "aria-atomic": "true" },
        });
    }

    private updateBulkBar() {
        if (!this.bulkBar) return;
        const count = this.uiState.getSelected().size;
        const visible = this.uiState.getSelectionMode() && count > 0;
        this.bulkBar.toggleClass("is-hidden", !visible);
        this.bulkBar.empty();
        if (!visible) return;

        this.bulkBar.createSpan({
            text: `${count} selected`,
        });

        const moveBtn = this.bulkBar.createEl("button", {
            cls: "snippet-action",
            text: "Move to group",
            attr: { type: "button" },
        });
        moveBtn.addEventListener("click", () => {
            const groups = this.groupManager.allGroupsFrom(this.plugin.settings.snippets);
            const modal = new GroupPickerModal(this.app, {
                title: "Move to group:",
                groups,
                allowUngrouped: true,
            });
            modal.onSubmit = (targetGroup) => {
                if (targetGroup === null) return;
                void this.moveSelectedSnippets(targetGroup);
            };
            modal.open();
        });

        const deleteBtn = this.bulkBar.createEl("button", {
            cls: "snippet-action is-danger",
            text: "Delete",
            attr: { type: "button" },
        });
        deleteBtn.addEventListener("click", () => {
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
                    this.discardEditIfMissing();
                    this.renderList();
                    new Notice(`Deleted ${n} snippet(s).`);
                },
            });
            modal.open();
        });

        const clearBtn = this.bulkBar.createEl("button", {
            cls: "snippet-action",
            text: "Clear",
            attr: { type: "button" },
        });
        clearBtn.addEventListener("click", () => {
            this.uiState.setSelected(new Set());
            this.updateBulkBar();
            this.renderList();
        });
    }

    private renderList() {
        if (!this.listEl) return;
        this.listEl.empty();

        const rawQuery = this.uiState.getSearchQuery();
        const searchQuery = rawQuery.toLowerCase();
        const allEntries = Object.entries(this.plugin.settings.snippets);
        const entries = allEntries
            .filter(
                ([key, value]) =>
                    !searchQuery ||
                    key.toLowerCase().includes(searchQuery) ||
                    value.toLowerCase().includes(searchQuery),
            )
            .sort(([a], [b]) => a.localeCompare(b));

        // Result-count badge (B-099). Shown only when there is an active
        // query — empty state is signaled by the empty-state block below.
        if (this.countBadge) {
            const visible = rawQuery.length > 0;
            this.countBadge.toggleClass("is-hidden", !visible);
            this.countBadge.textContent = visible
                ? `${entries.length} of ${allEntries.length}`
                : "";
        }

        this.updateBulkBar();

        if (entries.length === 0) {
            const empty = this.listEl.createDiv({ cls: "snipsy-empty" });
            if (allEntries.length === 0) {
                empty.createEl("p", { text: "No snippets yet." });
                empty.createEl("p", {
                    text: "Add your first snippet or install a community package.",
                });
            } else {
                empty.createEl("p", { text: "No snippets match your filter." });
            }
            return;
        }

        // Group snippets by folder.
        const groups = new Map<string, Array<[string, string]>>();
        for (const e of entries) {
            const [k] = e;
            const { group } = splitKey(k);
            if (!groups.has(group)) groups.set(group, []);
            groups.get(group)!.push(e);
        }

        for (const g of groups.keys()) {
            if (!this.uiState.getGroupOpen().has(g)) {
                this.uiState.setGroupOpen(g, this.uiState.loadOpenState(g, false));
            }
        }

        for (const [group, items] of groups.entries()) {
            const isOpen = this.uiState.getGroupOpen().get(group) ?? false;
            const title = group === "" ? "Ungrouped" : this.groupManager.displayGroupTitle(group);
            this.renderGroup(group, title, items, isOpen);
        }
    }

    private renderGroup(
        group: string,
        title: string,
        items: Array<[string, string]>,
        isOpen: boolean,
    ) {
        if (!this.listEl) return;

        const groupEl = this.listEl.createDiv({ cls: "snippet-group" });
        const header = groupEl.createDiv({ cls: "group-header" });

        // Chevron toggle. setIcon renders an SVG; we toggle the
        // `.open` class to rotate it 90° via CSS (no glyph swap).
        const toggle = header.createEl("button", {
            cls: `group-toggle${isOpen ? " open" : ""}`,
            attr: {
                type: "button",
                "aria-expanded": isOpen ? "true" : "false",
                "aria-label": `${isOpen ? "Collapse" : "Expand"} group ${title}`,
            },
        });
        setIcon(toggle, "chevron-right");
        toggle.addEventListener("click", () => {
            this.uiState.setGroupOpen(group, !isOpen);
            this.renderList();
        });

        header.createSpan({ text: title, cls: "group-title" });
        header.createSpan({ text: `${items.length}`, cls: "group-count" });

        const actions = header.createDiv({ cls: "group-actions" });

        if (this.uiState.getSelectionMode()) {
            const selectAllCb = actions.createEl("input", {
                type: "checkbox",
                attr: { "aria-label": `Select all in group ${title}` },
            });
            selectAllCb.checked = items.every(([key]) => this.uiState.getSelected().has(key));
            selectAllCb.addEventListener("change", () => {
                if (selectAllCb.checked) {
                    items.forEach(([key]) => this.uiState.getSelected().add(key));
                } else {
                    items.forEach(([key]) => this.uiState.getSelected().delete(key));
                }
                this.renderList();
            });
        }

        const renameBtn = actions.createEl("button", {
            cls: "snippet-action",
            attr: { type: "button", "aria-label": `Rename group ${title}` },
        });
        setIcon(renameBtn, "pencil");
        renameBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const modal = new TextPromptModal(this.app, {
                title: "Rename group:",
                initial: title,
                validate: (v) => {
                    const trimmed = v.trim();
                    if (!trimmed) return "Group name cannot be empty";
                    if (!slugifyGroup(trimmed))
                        return "Group name must contain at least one letter or number";
                    return null;
                },
                onSubmit: (newTitle) => {
                    void this.renameGroup(group, title, items, isOpen, newTitle);
                },
            });
            modal.open();
        });

        const deleteBtn = actions.createEl("button", {
            cls: "snippet-action is-danger",
            attr: { type: "button", "aria-label": `Delete group ${title}` },
        });
        setIcon(deleteBtn, "trash");
        deleteBtn.addEventListener("click", (e) => {
            e.stopPropagation();
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
                    this.discardEditIfMissing();
                    this.renderList();
                    new Notice(`Deleted ${items.length} snippet(s) from "${title}".`);
                },
            });
            modal.open();
        });

        if (isOpen) {
            const content = groupEl.createDiv({ cls: "group-content" });
            for (const [key, replacement] of items) {
                this.renderSnippetRow(content, key, replacement);
            }
        }
    }

    private renderSnippetRow(content: HTMLElement, key: string, replacement: string) {
        const { name: triggerName } = splitKey(key);
        const editing = this.uiState.isEditing(key);

        const row = content.createDiv({
            cls: `snippet-row${editing ? " is-editing" : ""}`,
        });

        if (editing) {
            this.renderEditForm(row, key, triggerName, replacement);
            return;
        }

        // Trigger column: checkbox + name in selection mode, name only
        // otherwise. The grid layout (`.snippet-row`) is 3 columns:
        // trigger / replacement / actions — so we always render exactly
        // one element here.
        const triggerCell = row.createDiv({ cls: "snippet-trigger" });
        if (this.uiState.getSelectionMode()) {
            const cb = triggerCell.createEl("input", {
                type: "checkbox",
                attr: { "aria-label": `Select snippet ${triggerName}` },
            });
            cb.checked = this.uiState.getSelected().has(key);
            if (cb.checked) row.addClass("is-selected");
            cb.addEventListener("change", () => {
                if (cb.checked) this.uiState.getSelected().add(key);
                else this.uiState.getSelected().delete(key);
                this.updateBulkBar();
                row.toggleClass("is-selected", cb.checked);
            });
            triggerCell.createSpan({ text: ` ${triggerName}` });
        } else {
            triggerCell.setText(triggerName);
        }

        const preview = row.createDiv({ cls: "snippet-replacement" });
        preview.createSpan({ cls: "arrow", text: "→" });
        preview.createSpan({ text: replacement || "" });

        const actionsContainer = row.createDiv({ cls: "snippet-actions" });

        const editBtn = actionsContainer.createEl("button", {
            cls: "snippet-action",
            attr: { type: "button", "aria-label": `Edit snippet ${triggerName}` },
        });
        setIcon(editBtn, "pencil");
        editBtn.addEventListener("click", () => this.beginEdit(key, triggerName, replacement));

        const delBtn = actionsContainer.createEl("button", {
            cls: "snippet-action is-danger",
            attr: { type: "button", "aria-label": `Delete snippet ${triggerName}` },
        });
        setIcon(delBtn, "trash");
        delBtn.addEventListener("click", () => {
            const modal = new ConfirmModal(this.app, {
                title: "Delete snippet",
                message: `Delete snippet "${triggerName}"?`,
                confirmText: "Delete",
                onConfirm: async () => {
                    delete this.plugin.settings.snippets[key];
                    await this.plugin.saveSettings();
                    if (this.uiState.isEditing(key)) this.uiState.setEditing(null, null);
                    this.uiState.getSelected().delete(key);
                    this.renderList();
                },
            });
            modal.open();
        });
    }

    private renderEditForm(row: HTMLElement, key: string, triggerName: string, replacement: string) {
        const draft = this.uiState.getEditingDraft() ?? { triggerName, replacement };

        const form = row.createDiv({ cls: "snippet-edit" });

        const triggerField = form.createDiv({ cls: "field" });
        triggerField.createEl("label", { text: "Trigger" });
        const triggerInput = triggerField.createEl("input", {
            type: "text",
            attr: { "aria-label": "Snippet trigger" },
        });
        triggerInput.value = draft.triggerName;
        // Input mutates the live draft in UIStateManager; no re-render
        // until save. This is the core of B-021's fix.
        triggerInput.addEventListener("input", () => {
            draft.triggerName = triggerInput.value;
        });

        const replacementField = form.createDiv({ cls: "field is-full" });
        replacementField.createEl("label", { text: "Replacement" });
        const replacementInput = replacementField.createEl("textarea", {
            attr: { "aria-label": "Snippet replacement", rows: "4" },
        });
        replacementInput.value = draft.replacement;
        replacementInput.addEventListener("input", () => {
            draft.replacement = replacementInput.value;
        });

        const actions = form.createDiv({ cls: "actions" });
        const cancelBtn = actions.createEl("button", {
            cls: "snippet-action",
            text: "Cancel",
            attr: { type: "button" },
        });
        cancelBtn.addEventListener("click", () => {
            this.uiState.setEditing(null, null);
            this.renderList();
        });

        const saveBtn = actions.createEl("button", {
            cls: "snippet-action mod-cta",
            text: "Save",
            attr: { type: "button" },
        });
        saveBtn.addEventListener("click", () => {
            void this.saveEdit(key);
        });

        // Focus the trigger on entry. We schedule this so the input is
        // attached to the document before `focus()` fires.
        if (!triggerInput.matches(":focus")) {
            window.setTimeout(() => triggerInput.focus(), 0);
        }
    }

    private beginEdit(key: string, triggerName: string, replacement: string) {
        // Single-edit-mode: opening a second row discards the prior
        // unsaved draft. The previous behavior re-rendered the list and
        // wiped the user's typing anyway (B-021); this is at least
        // explicit and predictable.
        this.uiState.setEditing(key, { triggerName, replacement });
        this.renderList();
    }

    private async saveEdit(originalKey: string) {
        const draft = this.uiState.getEditingDraft();
        if (!draft) return;

        const plan = planEditSnippet(
            originalKey,
            { triggerName: draft.triggerName.trim(), replacement: draft.replacement },
            this.plugin.settings,
        );
        if (!plan.ok) {
            new Notice(plan.reason);
            return;
        }

        try {
            const { newKey, value, renamedFrom } = plan.data;
            if (renamedFrom) {
                delete this.plugin.settings.snippets[renamedFrom];
                if (this.uiState.getSelected().has(renamedFrom)) {
                    this.uiState.getSelected().delete(renamedFrom);
                    this.uiState.getSelected().add(newKey);
                }
            }
            this.plugin.settings.snippets[newKey] = value;
            await this.plugin.saveSettings();
            this.uiState.setEditing(null, null);
            this.renderList();
        } catch {
            new Notice("Failed to save changes");
        }
    }

    /** Called after destructive operations (delete group / bulk delete)
     *  to drop the editing pointer if the snippet it referenced is gone. */
    private discardEditIfMissing() {
        const editingKey = this.uiState.getEditingKey();
        if (editingKey && this.plugin.settings.snippets[editingKey] === undefined) {
            this.uiState.setEditing(null, null);
        }
    }

    private async moveSelectedSnippets(targetGroup: string) {
        const keys = Array.from(this.uiState.getSelected());
        if (keys.length === 0) return;

        const { moved, skipped } = this.groupManager.bulkMoveKeys(
            this.plugin.settings.snippets,
            targetGroup,
            keys,
        );
        if (moved === 0) {
            new Notice(`Moved 0 item(s)${skipped ? `, skipped ${skipped} (conflicts)` : ""}.`);
            return;
        }

        try {
            await this.plugin.saveSettings();
            this.uiState.setSelected(new Set());
            this.discardEditIfMissing();
            this.renderList();
            new Notice(`Moved ${moved} item(s)${skipped ? `, skipped ${skipped} (conflicts)` : ""}.`);
        } catch {
            new Notice("Failed to move snippets");
        }
    }

    private async renameGroup(
        group: string,
        title: string,
        items: Array<[string, string]>,
        isOpen: boolean,
        newTitle: string,
    ) {
        if (!newTitle || newTitle === title) return;

        const newSlug = slugifyGroup(newTitle);
        if (newSlug === group) return;

        const { moved, skipped } = this.groupManager.bulkMoveKeys(
            this.plugin.settings.snippets,
            newSlug,
            items.map(([k]) => k),
        );
        if (moved === 0) {
            new Notice(`Renamed group failed: no snippets moved${skipped ? `, skipped ${skipped}` : ""}.`);
            return;
        }

        try {
            await this.plugin.saveSettings();
            this.uiState.setGroupOpen(newSlug, isOpen);
            this.uiState.getGroupOpen().delete(group);
            this.discardEditIfMissing();
            this.renderList();
            const groupName =
                newSlug === "" ? "Ungrouped" : this.groupManager.displayGroupTitle(newSlug);
            new Notice(
                `Renamed group to "${groupName}" (${moved} moved${skipped ? `, skipped ${skipped}` : ""}).`,
            );
        } catch {
            new Notice("Failed to rename group");
        }
    }

    private showAddSnippetModal() {
        const modal = new AddSnippetModal(this.app, async (snippet) => {
            if (!snippet.trigger || !snippet.replacement) return;

            const plan = planAddSnippet(snippet, this.plugin.settings);
            if (!plan.ok) {
                new Notice(plan.reason);
                return;
            }

            this.plugin.settings.snippets[plan.data.key] = plan.data.value;
            await this.plugin.saveSettings();
            this.renderList();
        });
        modal.open();
    }
}
