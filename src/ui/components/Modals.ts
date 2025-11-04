import { App, ButtonComponent, Modal, Setting, TextComponent } from "obsidian";
import type SnipSidianPlugin from "../../main";
import { DiffResult, displayGroupTitle, slugifyGroup } from "../../services/utils";

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
            select.append(new Option(`📁 ${displayGroupTitle(g)}`, g));
        }
        select.append(new Option("➕ New group…", "__new__"));

        const newWrap = form.createDiv({ cls: "snipsidian-newgroup-wrap" });
        const input = newWrap.createEl("input", {
            type: "text",
            placeholder: "New group name",
        });
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
                target = slugifyGroup(label) || ""; // '' => Ungrouped
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
                    err.createEl("span", { text: "Value cannot be empty." });
                    return;
                }
                if (this.opts.validate) {
                    const msg = this.opts.validate(v);
                    if (msg) {
                        err.empty();
                        err.createEl("span", { text: msg });
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
                     
                    .setPlaceholder("e.g.: :hello")
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
                     
                    .setPlaceholder("e.g.: hello, world!")
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
                     
                    .setPlaceholder("e.g.: greetings")
                    .setValue(group)
                    .onChange((value) => {
                        group = value;
                    });
            });

        const footer = contentEl.createDiv({ cls: "modal-button-container" });
        
        const add = footer.createEl("button", { text: "Add snippet" });
        add.addClass("mod-cta");
        add.onclick = () => {
            if (trigger.trim() && replacement.trim()) {
                const result = this.onConfirm?.({ trigger: trigger.trim(), replacement: replacement.trim(), group: group.trim() });
                // Handle promise if onConfirm returns one
                if (result instanceof Promise) {
                    void result.catch((error) => {
                        console.error("Error in onConfirm callback:", error);
                    });
                }
                this.close();
            }
        };

        const cancel = footer.createEl("button", { text: "Cancel" });
        cancel.onclick = () => this.close();
    }
}

