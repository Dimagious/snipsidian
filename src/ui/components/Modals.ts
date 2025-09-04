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

/** Package preview & conflict resolution modal */
export class PackagePreviewModal extends Modal {
    plugin: SnipSidianPlugin;
    titleText: string;
    diff: DiffResult;
    choices = new Map<string, "keep" | "overwrite">();
    onConfirm?: (resolved: Record<string, string>) => void;

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
            contentEl.createEl("h4", { text: "Conflicts" });
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
            this.onConfirm?.(result);
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

        const form = contentEl.createDiv({ cls: "snipsidian-move-form" });

        const select = form.createEl("select");
        if (this.allowUngrouped) select.append(new Option("Ungrouped", ""));
        for (const g of this.groups) {
            select.append(new Option(displayGroupTitle(g), g));
        }
        select.append(new Option("New group…", "__new__"));

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
        const err = contentEl.createDiv();
        err.style.color = "var(--text-error)";
        err.style.fontSize = "0.9em";
        err.style.margin = "4px 0 0";
        err.textContent = "";

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
                if (!v) { err.textContent = "Value cannot be empty."; return; }
                if (this.opts.validate) {
                    const msg = this.opts.validate(v);
                    if (msg) { err.textContent = msg; return; }
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

