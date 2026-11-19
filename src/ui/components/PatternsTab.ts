import { App, Menu, Notice, Platform, Setting, ToggleComponent, setIcon } from "obsidian";
import type SnipSidianPlugin from "../../main";
import { compilePatternRules, MAX_PATTERN_RULES } from "../../engine/patterns";
import type { PatternMode, PatternRule } from "../../engine/types";
import { formatWithMoment } from "../../adapters/obsidian-editor";
import { storedRuleProblem, validatePatternDraft, type PatternDraft } from "../../core/pattern-draft";
import { pausedLine, PAUSED_FLAIR } from "../../core/pattern-health";
import {
    addMissingStarter,
    appendRule,
    commitPatterns,
    describeUnreadable,
    freeSlots,
    isRuleObject,
    locateRule,
    missingStarterRules,
    moveRule,
    moveRuleTo,
    newPatternId,
    patternsUnreadable,
    readPatterns,
    removeRule,
    replaceRule,
    ruleId,
    withUniqueIds,
} from "../../core/pattern-list";
import { STARTER_RULES } from "../../core/pattern-starter";
import { capTryItLine, replayTryIt, TRY_IT_MAX_LINE } from "../../core/pattern-tryit";
import { displayGroupTitle, slugifyGroup, splitKey } from "../../store/keys";
import { effectivePrefix, expandsOnType } from "../../store/expansion-mode";
import { getDict } from "../../store/snippets";
import { PATTERN_PLACEHOLDER_HINT_TEXT, renderPlaceholderHint } from "../utils/placeholder-hint";
import { describeTryItStatus, fieldMark, tryItLabel, tryItPieces } from "../utils/pattern-tryit-view";
import { ConfirmModal } from "./Modals";

/**
 * ADR-0008: the Patterns page (design: `2026-11-18-patterns-page-design.md`). One renderer for both mounts: the
 * declarative page on 1.13+ and the fourth tab below it. The list is the source of truth for priority (top to bottom,
 * first match wins); the editor works on a draft and writes only a rule the S-015 gate accepts, so the only way a
 * refused rule shows up here is a rule that came from import, sync, a hand edit or an older version (Error state).
 * Every write goes through `commitPatterns` and `plugin.saveSettings()`, which recompiles the live rules.
 */

export const INSTANT_NEEDS_TYPING =
    "Instant rules need Expand while typing, which is off. Choose After a separator to use it with Tab.";
export const PATTERNS_FOOTER = "Backups in General include your patterns. Espanso regex entries import from Packages.";
export const PATTERNS_INTRO = "They run top to bottom and the first match wins. Snippets are tried first.";
export const PATTERN_DESC = "Write it between slashes and end with $. Flag i is allowed.";
export const CAPTURE_HINT = "{{1}} inserts what group 1 matched, {{name}} a named group. $1 is a Tab stop, as in snippets.";
export const PATTERNS_UNREADABLE =
    "Your saved patterns could not be read, so they are shown as empty. Starting a new list replaces them.";
export const TRY_IT_CUT = `Only the first ${TRY_IT_MAX_LINE} characters were tried.`;
const CAP_TEXT = `${MAX_PATTERN_RULES} rules is the most. Delete one to add another.`;
const MODE_LABELS: Record<PatternMode, { name: string; desc: string }> = {
    instant: { name: "Instant", desc: "Replaces as soon as the text matches." },
    separator: { name: "After a separator", desc: "Waits for a space, Enter or punctuation, so 1/23 can finish." },
};
const MAX_GROUP_LENGTH = 60;

type RowState = "on" | "off" | "group-off" | "paused" | "error";

/** A stored entry as the page shows it (an entry from a hand-edited data.json may lack any field). */
type RowView = {
    index: number;
    /** The unique id of a rule; `""` for an entry that is not an object (`isRule` false): it can only be deleted. */
    id: string;
    isRule: boolean;
    source: string;
    replacement: string;
    mode: PatternMode;
    enabled: boolean;
    group: string | undefined;
    state: RowState;
    /** The line under the row: why it is refused or paused, or a warning. */
    note: string | undefined;
};

/** What a delete aims at: a rule by id (its row may be stale), an entry that is not a rule by its slot. */
type DeleteTarget = { id: string } | { slot: number };

const deleteTarget = (row: RowView): DeleteTarget => (row.isRule ? { id: row.id } : { slot: row.index });

type EditorState = {
    /** The rule's unique id (`withUniqueIds`): the page finds the rule again by it, wherever it sits now. */
    id: string;
    isNew: boolean;
    draft: PatternDraft & { group: string };
    /** The group as shown when the editor opened: an unchanged field keeps the stored slug. */
    originalGroupTitle: string;
    originalGroup: string | undefined;
    /** The last draft the gate accepted: Try it keeps working while the pattern has an error. */
    lastValid: PatternDraft | null;
    tryLine: string;
};

type EditorUi = {
    patternInput: HTMLInputElement;
    replacementInput: HTMLTextAreaElement;
    groupInput: HTMLInputElement;
    patternErr: HTMLElement;
    replacementErr: HTMLElement;
    warnings: HTMLElement;
    groupErr: HTMLElement;
    typingWarning: HTMLElement;
    saveBtn: HTMLButtonElement;
    resultBox: HTMLElement;
    status: HTMLElement;
};

