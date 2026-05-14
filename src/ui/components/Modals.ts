import { App, ButtonComponent, Modal, Setting, TextComponent } from "obsidian";
import type SnipSidianPlugin from "../../main";
import { DiffResult, displayGroupTitle, slugifyGroup } from "../../services/utils";
import { computeImportDiff } from "../../services/import-diff";

/** Simple JSON copy/paste modal */
export class JSONModal extends Modal {
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

        contentEl.addClass("snipsidian-modal");
        const ta = contentEl.createEl("textarea", { text: this.text });
        ta.addClass("snipsidian-json-input");

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

/** Package preview & conflict resolution modal */
export class PackagePreviewModal extends Modal {
    plugin: SnipSidianPlugin;
    titleText: string;
    diff: DiffResult;
    choices = new Map<string, "keep" | "overwrite">();
    onConfirm?: (resolved: Record<string, string>) => void | Promise<void>;

    constructor(app: App, plugin: SnipSidianPlugin, title: string, diff: DiffResult) {
        super(app);
        this.plugin = plugin;
        this.titleText = title;
        this.diff = diff;
        for (const c of diff.conflicts) this.choices.set(c.key, "keep");
    }

    onOpen(): void {
        const { contentEl, titleEl } = this;
        titleEl.setText(this.titleText);

        const summary = contentEl.createDiv();
        summary.createEl("p", {
            text: `Will add ${this.diff.added.length} new snippet(s). Conflicts: ${this.diff.conflicts.length}.`,
        });

        if (this.diff.conflicts.length) {
            new Setting(contentEl)
                .setHeading()
                .setName("Conflicts");
            const table = contentEl.createEl("table", { cls: "snipsidian-preview-table" });
            const thead = table.createEl("thead");
            const headRow = thead.createEl("tr");
            ["Trigger", "Current", "Incoming", "Action"].forEach((h) => headRow.createEl("th", { text: h }));

            const tbody = table.createEl("tbody");
            for (const c of this.diff.conflicts) {
                const tr = tbody.createEl("tr");
                tr.createEl("td", { text: c.key });
                tr.createEl("td", { text: c.current });
                tr.createEl("td", { text: c.incoming });

                const actionTd = tr.createEl("td", { cls: "conflict-action" });
                const sel = actionTd.createEl("select");
                sel.append(new Option("Keep current", "keep"), new Option("Overwrite", "overwrite"));
                sel.value = this.choices.get(c.key) ?? "keep";
                sel.onchange = () => this.choices.set(c.key, sel.value as "keep" | "overwrite");
            }

            const bulk = contentEl.createDiv({ cls: "snipsidian-bulk-actions" });
            const btnKeepAll = bulk.createEl("button", { text: "Keep all current" });
            btnKeepAll.onclick = () => {
                for (const k of this.choices.keys()) this.choices.set(k, "keep");
                this.close(); this.open();
            };
            const btnOverwriteAll = bulk.createEl("button", { text: "Overwrite all" });
            btnOverwriteAll.onclick = () => {
                for (const k of this.choices.keys()) this.choices.set(k, "overwrite");
                this.close(); this.open();
            };
        }

        const footer = contentEl.createDiv({ cls: "modal-button-container" });
        const cancel = footer.createEl("button", { text: "Cancel" });
        cancel.onclick = () => this.close();

        const apply = footer.createEl("button", { text: "Apply" });
        apply.onclick = () => {
            const result: Record<string, string> = { ...this.plugin.settings.snippets };
            for (const a of this.diff.added) result[a.key] = a.value;
            for (const c of this.diff.conflicts) {
                const choice = this.choices.get(c.key) ?? "keep";
                result[c.key] = choice === "overwrite" ? c.incoming : c.current;
            }
            const confirmResult = this.onConfirm?.(result);
            // Handle promise if onConfirm returns one
            if (confirmResult instanceof Promise) {
                void confirmResult.catch((error) => {
                    console.error("Error in onConfirm callback:", error);
                });
            }
            this.close();
        };
    }
}

/** Group picker for bulk move (Move to…) */
export class GroupPickerModal extends Modal {
    titleText: string;
    groups: string[];
    allowUngrouped: boolean;
    onSubmit?: (groupKey: string | null) => void;

