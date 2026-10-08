import { App, ButtonComponent, Modal, Setting, TextComponent } from "obsidian";
import type SnipSidianPlugin from "../../main";
import { DiffResult } from "../../store/diff";
import { displayGroupTitle, slugifyGroup, splitKey } from "../../store/keys";
import { computeImportDiff } from "../../services/import-diff";
import { normalizeTrigger } from "../../engine/triggers";

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
        const ta = contentEl.createEl("textarea", {
            text: this.text,
            attr: { "aria-label": this.title },
        });
        ta.addClass("snipsidian-json-input");

        const footer = contentEl.createDiv({ cls: "modal-button-container" });
        const apply = footer.createEl("button", { text: "Apply" });
        apply.onclick = () => {
            this.onApply?.(ta.value);
            this.close();
        };

        const close = footer.createEl("button", { text: "Close" });
        close.onclick = () => this.close();

        // B-087: explicit focus on the textarea so screen-reader /
        // keyboard users land somewhere meaningful instead of on the
        // modal title (Obsidian's default).
        ta.focus();
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
        // Was missing: every `.snipsidian-conflicts-*` / `.snipsidian-
        // preview-table` rule in main.css is scoped under
        // `.snipsidian-modal`, but this modal never added the class, so
        // that whole block was dead CSS. Needed now so the redesigned
        // conflict cards actually pick up their styling.
        contentEl.addClass("snipsidian-modal");

        // Wording (redesign): "Will add 7 new snippet(s). Conflicts: 1."
        // reads like a status log; "7 new snippets, 1 conflict." reads
        // as a sentence, with real plurals instead of "(s)".
        const summary = contentEl.createDiv();
        const addedCount = this.diff.added.length;
        const conflictCount = this.diff.conflicts.length;
        const parts = [`${addedCount} new snippet${addedCount === 1 ? "" : "s"}`];
        if (conflictCount > 0) {
            parts.push(`${conflictCount} conflict${conflictCount === 1 ? "" : "s"}`);
        }
        summary.createEl("p", { text: `${parts.join(", ")}.` });

        if (this.diff.conflicts.length) {
            const conflictsHead = contentEl.createDiv({ cls: "snipsidian-conflicts-head" });
            conflictsHead.createEl("h3", { text: "Conflicts" });

            // Keep a handle to each conflict's <select> so the bulk
            // actions ("Keep all current" / "Overwrite all") can
            // update them in place instead of re-rendering. The
            // previous close()+open() trick double-rendered because
            // Obsidian's Modal.close() doesn't synchronously empty
            // contentEl, so onOpen() ran a second time and appended.
            const selects: Array<{ key: string; el: HTMLSelectElement }> = [];

            // Bulk actions sit next to the "Conflicts" heading they
            // act on, instead of glued under the table (AUDIT: "Keep
            // all current / Overwrite all are glued together and sit
            // under the table, detached from the column they act on").
            const bulk = conflictsHead.createDiv({ cls: "snipsidian-bulk-actions" });
            const btnKeepAll = bulk.createEl("button", { text: "Keep all current", cls: "snippet-action" });
            const btnOverwriteAll = bulk.createEl("button", {
                text: "Overwrite all",
                cls: "snippet-action",
            });

            // One card per conflict (redesign #418) instead of a table —
            // the table centred headers over left-aligned cells and
            // wrapped long keys (AUDIT). Each card carries its own
            // `.snipsidian-conflict-card` hook and the choice `<select>`
            // carries `.snipsidian-conflict-choice`, so tests can target
            // them without depending on layout.
            const list = contentEl.createDiv({ cls: "snipsidian-conflicts-list" });
            for (const c of this.diff.conflicts) {
                const card = list.createDiv({ cls: "snipsidian-conflict-card" });

                const top = card.createDiv({ cls: "snipsidian-conflict-top" });
                const keyEl = top.createEl("code", { cls: "snipsidian-conflict-key" });
                const { group, name } = splitKey(c.key);
                if (group) {
                    keyEl.createSpan({
                        cls: "snipsidian-conflict-key-group",
                        text: `${displayGroupTitle(group)}/`,
                    });
                }
                keyEl.createSpan({ text: name });

                const sel = top.createEl("select", { cls: "snipsidian-conflict-choice" });
                sel.append(new Option("Keep current", "keep"), new Option("Overwrite", "overwrite"));
                sel.value = this.choices.get(c.key) ?? "keep";
                sel.onchange = () => this.choices.set(c.key, sel.value as "keep" | "overwrite");
                selects.push({ key: c.key, el: sel });

                const compare = card.createDiv({ cls: "snipsidian-conflict-compare" });
                const currentEl = compare.createDiv({ cls: "snipsidian-conflict-current" });
                currentEl.createEl("small", { text: "Current" });
                currentEl.createSpan({ text: c.current });
                const incomingEl = compare.createDiv({ cls: "snipsidian-conflict-incoming" });
                incomingEl.createEl("small", { text: "Incoming" });
                incomingEl.createSpan({ text: c.incoming });
            }

            const setAll = (choice: "keep" | "overwrite") => {
                for (const { key, el } of selects) {
                    this.choices.set(key, choice);
                    el.value = choice;
                }
            };
            btnKeepAll.onclick = () => setAll("keep");
            btnOverwriteAll.onclick = () => setAll("overwrite");
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

        // B-087: focus Apply by default. Cancel is harmless (Escape
        // also closes the modal), so the primary action is the right
        // initial target for keyboard / screen-reader users.
        apply.focus();
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
            attr: { "aria-label": "New group name" },
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

        // B-087: focus the group <select> on open so keyboard users
        // can immediately arrow-key through groups without first
        // having to Tab past the modal title.
        select.focus();
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
            /** Optional live hint shown under the input. Receives
             *  the current trimmed value, returns the hint text or
             *  `null` to hide. Used by B-051 to surface "Will be
             *  saved as: …" for slug-lossy group renames. */
            formatHint?: (v: string) => string | null;
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
        const nameSetting = new Setting(contentEl)
            .setName("New name")
            .addText((t) => {
                input = t;
                t.setPlaceholder(this.opts.placeholder ?? "Type a name…");
                if (this.opts.initial) t.setValue(this.opts.initial);
                this.value = this.opts.initial ?? "";
                t.inputEl.addEventListener("input", () => {
                    this.value = t.getValue();
                    updateHint();
                });
            });

        // B-051/F5f: live hint lives in the row's own `descEl` (a
        // second line under it), not a separate div after the row —
        // so it reads as feedback on the input, not a floating extra
        // setting. Hidden until formatHint returns a non-null string.
        // `aria-live="polite"` so AT users hear the "Will be saved
        // as: …" preview as they type.
        const hintEl = nameSetting.descEl.createDiv({
            cls: "snipsy-hint snipsidian-prompt-hint",
            attr: { "aria-live": "polite" },
        });
        hintEl.hide();
        const updateHint = () => {
            if (!this.opts.formatHint) return;
            const msg = this.opts.formatHint(this.value.trim());
            if (msg) {
                hintEl.setText(msg);
                hintEl.show();
            } else {
                hintEl.hide();
            }
        };
        updateHint(); // initial state for `initial` value

        // Error text. B-088: aria-live="polite" so AT users hear
        // validation errors as they appear without losing input focus.
        const err = contentEl.createDiv({
            cls: "snipsidian-error",
            attr: { "aria-live": "polite" },
        });

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
            /** Destructive confirms (delete group/snippet, bulk
             *  delete, uninstall package) map to `mod-warning` instead
             *  of the accent `mod-cta` — Obsidian's own convention for
             *  "this is hard to undo", and a fix for the redesign's
             *  finding that delete-group used accent styling for a
             *  destructive action. Defaults to `false` so existing
             *  non-destructive confirms are unaffected. */
            danger?: boolean;
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
            cls: this.opts.danger ? "mod-warning" : "mod-cta",
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

/** Result of a snippet-write callback invoked from a modal: `ok: true`
 *  on a successful write, or `ok: false` with a user-readable reason
 *  the modal should display without closing. A `void` return (or a
 *  promise resolving to `void`) is treated as success for backward
 *  compatibility with callers that don't need to report failure. */
export type SnippetOpResult = { ok: true } | { ok: false; error: string };

/** Expansion settings relevant to how a trigger will actually fire —
 *  just the B-137 prefix-mode fields, passed in by callers that have
 *  `plugin.settings.expansion` (currently only `SnippetsTab`). */
export type ExpansionHintSettings = { requirePrefix?: boolean; prefixChar?: string };

/**
 * B-137 fold-in (ux#5): compute the "Will expand when you type: …"
 * hint for the Add-snippet modal's Trigger field. Mirrors the
 * `formatHint` pattern already used by the group-rename modal
 * (`SnippetsTab.ts`'s `TextPromptModal.formatHint` for lossy slug
 * round-trips) — same shape, same purpose: show what the raw input
 * actually normalises to before the user commits.
 *
 * The hint is prefix-aware: when the mode is on, the "effective"
 * trigger the user actually has to type is `<prefixChar><normalized>`
 * (stored keys stay bare — the prefix is consumed by the engine at
 * match time, see `engine/match.ts`). The hint only shows when that
 * effective form differs from what the user literally typed — no
 * surprise, nothing to show.
 */
export function computeTriggerHint(raw: string, expansion?: ExpansionHintSettings): string | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const normalized = normalizeTrigger(trimmed);
    if (!normalized) return null;
    const prefixChar = expansion?.requirePrefix ? (expansion.prefixChar || ":") : "";
    const effective = `${prefixChar}${normalized}`;
    if (effective === trimmed) return null;
    return `Will expand when you type: ${effective}`;
}