export class PatternsTab {
    private root: HTMLElement | null = null;
    private editing: EditorState | null = null;
    private liveEl: HTMLElement | null = null;
    private validateTimer: number | null = null;
    private trySeq = 0;
    private dragFrom: string | null = null;
    private saving = false;
    /** Every write to settings goes through this chain, one at a time, so a slow save cannot be overtaken. */
    private writeQueue: Promise<void> = Promise.resolve();
    private pendingFocus: { id: string; part: "main" | "menu" } | null = null;
    private pendingFocusEditor = false;
    private pendingAnnounce: string | null = null;
    private editorUi: EditorUi | null = null;
    /**
     * `settings.patterns` with unique ids (`withUniqueIds`), kept per stored array so the ids stay the same between
     * reads, also when a failed save puts the old array back. The stored array is never changed here: an id lands in
     * `settings.patterns` with the next write, so opening the page writes nothing and the engine keeps compiling the
     * stored entries until then.
     */
    private readonly withIds = new WeakMap<object, { entries: unknown[]; list: PatternRule[] }>();

    constructor(
        private readonly app: App,
        private readonly plugin: SnipSidianPlugin,
    ) {}

    // ---- data ----

    private list(): PatternRule[] {
        const stored = readPatterns(this.plugin.settings);
        const memo = this.withIds.get(stored);
        if (memo && memo.entries.length === stored.length && memo.entries.every((entry, i) => entry === stored[i])) return memo.list;
        const list = withUniqueIds(stored);
        this.withIds.set(stored, { entries: [...stored], list });
        return list;
    }

    private unreadable(): boolean {
        return patternsUnreadable(this.plugin.settings);
    }

    private rows(): RowView[] {
        const settings = this.plugin.settings;
        const muted = new Set(settings.disabledGroups ?? []);
        const paused = new Map(this.plugin.patternHealth().switchedOff.map((p) => [p.id, p.reason]));
        const typing = expandsOnType(settings);
        // The engine and the problems read what is stored; the page addresses the rules by their unique ids.
        const stored: unknown[] = readPatterns(settings);
        return this.list().map((entry: unknown, index): RowView => {
            const raw = stored[index];
            const isRule = isRuleObject(entry);
            const o = isRule ? entry : {};
            const read = (key: string): unknown => Reflect.get(o, key);
            const id = ruleId(entry) ?? "";
            const modeRaw = read("mode");
            const mode: PatternMode = modeRaw === "separator" ? "separator" : "instant";
            const group = typeof read("group") === "string" && read("group") !== "" ? String(read("group")) : undefined;
            const enabled = read("enabled") === true;
            const problem = storedRuleProblem(raw, index);
            const pausedReason = paused.get(ruleId(raw) ?? id);
            const groupOff = group !== undefined && muted.has(group);
            let state: RowState = enabled ? "on" : "off";
            let note: string | undefined;
            if (problem !== null) {
                state = "error";
                note = problem;
            } else if (pausedReason !== undefined && enabled && !groupOff) {
                state = "paused";
                note = pausedLine(pausedReason);
            } else if (groupOff) {
                state = "group-off";
            } else if (enabled && mode === "instant" && !typing) {
                note = INSTANT_NEEDS_TYPING;
            }
            return {
                index,
                id,
                isRule,
                source: typeof read("source") === "string" ? String(read("source")) : "",
                replacement: typeof read("replacement") === "string" ? String(read("replacement")) : "",
                mode,
                enabled,
                group,
                state,
                note,
            };
        });
    }

    /** Error count for the page entry (`status: "warning"`). */
    errorCount(): number {
        return readPatterns(this.plugin.settings).reduce((n, raw: unknown, i) => (storedRuleProblem(raw, i) === null ? n : n + 1), 0);
    }

    /** Group titles the page suggests, each with the stored slug it stands for (a title does not round-trip through `slugifyGroup`). */
    private groupSuggestions(): Map<string, string> {
        const slugs = new Set<string>();
        for (const rule of this.list()) {
            const group: unknown = typeof rule === "object" && rule !== null ? Reflect.get(rule, "group") : undefined;
            if (typeof group === "string" && group !== "") slugs.add(group);
        }
        for (const key of Object.keys(this.plugin.settings.snippets)) {
            const { group } = splitKey(key);
            if (group) slugs.add(group);
        }
        const byTitle = new Map<string, string>();
        for (const slug of slugs) {
            const title = displayGroupTitle(slug);
            if (!byTitle.has(title)) byTitle.set(title, slug);
        }
        return byTitle;
    }

    // ---- render ----

    render(root: HTMLElement): void {
        this.root = root;
        this.renderAll();
    }