    constructor(
        app: App,
        opts: { title: string; groups: string[]; allowUngrouped?: boolean }
    ) {
        super(app);
        this.titleText = opts.title;
        this.groups = opts.groups ?? [];
        this.allowUngrouped = !!opts.allowUngrouped;
    }

    onOpen(): void {
        const { contentEl, titleEl } = this;
        titleEl.setText(this.titleText);
        contentEl.addClass("snipsidian-modal");
        contentEl.addClass("snipsidian-move-modal");

        const form = contentEl.createDiv({ cls: "snipsidian-move-form" });

        // Add description
        const desc = form.createEl("p", { text: "Select a group to move the selected snippets to:" });
        desc.addClass("snipsy-hint");

        const select = form.createEl("select");
        select.addClass("snipsy-group-select");
        if (this.allowUngrouped) select.append(new Option("📁 Ungrouped", ""));
        for (const g of this.groups) {
            if (!g) continue;
            select.append(new Option(`📁 ${displayGroupTitle(g)}`, g));
        }
        select.append(new Option("➕ New group…", "__new__"));

        const newWrap = form.createDiv({ cls: "snipsidian-newgroup-wrap" });
        const input = newWrap.createEl("input", {
            type: "text",
            placeholder: "New group name",
        });
        const newErr = newWrap.createDiv({ cls: "snipsidian-error" });
        newErr.hide();
        newWrap.hide();

        select.onchange = () => {
            if (select.value === "__new__") newWrap.show();
            else newWrap.hide();
        };

        const footer = contentEl.createDiv({ cls: "modal-button-container" });
        const cancel = footer.createEl("button", { text: "Cancel" });
        cancel.onclick = () => this.close();

        const apply = footer.createEl("button", { text: "Move" });
        apply.onclick = () => {
            let target: string | null = select.value;
            if (target === "__new__") {
                const label = input.value.trim();
                if (!label) {
                    newErr.empty();
                    newErr.createSpan({ text: "Group name cannot be empty." });
                    newErr.show();
                    return;
                }
                const slug = slugifyGroup(label);
                if (!slug) {
                    newErr.empty();
                    newErr.createSpan({ text: "Group name must contain at least one letter or number." });
                    newErr.show();
                    return;
                }
                target = slug;
            }
            this.onSubmit?.(target);
            this.close();
        };
    }
}

// ---- Simple text prompt modal (rename, etc.) ----
export class TextPromptModal extends Modal {
    private value = "";
    constructor(
        app: App,
        private readonly opts: {
            title: string;
            initial?: string;
            placeholder?: string;
            cta?: string;
            validate?: (v: string) => string | null;
            onSubmit: (v: string) => void;
        }
    ) { super(app); }

    onOpen(): void {
        const { contentEl, titleEl } = this;
        titleEl.setText(this.opts.title);
        contentEl.addClass("snipsidian-modal");
        contentEl.addClass("snipsidian-prompt");

        // Row: label + input (как в Settings)
        let input!: TextComponent;
        new Setting(contentEl)
            .setName("New name")
            .setDesc("")
            .addText((t) => {
                input = t;
                t.setPlaceholder(this.opts.placeholder ?? "Type a name…");
                if (this.opts.initial) t.setValue(this.opts.initial);
                this.value = this.opts.initial ?? "";
                t.inputEl.addEventListener("input", () => { this.value = t.getValue(); });
            });

        // Error text
        const err = contentEl.createDiv({ cls: "snipsidian-error" });

        // Footer
        const footer = contentEl.createDiv({ cls: "modal-button-container" });
        new ButtonComponent(footer)
            .setButtonText("Cancel")
            .onClick(() => this.close());

        const ok = new ButtonComponent(footer)
            .setCta()
            .setButtonText(this.opts.cta ?? "OK")
            .onClick(() => {
                const v = (this.value ?? "").trim();
                if (!v) {
                    err.empty();
                    err.createSpan({ text: "Value cannot be empty." });
                    return;
                }
                if (this.opts.validate) {
                    const msg = this.opts.validate(v);
                    if (msg) {
                        err.empty();
                        err.createSpan({ text: msg });
                        return;
                    }
                }
                this.opts.onSubmit(v);
                this.close();
            });

        // Keyboard UX
        input.inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
            if (e.key === "Enter") { e.preventDefault(); ok.buttonEl.click(); }
        });