/** Add new snippet modal.
 *
 * B-133: the modal used to call `onConfirm` and unconditionally
 * close — real validation (bad trigger chars, duplicate/cross-group
 * collision) happens downstream in `planAddSnippet`, so any failure
 * there closed the modal anyway and discarded everything the user
 * typed. `onConfirm` now reports success/failure via `SnippetOpResult`
 * and the modal only closes on success, mirroring the inline-edit
 * flow (`SnippetsTab.saveEdit`) which already stays open on failure.
 *
 * B-137 (ux#5): the Trigger field used to teach the Espanso-style
 * ":hello" convention in its placeholder/description while
 * `normalizeTrigger` silently strips the colon before storage — a
 * user who deliberately typed a prefixed trigger ended up with a
 * bare-word trigger that fires on ordinary prose. The copy is now
 * honest about the default (bare word) behavior, and a live hint
 * shows exactly what will fire the snippet whenever normalization
 * (or prefix mode) changes what was typed. */
export class AddSnippetModal extends Modal {
    onConfirm?: (
        snippet: { trigger: string; replacement: string; group: string }
    ) => void | SnippetOpResult | Promise<void | SnippetOpResult>;
    private expansion?: ExpansionHintSettings;

    constructor(
        app: App,
        onConfirm?: (
            snippet: { trigger: string; replacement: string; group: string }
        ) => void | SnippetOpResult | Promise<void | SnippetOpResult>,
        expansion?: ExpansionHintSettings,
    ) {
        super(app);
        this.onConfirm = onConfirm;
        this.expansion = expansion;
    }