    private renderAll(): void {
        const root = this.root;
        if (!root) return;
        this.clearTimer();
        root.empty();
        const wrap = root.createDiv({ cls: "snipsy-patterns" });
        if (this.unreadable()) {
            this.renderUnreadable(wrap);
            return;
        }
        // The open editor follows its rule by id; a rule that is gone (deleted, replaced by sync) closes it.
        if (this.editing && !this.editing.isNew && locateRule(this.list(), this.editing.id) < 0) this.editing = null;
        const rows = this.rows();
        const atCap = this.list().length >= MAX_PATTERN_RULES;

        const header = new Setting(wrap)
            .setName("Rules")
            .setDesc(PATTERNS_INTRO)
            .addButton((b) =>
                b
                    .setButtonText("Add rule")
                    .setCta()
                    .setDisabled(atCap)
                    .onClick(() => this.openNew()),
            );
        header.settingEl.addClass("snipsy-patterns-header");
        if (atCap) header.descEl.createDiv({ cls: "snipsy-hint snipsy-patterns-cap", text: CAP_TEXT });

        const showList = rows.length > 0 || this.editing?.isNew === true;
        if (showList) {
            const list = wrap.createDiv({ cls: "snipsy-pattern-list", attr: { role: "list", "aria-label": "Pattern rules" } });
            for (const row of rows) this.renderRow(list, row, rows.length);
            if (this.editing?.isNew) this.renderNewRow(list, rows.length);
        } else {
            this.renderEmpty(wrap);
        }

        this.renderStarterRow(wrap);
        wrap.createDiv({ cls: "snipsy-hint snipsy-patterns-footer", text: PATTERNS_FOOTER });

        this.liveEl = wrap.createDiv({ cls: "snipsy-visually-hidden", attr: { "aria-live": "polite", role: "status" } });
        this.applyPendingFocus(wrap);
        const said = this.pendingAnnounce;
        this.pendingAnnounce = null;
        // Set after the region is in the page, so a screen reader sees a change rather than a new element.
        if (said !== null) window.setTimeout(() => this.liveEl?.setText(said), 30);
    }

    /** `settings.patterns` holds something that is not a list: say so, and write nothing until the person agrees. */
    private renderUnreadable(wrap: HTMLElement): void {
        new Setting(wrap)
            .setName("Rules")
            .setDesc(PATTERNS_UNREADABLE)
            .addButton((b) =>
                b
                    .setButtonText("Start a new list")
                    .onClick(() => void this.startNewList()),
            ).settingEl.addClass("snipsy-patterns-header", "snipsy-patterns-unreadable");
    }

    private async startNewList(): Promise<void> {
        const ok = await this.enqueue(async () => {
            if (!this.unreadable()) return true;
            console.warn("[snipsy] replacing unreadable pattern rules with a new list", describeUnreadable(this.plugin.settings.patterns));
            return this.commit([]);
        });
        if (ok) this.renderAll();
    }

    private renderEmpty(wrap: HTMLElement): void {
        const empty = wrap.createDiv({ cls: "snipsy-empty snipsy-patterns-empty" });
        empty.createEl("p", { text: "No pattern rules yet.", cls: "snipsy-empty-title" });
        empty.createEl("p", { text: "Add one, or start with the typography set: fractions, arrows, ≠, ≤, ± and more." });
        const btn = empty.createEl("button", { text: "Add typography set", cls: "mod-cta", attr: { type: "button" } });
        btn.addEventListener("click", () => void this.addStarter());
    }

    private renderStarterRow(wrap: HTMLElement): void {
        const missing = missingStarterRules(this.list());
        if (missing.length === 0) return;
        // The empty state offers the set itself.
        if (this.list().length === 0 && this.editing === null) return;
        const free = freeSlots(this.list());
        const fits = missing.length <= free;
        const row = new Setting(wrap)
            .setName("Typography set")
            .setDesc(
                fits
                    ? `${STARTER_RULES.length} rules in the Typography group. Adds only the ones you don't have.`
                    : `Needs ${missing.length} free slots. You have ${free}.`,
            )
            .addButton((b) =>
                b
                    .setButtonText(`Add ${missing.length} missing`)
                    .setDisabled(!fits)
                    .onClick(() => void this.addStarter()),
            );
        row.settingEl.addClass("snipsy-patterns-starter");
    }