        // Focus
        input.inputEl.focus();
        input.inputEl.select();
    }
}

/** Confirmation modal for delete operations */
export class ConfirmModal extends Modal {
    private confirmed = false;

    constructor(
        app: App,
        private readonly opts: {
            title: string;
            message: string;
            confirmText?: string;
            cancelText?: string;
            onConfirm: () => void | Promise<void>;
        }
    ) {
        super(app);
    }

    onOpen(): void {
        const { contentEl, titleEl } = this;
        titleEl.setText(this.opts.title);
        contentEl.addClass("snipsidian-modal");
        contentEl.addClass("snipsidian-confirm-modal");

        const message = contentEl.createDiv({ cls: "confirm-message" });
        message.createEl("p", { text: this.opts.message });

        const footer = contentEl.createDiv({ cls: "modal-button-container" });
        
        const cancel = footer.createEl("button", { text: this.opts.cancelText || "Cancel" });
        cancel.onclick = () => {
            this.confirmed = false;
            this.close();
        };

        const confirm = footer.createEl("button", { 
            text: this.opts.confirmText || "Confirm",
            cls: "mod-cta"
        });
        confirm.onclick = () => {
            this.confirmed = true;
            const result = this.opts.onConfirm();
            // Handle promise if onConfirm returns one
            if (result instanceof Promise) {
                void result.catch((error) => {
                    console.error("Error in confirm callback:", error);
                });
            }
            this.close();
        };

        // Focus on cancel button by default
        cancel.focus();
    }

    onClose(): void {
        // If closed without confirmation, do nothing
        if (!this.confirmed) {
            return;
        }
    }
}

/** Add new snippet modal */
export class AddSnippetModal extends Modal {
    onConfirm?: (snippet: { trigger: string; replacement: string; group: string }) => void | Promise<void>;

    constructor(app: App, onConfirm?: (snippet: { trigger: string; replacement: string; group: string }) => void | Promise<void>) {
        super(app);
        this.onConfirm = onConfirm;
    }