    onOpen(): void {
        const { contentEl, titleEl } = this;
        // Wording (redesign): title now matches the button that opens
        // it ("Add snippet") — "Add new snippet" vs. "Add snippet" was
        // two names for one thing.
        titleEl.setText("Add snippet");
        contentEl.addClass("snipsidian-modal");

        let trigger = "";
        let replacement = "";
        let group = "";
        // Ref-object so TS doesn't narrow the field to `never` after
        // the synchronously-invoked `addText` callback (control flow
        // analysis can't prove the callback ran before later code).
        const refs: { trigger?: HTMLInputElement } = {};

        const triggerSetting = new Setting(contentEl)
            .setName("Trigger")
            .setDesc("The text that expands into your replacement. Use letters, numbers and symbols like -> or <=; no spaces, slashes or $")
            .addText((text) => {
                refs.trigger = text.inputEl;
                text
                    .setPlaceholder("Example: brb")
                    .setValue(trigger)
                    .onChange((value) => {
                        trigger = value;
                        updateHint();
                    });
            });

        // B-137/F5f: live hint, same `aria-live="polite"` pattern as
        // the group-rename modal's "Will be saved as: …" hint — lives
        // in the Trigger row's own `descEl`, as a second line under
        // its static description, instead of a separate div after the
        // row (AUDIT: "renders as a full-size line with a divider
        // under it, so it looks like a fourth setting"). Shown only
        // when normalization (or prefix mode) changes what the user
        // typed.
        const hintEl = triggerSetting.descEl.createDiv({
            cls: "snipsy-hint snipsidian-addsnippet-hint",
            attr: { "aria-live": "polite" },
        });
        hintEl.hide();
        const updateHint = () => {
            const msg = computeTriggerHint(trigger, this.expansion);
            if (msg) {
                hintEl.setText(msg);
                hintEl.show();
            } else {
                hintEl.hide();
            }
        };

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

        // B-088: aria-live="polite" so AT users hear validation errors
        // (including the B-133 planAddSnippet failure path below) as
        // they appear, without losing input focus — same pattern as
        // TextPromptModal's error div.
        const err = contentEl.createDiv({
            cls: "snipsidian-error",
            attr: { "aria-live": "polite" },
        });
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

            const outcome = this.onConfirm?.({ trigger: trimmedTrigger, replacement, group: trimmedGroup });
            void Promise.resolve(outcome)
                .then((result) => {
                    if (result && result.ok === false) {
                        err.empty();
                        err.createSpan({ text: result.error });
                        err.show();
                        return;
                    }
                    // `undefined`/`void` (no result reported) or
                    // `{ ok: true }`: treat as success.
                    this.close();
                })
                .catch((error) => {
                    // CLAUDE.md §4: never swallow errors. A rejected
                    // onConfirm (e.g. plugin.saveSettings() failing)
                    // used to leave the modal open with zero user
                    // feedback — log AND surface it inline, same as
                    // every other failure path in this handler.
                    console.error("Error in onConfirm callback:", error);
                    const message = error instanceof Error ? error.message : String(error);
                    err.empty();
                    err.createSpan({ text: `Could not save snippet: ${message}` });
                    err.show();
                });
        };

        const cancel = footer.createEl("button", { text: "Cancel" });
        cancel.onclick = () => this.close();

        // B-087: focus the Trigger field on open so the user can
        // start typing immediately. Skips Obsidian's default of
        // putting focus on the modal frame, which screen readers
        // announce as the modal title instead of the first input.
        refs.trigger?.focus();
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
                // Wording (redesign): sentence case instead of
                // shouting all-caps tags.
                text: tag === "new" ? "New" : tag === "update" ? "Update" : "Remove",
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