    private renderRow(list: HTMLElement, row: RowView, total: number): void {
        const open = row.isRule && this.editing !== null && !this.editing.isNew && this.editing.id === row.id;
        const position = row.index + 1;
        const el = list.createDiv({
            cls: `snipsy-pattern-row is-${row.state}${open ? " is-open" : ""}`,
            attr: row.isRule ? { role: "listitem", "data-id": row.id } : { role: "listitem" },
        });
        const head = el.createDiv({ cls: "snipsy-pattern-head" });

        if (!Platform.isMobile && row.isRule) {
            const handle = head.createSpan({ cls: "snipsy-pattern-handle", attr: { draggable: "true", "aria-hidden": "true" } });
            setIcon(handle, "grip-vertical");
            handle.addEventListener("dragstart", (e: DragEvent) => {
                this.dragFrom = row.id;
                e.dataTransfer?.setData("text/plain", row.id);
                if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
            });
            handle.addEventListener("dragend", () => {
                this.dragFrom = null;
                list.querySelectorAll(".is-drop-target").forEach((n) => n.removeClass("is-drop-target"));
            });
            el.addEventListener("dragover", (e: DragEvent) => {
                if (this.dragFrom === null) return;
                e.preventDefault();
                el.addClass("is-drop-target");
            });
            el.addEventListener("dragleave", () => el.removeClass("is-drop-target"));
            el.addEventListener("drop", (e: DragEvent) => {
                e.preventDefault();
                el.removeClass("is-drop-target");
                const from = this.dragFrom;
                this.dragFrom = null;
                if (from !== null) void this.reorderTo(from, row.id);
            });
        }

        head.createSpan({ cls: "snipsy-pattern-num", text: String(position), attr: { "aria-hidden": "true" } });

        const modeName = MODE_LABELS[row.mode].name;
        const main = head.createEl("button", {
            cls: "snipsy-pattern-main",
            attr: {
                type: "button",
                ...(row.isRule ? { "aria-expanded": open ? "true" : "false" } : {}),
                "aria-label": [`Rule ${position}`, row.source, row.mode === "instant" ? "instant" : "after a separator", row.group ? displayGroupTitle(row.group) : "", row.state === "error" ? "error" : ""]
                    .filter((part) => part !== "")
                    .join(", "),
            },
        });
        const line = main.createDiv({ cls: "snipsy-pattern-line" });
        line.createSpan({ cls: "snipsy-pattern-src", text: row.source });
        line.createSpan({ cls: "snipsy-pattern-arrow", text: "→", attr: { "aria-hidden": "true" } });
        const rep = line.createSpan({ cls: "snipsy-pattern-rep" });
        row.replacement.split("\n").forEach((part, i) => {
            if (i > 0) rep.createSpan({ cls: "nl", text: "↵" });
            rep.appendText(part);
        });
        if (row.state === "error") line.createSpan({ cls: "snipsy-pattern-flair is-error", text: "Error" });
        else if (row.state === "paused") line.createSpan({ cls: "snipsy-pattern-flair", text: PAUSED_FLAIR });
        else if (row.state === "group-off") line.createSpan({ cls: "group-off-flair", text: "Group off" });
        main.createDiv({ cls: "snipsy-pattern-meta", text: row.group ? `${modeName} · ${displayGroupTitle(row.group)}` : modeName });
        main.addEventListener("click", () => this.toggleEditor(row));
        main.addEventListener("keydown", (e: KeyboardEvent) => this.onRowKey(e, row));

        if (row.isRule) {
            const toggle = new ToggleComponent(head).setValue(row.enabled && row.state !== "error");
            toggle.toggleEl.addClass("snipsy-pattern-toggle");
            const refused = row.state === "error";
            toggle.setDisabled(refused);
            toggle.setTooltip(refused ? "Fix the error to turn this rule on" : `Turn on rule ${position}`);
            toggle.onChange((value) => void this.setEnabled(row.id, value));
        }

        const menuBtn = head.createEl("button", {
            cls: "snippet-icon-action snipsy-pattern-menu",
            attr: { type: "button", "aria-label": `More actions for rule ${position}`, "aria-haspopup": "menu" },
        });
        setIcon(menuBtn, "more-horizontal");
        menuBtn.addEventListener("click", () => this.openMenu(menuBtn, row, total));

        if (row.note !== undefined) {
            el.createDiv({ cls: `snipsy-pattern-note${row.state === "error" ? " is-error" : ""}`, text: row.note });
        }
        if (open && this.editing) this.renderEditor(el, this.editing, position);
    }

    private renderNewRow(list: HTMLElement, existing: number): void {
        const ed = this.editing;
        if (!ed) return;
        const el = list.createDiv({ cls: "snipsy-pattern-row is-open is-new", attr: { role: "listitem", "data-id": ed.id } });
        const head = el.createDiv({ cls: "snipsy-pattern-head" });
        head.createSpan({ cls: "snipsy-pattern-num", text: String(existing + 1), attr: { "aria-hidden": "true" } });
        head.createDiv({ cls: "snipsy-pattern-new-title", text: "New rule" });
        this.renderEditor(el, ed, existing + 1);
    }

    // ---- editor ----