    onOpen(): void {
        const { contentEl, titleEl } = this;
        titleEl.setText("Add new snippet");
        contentEl.addClass("snipsidian-modal");

        let trigger = "";
        let replacement = "";
        let group = "";

        new Setting(contentEl)
            .setName("Trigger")
            .setDesc("The text that will be expanded (e.g., :hello)")
            .addText((text) => {
                text
                     
                    .setPlaceholder("Example: :hello")
                    .setValue(trigger)
                    .onChange((value) => {
                        trigger = value;
                    });
            });

        new Setting(contentEl)
            .setName("Replacement")
            .setDesc("The text that will replace the trigger")
            .addTextArea((text) => {
                text
                     
                    .setPlaceholder("Example: hello, world!")
                    .setValue(replacement)
                    .onChange((value) => {
                        replacement = value;
                    });
            });

        new Setting(contentEl)
            .setName("Group")
            .setDesc("Optional group name for organization")
            .addText((text) => {
                text
                     
                    .setPlaceholder("Example: greetings")
                    .setValue(group)
                    .onChange((value) => {
                        group = value;
                    });
            });

        const err = contentEl.createDiv({ cls: "snipsidian-error" });
        err.hide();

        const footer = contentEl.createDiv({ cls: "modal-button-container" });

        const add = footer.createEl("button", { text: "Add snippet" });
        add.addClass("mod-cta");
        add.onclick = () => {
            err.empty();
            err.hide();

            const trimmedTrigger = trigger.trim();
            const trimmedGroup = group.trim();

            if (!trimmedTrigger || replacement.length === 0) {
                err.createSpan({ text: "Trigger and replacement are required." });
                err.show();
                return;
            }

            // Group is optional (empty = Ungrouped), but a non-empty value that
            // slugifies to empty (e.g. "!!!" or emoji-only) would silently route
            // to Ungrouped — reject explicitly.
            if (trimmedGroup && !slugifyGroup(trimmedGroup)) {
                err.createSpan({ text: "Group name must contain at least one letter or number." });
                err.show();
                return;
            }

            const result = this.onConfirm?.({ trigger: trimmedTrigger, replacement, group: trimmedGroup });
            if (result instanceof Promise) {
                void result.catch((error) => {
                    console.error("Error in onConfirm callback:", error);
                });
            }
            this.close();
        };

        const cancel = footer.createEl("button", { text: "Cancel" });
        cancel.onclick = () => this.close();
    }
}

/**
 * Preview-before-write modal for JSON snippet import (B-038). Replaces
 * the silent `settings.snippets = parsed` that previously wiped users'
 * libraries with no recovery path.
 *
 * The user picks a mode (merge | replace) — the modal renders the diff
 * for the active mode so they can see exactly what's about to change.
 * Replace mode shows the `removed` list in red as the destructive-
 * action affordance (designer Q5: no second-confirm dialog).
 *
 * The caller owns the write. The modal's `onConfirm` callback is
 * passed the chosen mode and the original `incoming` payload — the
 * caller merges or replaces according to its policy.
 */
export class ImportPreviewModal extends Modal {
    private mode: "merge" | "replace" = "merge";

    constructor(
        app: App,
        private readonly opts: {
            current: Record<string, string>;
            incoming: Record<string, string>;
            onConfirm: (mode: "merge" | "replace") => void | Promise<void>;
        },
    ) {
        super(app);
    }

    onOpen(): void {
        const { contentEl, titleEl } = this;
        titleEl.setText("Import snippets");
        contentEl.addClass("snipsidian-modal");
        contentEl.addClass("snipsidian-import-modal");

        const diff = computeImportDiff(this.opts.current, this.opts.incoming);

        // Mode picker — merge first because it's the safe default.
        const modeRow = contentEl.createDiv({ cls: "snipsy-import-mode" });
        modeRow.createEl("label", { cls: "snipsy-import-mode-option" }, (label) => {
            const radio = label.createEl("input", {
                type: "radio",
                attr: { name: "snipsy-import-mode", value: "merge" },
            });
            radio.checked = true;
            radio.addEventListener("change", () => {
                if (radio.checked) {
                    this.mode = "merge";
                    this.refreshDiffList(listEl, diff);
                    this.refreshSummary(summaryEl, diff);
                    this.refreshApplyButton(applyBtn, diff);
                }
            });
            label.createSpan({ text: "Merge" });
            label.createSpan({
                cls: "snipsy-import-mode-hint",
                text: "Keep existing snippets, add new and overwrite conflicts.",
            });
        });
        modeRow.createEl("label", { cls: "snipsy-import-mode-option" }, (label) => {
            const radio = label.createEl("input", {
                type: "radio",
                attr: { name: "snipsy-import-mode", value: "replace" },
            });
            radio.addEventListener("change", () => {
                if (radio.checked) {
                    this.mode = "replace";
                    this.refreshDiffList(listEl, diff);
                    this.refreshSummary(summaryEl, diff);
                    this.refreshApplyButton(applyBtn, diff);
                }
            });
            label.createSpan({ text: "Replace all" });
            label.createSpan({
                cls: "snipsy-import-mode-hint snipsy-import-mode-hint-danger",
                text:
                    diff.removed.length > 0
                        ? `Delete ${diff.removed.length} existing snippet${diff.removed.length === 1 ? "" : "s"}, then import.`
                        : "Replace existing snippets with the import.",
            });
        });

        const summaryEl = contentEl.createDiv({ cls: "snipsy-import-summary" });
        this.refreshSummary(summaryEl, diff);

        const listEl = contentEl.createDiv({ cls: "snipsy-import-list" });
        this.refreshDiffList(listEl, diff);

        const footer = contentEl.createDiv({ cls: "modal-button-container" });
        const cancel = footer.createEl("button", { text: "Cancel" });
        cancel.onclick = () => this.close();

        const applyBtn = footer.createEl("button", { cls: "mod-cta" });
        this.refreshApplyButton(applyBtn, diff);
        applyBtn.onclick = () => {
            const result = this.opts.onConfirm(this.mode);
            if (result instanceof Promise) {
                void result.catch((error) => {
                    console.error("Error in import onConfirm callback:", error);
                });
            }
            this.close();
        };
    }