    private renderEditor(host: HTMLElement, ed: EditorState, position: number): void {
        const editor = host.createDiv({ cls: "snipsy-pattern-editor", attr: { role: "group", "aria-label": `Edit rule ${position}` } });
        const uid = `snipsy-pat-${position}`;
        const field = (name: string, id: string, cls = ""): { wrap: HTMLElement; label: HTMLElement } => {
            const wrap = editor.createDiv({ cls: `field ${cls}`.trim() });
            const label = wrap.createEl("label", { text: name, attr: { for: id } });
            return { wrap, label };
        };
        const noAutoText = (el: HTMLElement): void => {
            el.setAttr("autocapitalize", "off");
            el.setAttr("autocorrect", "off");
            el.setAttr("autocomplete", "off");
            el.setAttr("spellcheck", "false");
        };

        // Pattern
        const pattern = field("Pattern", `${uid}-pattern`);
        const patternInput = pattern.wrap.createEl("input", {
            cls: "snipsy-mono",
            attr: { type: "text", id: `${uid}-pattern`, placeholder: "/(\\d+)\\/(\\d+)$/", "aria-describedby": `${uid}-pattern-hint ${uid}-pattern-err` },
        });
        noAutoText(patternInput);
        patternInput.value = ed.draft.source;
        pattern.wrap.createDiv({ cls: "snipsy-hint", text: PATTERN_DESC, attr: { id: `${uid}-pattern-hint` } });
        const patternErr = pattern.wrap.createDiv({ cls: "snipsidian-error", attr: { id: `${uid}-pattern-err` } });

        // Replacement
        const replacement = field("Replacement", `${uid}-replacement`, "is-full");
        const replacementInput = replacement.wrap.createEl("textarea", {
            cls: "snipsy-mono",
            attr: { id: `${uid}-replacement`, rows: "3", "aria-describedby": `${uid}-replacement-hint ${uid}-replacement-err` },
        });
        noAutoText(replacementInput);
        replacementInput.value = ed.draft.replacement;
        const hintHost = replacement.wrap.createDiv({ attr: { id: `${uid}-replacement-hint` } });
        hintHost.createDiv({ cls: "snipsy-hint snipsidian-placeholder-hint", text: CAPTURE_HINT });
        renderPlaceholderHint(hintHost, PATTERN_PLACEHOLDER_HINT_TEXT);
        const replacementErr = replacement.wrap.createDiv({ cls: "snipsidian-error", attr: { id: `${uid}-replacement-err` } });
        const warnings = replacement.wrap.createDiv({ cls: "snipsy-pattern-warnings snipsy-hint" });

        // Fires
        const fires = field("Fires", `${uid}-mode`);
        const select = fires.wrap.createEl("select", { cls: "dropdown", attr: { id: `${uid}-mode`, "aria-describedby": `${uid}-mode-desc ${uid}-typing` } });
        for (const mode of ["instant", "separator"] as const) {
            select.createEl("option", { text: MODE_LABELS[mode].name, value: mode });
        }
        select.value = ed.draft.mode;
        const modeDesc = fires.wrap.createDiv({ cls: "snipsy-hint", attr: { id: `${uid}-mode-desc` }, text: MODE_LABELS[ed.draft.mode].desc });
        const typingWarning = fires.wrap.createDiv({ cls: "snipsy-pattern-note", attr: { id: `${uid}-typing` } });

        // Group
        const group = field("Group", `${uid}-group`);
        const groupList = `${uid}-groups`;
        const groupInput = group.wrap.createEl("input", { attr: { type: "text", id: `${uid}-group`, list: groupList, maxlength: String(MAX_GROUP_LENGTH), "aria-describedby": `${uid}-group-err` } });
        groupInput.value = ed.draft.group;
        const datalist = group.wrap.createEl("datalist", { attr: { id: groupList } });
        for (const title of this.groupSuggestions().keys()) datalist.createEl("option", { value: title });
        const groupErr = group.wrap.createDiv({ cls: "snipsidian-error", attr: { id: `${uid}-group-err` } });

        // Try it
        const tryField = field("Try it", `${uid}-try`, "is-full");
        const tryInput = tryField.wrap.createEl("input", {
            cls: "snipsy-mono",
            attr: { type: "text", id: `${uid}-try`, placeholder: "Type a line, like 1/23", "aria-describedby": `${uid}-try-status` },
        });
        noAutoText(tryInput);
        tryInput.value = ed.tryLine;
        const resultBox = tryField.wrap.createDiv({ cls: "snipsy-tryit-result snipsy-mono" });
        const status = tryField.wrap.createDiv({ cls: "snipsy-hint snipsy-tryit-status", attr: { id: `${uid}-try-status`, "aria-live": "polite" } });

        // Footer
        const footer = editor.createDiv({ cls: "snipsy-pattern-footer" });
        if (!ed.isNew) {
            const del = footer.createEl("button", { text: "Delete", cls: "mod-warning snipsy-pattern-delete", attr: { type: "button" } });
            del.addEventListener("click", () => {
                this.confirmDelete({ id: ed.id });
            });
        }
        const spacer = footer.createDiv({ cls: "snipsy-pattern-footer-spacer" });
        spacer.setAttr("aria-hidden", "true");
        const cancel = footer.createEl("button", { text: "Cancel", attr: { type: "button" } });
        cancel.addEventListener("click", () => this.cancelEditor());
        const saveBtn = footer.createEl("button", { text: "Save", cls: "mod-cta", attr: { type: "button" } });
        saveBtn.addEventListener("click", () => void this.save());

        const ui: EditorUi = { patternInput, replacementInput, groupInput, patternErr, replacementErr, warnings, groupErr, typingWarning, saveBtn, resultBox, status };
        this.editorUi = ui;

        const changed = (): void => {
            this.scheduleValidation(ed, ui);
        };
        patternInput.addEventListener("input", () => {
            ed.draft.source = patternInput.value;
            changed();
        });
        replacementInput.addEventListener("input", () => {
            ed.draft.replacement = replacementInput.value;
            changed();
        });
        groupInput.addEventListener("input", () => {
            ed.draft.group = groupInput.value;
            changed();
        });
        select.addEventListener("change", () => {
            ed.draft.mode = select.value === "separator" ? "separator" : "instant";
            modeDesc.setText(MODE_LABELS[ed.draft.mode].desc);
            changed();
        });
        tryInput.addEventListener("input", () => {
            ed.tryLine = tryInput.value;
            void this.refreshTryIt(ed, ui);
        });
        editor.addEventListener("keydown", (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                this.cancelEditor();
            } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void this.save();
            }
        });

        // First paint: errors are shown for what was already typed; an untouched new rule stays quiet.
        this.validateNow(ed, ui);
        if (ed.isNew || this.pendingFocusEditor) {
            this.pendingFocusEditor = false;
            patternInput.focus();
        }
    }

    private scheduleValidation(ed: EditorState, ui: EditorUi): void {
        this.clearTimer();
        this.validateTimer = window.setTimeout(() => {
            this.validateTimer = null;
            this.validateNow(ed, ui);
        }, 150);
    }

    private clearTimer(): void {
        if (this.validateTimer !== null) {
            window.clearTimeout(this.validateTimer);
            this.validateTimer = null;
        }
    }

    /** Runs the gate on the draft (with its mode) and paints errors, warnings, Save and Try it. Returns whether it can be saved. */
    private validateNow(ed: EditorState, ui: EditorUi): boolean {
        this.clearTimer();
        const issues = validatePatternDraft(ed.draft);
        const groupText = ed.draft.group.trim();
        const groupBad = groupText !== "" && slugifyGroup(groupText) === "";
        const show = (el: HTMLElement, input: HTMLElement | null, text: string | undefined): void => {
            el.setText(text ?? "");
            input?.setAttr("aria-invalid", text ? "true" : "false");
        };
        show(ui.patternErr, ui.patternInput, issues.pattern);
        show(ui.replacementErr, ui.replacementInput, issues.replacement);
        show(ui.groupErr, ui.groupInput, groupBad ? "Use at least one letter or number in the group name." : undefined);
        ui.warnings.empty();
        for (const w of issues.warnings) ui.warnings.createDiv({ text: w });
        ui.typingWarning.setText(ed.draft.mode === "instant" && !expandsOnType(this.plugin.settings) ? INSTANT_NEEDS_TYPING : "");
        const ok = issues.ok && !groupBad;
        ui.saveBtn.disabled = !ok;
        if (issues.ok) ed.lastValid = { source: ed.draft.source, replacement: ed.draft.replacement, mode: ed.draft.mode };
        void this.refreshTryIt(ed, ui);
        return ok;
    }

    private async refreshTryIt(ed: EditorState, ui: EditorUi): Promise<void> {
        const seq = ++this.trySeq;
        const settings = this.plugin.settings;
        if (ed.tryLine === "") {
            ui.resultBox.empty();
            ui.resultBox.addClass("is-hidden");
            ui.status.setText("");
            return;
        }
        if (!ed.lastValid) {
            ui.resultBox.empty();
            ui.resultBox.addClass("is-hidden");
            ui.status.setText("Fix the errors above to try this rule.");
            return;
        }
        // The draft takes its place in the order (or goes last, if new). It runs as if it were on, outside any muted group.
        const draftRule: PatternRule = { id: ed.id, enabled: true, ...ed.lastValid };
        const stored = this.list();
        const at = ed.isNew ? -1 : locateRule(stored, ed.id);
        const list: PatternRule[] = at < 0 ? [...stored, draftRule] : stored.map((r, i) => (i === at ? draftRule : r));
        const typed = capTryItLine(ed.tryLine);
        const compiled = compilePatternRules(list, settings.disabledGroups);
        const positions = new Map(list.flatMap((r, i): Array<[string, number]> => { const id = ruleId(r); return id === undefined ? [] : [[id, i + 1]]; }));
        const result = await replayTryIt({
            line: typed.line,
            rules: compiled.rules,
            positions,
            draftId: ed.id,
            snippets: getDict(settings),
            prefix: effectivePrefix(settings),
            expandWhileTyping: expandsOnType(settings),
            now: new Date(),
            formatDate: formatWithMoment,
        });
        if (seq !== this.trySeq || !ui.resultBox.isConnected) return;
        ui.resultBox.empty();
        ui.resultBox.removeClass("is-hidden");
        ui.resultBox.setAttr("aria-label", tryItLabel(result));
        for (const piece of tryItPieces(result)) {
            if (piece.kind === "text") ui.resultBox.appendText(piece.text);
            else if (piece.kind === "replaced") ui.resultBox.createSpan({ cls: "snipsy-tryit-replaced", text: piece.text });
            else if (piece.kind === "field") ui.resultBox.createSpan({ cls: "snipsy-tryit-field", text: fieldMark(piece.number), attr: { "aria-hidden": "true" } });
            else ui.resultBox.createSpan({ cls: "snipsy-tryit-caret", attr: { "aria-hidden": "true" } });
        }
        ui.status.setText([describeTryItStatus(result.status), typed.cut ? TRY_IT_CUT : ""].filter((part) => part !== "").join(" "));
    }

    // ---- editor actions ----

    private openNew(): void {
        if (this.list().length >= MAX_PATTERN_RULES) return;
        this.editing = {
            id: newPatternId(),
            isNew: true,
            draft: { source: "", replacement: "", mode: "instant", group: "" },
            originalGroupTitle: "",
            originalGroup: undefined,
            lastValid: null,
            tryLine: "",
        };
        this.renderAll();
    }

    private toggleEditor(row: RowView): void {
        if (!row.isRule) return;
        if (this.editing && !this.editing.isNew && this.editing.id === row.id) {
            this.cancelEditor();
            return;
        }
        const title = row.group ? displayGroupTitle(row.group) : "";
        this.editing = {
            id: row.id,
            isNew: false,
            draft: { source: row.source, replacement: row.replacement, mode: row.mode, group: title },
            originalGroupTitle: title,
            originalGroup: row.group,
            lastValid: null,
            tryLine: "",
        };
        this.pendingFocusEditor = true;
        this.renderAll();
    }

    private cancelEditor(): void {
        const id = this.editing?.id;
        const wasNew = this.editing?.isNew === true;
        this.editing = null;
        if (id !== undefined && !wasNew) this.pendingFocus = { id, part: "main" };
        this.renderAll();
        if (wasNew) this.focusAddButton();
    }

    private focusAddButton(): void {
        this.root?.querySelector<HTMLElement>(".snipsy-patterns-header button")?.focus();
    }

    private async save(): Promise<void> {
        const ed = this.editing;
        const ui = this.editorUi;
        if (!ed || !ui || this.saving) return;
        // The page may have waited out the debounce: check the draft as it is now.
        if (!this.validateNow(ed, ui)) return;
        this.saving = true;
        ui.saveBtn.disabled = true;
        try {
            const groupText = ed.draft.group.trim();
            const group =
                groupText === ed.originalGroupTitle
                    ? ed.originalGroup
                    : groupText === ""
                      ? undefined
                      : (this.groupSuggestions().get(groupText) ?? slugifyGroup(groupText));
            const rule: PatternRule = {
                id: ed.id,
                source: ed.draft.source,
                replacement: ed.draft.replacement,
                mode: ed.draft.mode,
                enabled: true,
                ...(group !== undefined ? { group } : {}),
            };
            const refusal: { text?: string } = {};
            const ok = await this.write((list) => {
                if (ed.isNew) {
                    const appended = appendRule(list, rule);
                    if (appended === null) refusal.text = CAP_TEXT;
                    return appended;
                }
                const at = locateRule(list, ed.id);
                const existing = list[at];
                let next: PatternRule[] | null = null;
                if (existing !== undefined) {
                    // `existing` is what the row showed: an entry that had no id is off (`withUniqueIds`) and stays
                    // off until the person turns it on. Other fields of the stored rule stay (a newer version's).
                    const enabled = existing.enabled === true;
                    const merged: PatternRule = { ...existing, ...rule, enabled };
                    if (group === undefined) delete merged.group;
                    next = replaceRule(list, at, merged);
                }
                if (next === null) refusal.text = "This rule is no longer in the list.";
                return next;
            });
            if (!ok) {
                if (refusal.text !== undefined) new Notice(refusal.text);
                return;
            }
            // The person may have closed or switched the editor while the save ran.
            if (this.editing === ed) this.editing = null;
            this.pendingFocus = { id: rule.id, part: "main" };
            this.announce(ed.isNew ? "Rule added." : "Rule saved.");
            this.renderAll();
        } finally {
            this.saving = false;
            if (ui.saveBtn.isConnected && this.editing === ed) this.validateNow(ed, ui);
        }
    }

    // ---- row actions ----

    /** Runs `task` after every earlier write has finished, whether it worked or not. */
    private enqueue<T>(task: () => Promise<T>): Promise<T> {
        const run = this.writeQueue.then(task, task);
        this.writeQueue = run.then(
            () => undefined,
            () => undefined,
        );
        return run;
    }

    /** One commit of `next` (rolled back if saving fails). Call it from the queue only. */
    private async commit(next: PatternRule[]): Promise<boolean> {
        try {
            await commitPatterns(this.plugin.settings, next, () => this.plugin.saveSettings());
            return true;
        } catch (err) {
            console.error("[snipsy] failed to save pattern rules", err);
            new Notice("Failed to save changes");
            this.renderAll();
            return false;
        }
    }

    /**
     * Queues a change to the list. `change` gets the list as it is when its turn comes (not as it was when the person
     * clicked) and returns the new one, or `null` to do nothing. Refused while the stored value is not a list.
     */
    private write(change: (list: PatternRule[]) => PatternRule[] | null, focus?: { id: string; part: "main" | "menu" }): Promise<boolean> {
        return this.enqueue(async () => {
            if (this.unreadable()) {
                new Notice("Your saved patterns could not be read. Start a new list first.");
                return false;
            }
            let next: PatternRule[] | null;
            try {
                next = change(this.list());
            } catch (err) {
                console.error("[snipsy] failed to prepare a change to the pattern rules", err);
                new Notice("Failed to save changes");
                return false;
            }
            if (next === null) return false;
            if (!(await this.commit(next))) return false;
            if (focus) this.pendingFocus = focus;
            return true;
        });
    }

    private async setEnabled(id: string, value: boolean): Promise<void> {
        const ok = await this.write((list) => {
            const at = locateRule(list, id);
            const rule = list[at];
            return rule === undefined ? null : replaceRule(list, at, { ...rule, enabled: value });
        });
        if (ok) this.renderAll();
    }

    /** `plan` gets the list and where `fromId` sits in it, and returns the moved list with the rule's new position. */
    private async reorder(fromId: string, plan: (list: PatternRule[], at: number) => { next: PatternRule[]; position: number } | null): Promise<void> {
        const moved: { id?: string; position: number; size: number } = { position: 0, size: 0 };
        const ok = await this.write((list) => {
            const at = locateRule(list, fromId);
            const planned = at < 0 ? null : plan(list, at);
            if (planned === null) return null;
            Object.assign(moved, { id: ruleId(planned.next[planned.position]), position: planned.position, size: planned.next.length });
            return planned.next;
        });
        if (ok && moved.id !== undefined) {
            this.pendingFocus = { id: moved.id, part: "main" };
            this.announce(`Moved to position ${moved.position + 1} of ${moved.size}`);
            this.renderAll();
        }
    }

    /** Drag and drop: `fromId` takes the place `toId` has now. */
    private reorderTo(fromId: string, toId: string): Promise<void> {
        return this.reorder(fromId, (list, at) => {
            const target = locateRule(list, toId);
            const next = target < 0 ? null : moveRuleTo(list, at, target);
            return next === null ? null : { next, position: target };
        });
    }

    private move(fromId: string, delta: -1 | 1): Promise<void> {
        return this.reorder(fromId, (list, at) => {
            const next = moveRule(list, at, delta);
            return next === null ? null : { next, position: at + delta };
        });
    }

    private async setGroupMuted(group: string, muted: boolean): Promise<void> {
        await this.enqueue(async () => {
            const settings = this.plugin.settings;
            const previous = settings.disabledGroups;
            const current = new Set(previous ?? []);
            if (muted) current.add(group);
            else current.delete(group);
            const next = Array.from(current);
            settings.disabledGroups = next;
            try {
                await this.plugin.saveSettings();
            } catch (err) {
                // Put it back only while it is still ours: a newer write may have replaced it.
                if (settings.disabledGroups === next) settings.disabledGroups = previous;
                console.error(`[snipsy] failed to ${muted ? "turn off" : "turn on"} pattern group "${group}"`, err);
                new Notice("Failed to save changes");
            }
        });
        this.renderAll();
    }

    private onRowKey(e: KeyboardEvent, row: RowView): void {
        if (e.altKey && e.key === "ArrowUp") {
            e.preventDefault();
            if (row.isRule) void this.move(row.id, -1);
        } else if (e.altKey && e.key === "ArrowDown") {
            e.preventDefault();
            if (row.isRule) void this.move(row.id, 1);
        } else if (e.key === "Delete") {
            e.preventDefault();
            this.confirmDelete(deleteTarget(row));
        }
    }

    private openMenu(anchor: HTMLElement, row: RowView, total: number): void {
        const menu = new Menu();
        if (row.isRule) {
            menu.addItem((item) =>
                item
                    .setTitle("Move up")
                    .setIcon("arrow-up")
                    .setDisabled(row.index === 0)
                    .onClick(() => void this.move(row.id, -1)),
            );
            menu.addItem((item) =>
                item
                    .setTitle("Move down")
                    .setIcon("arrow-down")
                    .setDisabled(row.index >= total - 1)
                    .onClick(() => void this.move(row.id, 1)),
            );
        }
        const group = row.group;
        if (row.isRule && group !== undefined) {
            const muted = (this.plugin.settings.disabledGroups ?? []).includes(group);
            menu.addItem((item) =>
                item
                    .setTitle(`${muted ? "Turn on" : "Turn off"} group ${displayGroupTitle(group)}`)
                    .setIcon(muted ? "eye" : "eye-off")
                    .onClick(() => void this.setGroupMuted(group, !muted)),
            );
        }
        menu.addItem((item) =>
            item
                .setTitle("Delete rule")
                .setIcon("trash")
                .setWarning(true)
                .onClick(() => this.confirmDelete(deleteTarget(row))),
        );
        const rect = anchor.getBoundingClientRect();
        menu.showAtPosition({ x: rect.left, y: rect.bottom });
    }

    /** Asks, then drops the entry: a rule is found by its id when asked and again when confirmed, an entry that is not a rule by its slot. */
    private confirmDelete(target: DeleteTarget): void {
        const id = "id" in target ? target.id : undefined;
        const index = "id" in target ? locateRule(this.list(), target.id) : target.slot;
        if (index < 0 || index >= this.list().length) return;
        const entry: unknown = this.list()[index];
        // A slot target is an entry that was not a rule; if a rule sits there now, the row is stale.
        if (id === undefined && isRuleObject(entry)) {
            new Notice("This rule is no longer in the list.");
            return;
        }
        const rawSource: unknown = isRuleObject(entry) ? Reflect.get(entry, "source") : undefined;
        const source = typeof rawSource === "string" ? rawSource : "";
        new ConfirmModal(this.app, {
            title: "Delete rule",
            message: `Delete rule ${index + 1}, ${source}? This cannot be undone.`,
            confirmText: "Delete",
            danger: true,
            onConfirm: async () => {
                const after: { id?: string } = {};
                const refusal: { text?: string } = {};
                const ok = await this.write((list) => {
                    const at = id !== undefined ? locateRule(list, id) : list[index] === entry ? index : -1;
                    if (at < 0) {
                        refusal.text = "This rule is no longer in the list.";
                        return null;
                    }
                    const next = removeRule(list, at);
                    after.id = ruleId(next[Math.min(at, next.length - 1)]);
                    return next;
                });
                if (!ok) {
                    if (refusal.text !== undefined) new Notice(refusal.text);
                    return;
                }
                if (id !== undefined && this.editing && !this.editing.isNew && this.editing.id === id) this.editing = null;
                if (after.id !== undefined) this.pendingFocus = { id: after.id, part: "main" };
                this.announce("Rule deleted.");
                this.renderAll();
            },
        }).open();
    }

    private async addStarter(): Promise<void> {
        let added = 0;
        const ok = await this.write((list) => {
            const next = addMissingStarter(list, newPatternId);
            if (next !== null) added = next.length - list.length;
            return next;
        });
        if (ok) {
            new Notice(`Added ${added} typography rule${added === 1 ? "" : "s"}`);
            this.announce(`Added ${added} rules.`);
            this.renderAll();
        }
    }

    // ---- a11y helpers ----

    /** Said after the next render: the live region is rebuilt with the page, so the text is set once it exists. */
    private announce(text: string): void {
        this.pendingAnnounce = text;
    }

    private applyPendingFocus(wrap: HTMLElement): void {
        const target = this.pendingFocus;
        this.pendingFocus = null;
        if (!target) return;
        for (const row of Array.from(wrap.querySelectorAll<HTMLElement>(".snipsy-pattern-row"))) {
            if (row.dataset.id !== target.id) continue;
            row.querySelector<HTMLElement>(target.part === "main" ? ".snipsy-pattern-main" : ".snipsy-pattern-menu")?.focus();
            return;
        }
    }
}