    private refreshSummary(
        el: HTMLElement,
        diff: ReturnType<typeof computeImportDiff>,
    ) {
        el.empty();
        const parts: string[] = [];
        if (diff.added.length) parts.push(`${diff.added.length} new`);
        if (diff.conflicts.length) parts.push(`${diff.conflicts.length} updated`);
        if (this.mode === "replace" && diff.removed.length) {
            parts.push(`${diff.removed.length} removed`);
        }
        if (diff.unchangedCount) parts.push(`${diff.unchangedCount} unchanged`);

        if (parts.length === 0) {
            el.createSpan({ text: "Nothing will change." });
            return;
        }
        el.createSpan({ text: parts.join(" · ") });
    }

    private refreshDiffList(
        el: HTMLElement,
        diff: ReturnType<typeof computeImportDiff>,
    ) {
        el.empty();

        const MAX_ROWS = 50;
        let rendered = 0;
        const remaining: string[] = [];

        const renderRow = (tag: "new" | "update" | "remove", key: string, value: string) => {
            if (rendered >= MAX_ROWS) {
                remaining.push(key);
                return;
            }
            const row = el.createDiv({ cls: "snipsy-import-row" });
            row.createSpan({
                cls: `snipsy-import-tag snipsy-import-tag-${tag}`,
                text: tag === "new" ? "NEW" : tag === "update" ? "UPDATE" : "REMOVE",
            });
            row.createSpan({ cls: "snipsy-import-key", text: key });
            row.createSpan({ cls: "snipsy-import-value", text: value });
            rendered++;
        };

        for (const a of diff.added) renderRow("new", a.key, a.value);
        for (const c of diff.conflicts) renderRow("update", c.key, c.incoming);
        if (this.mode === "replace") {
            for (const r of diff.removed) renderRow("remove", r.key, r.value);
        }

        if (remaining.length > 0) {
            el.createDiv({
                cls: "snipsy-import-more",
                text: `…and ${remaining.length} more`,
            });
        }
    }

    private refreshApplyButton(
        btn: HTMLButtonElement,
        diff: ReturnType<typeof computeImportDiff>,
    ) {
        if (this.mode === "replace") {
            btn.textContent = `Replace all (${Object.keys(this.opts.incoming).length})`;
            // Danger affordance: red CTA. Designer Q5 explicitly does NOT
            // want a second-confirm dialog — the visual + the `removed`
            // list in the diff is the affordance.
            btn.addClass("mod-warning");
        } else {
            const willChange = diff.added.length + diff.conflicts.length;
            btn.textContent = willChange === 0 ? "Apply" : `Apply merge (${willChange})`;
            btn.removeClass("mod-warning");
        }
    }
}
