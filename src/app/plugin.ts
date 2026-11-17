import { Plugin } from "obsidian";
import { buildExpansionExtension } from "./cm6-bridge";
import { SnipSidianSettingTab } from "../ui/settings";
import { defaultSnippetsAsGroup } from "../store/presets";
import type { SnipSidianSettings } from "../types";
import { getDict, getAllSnippetsFlat } from "../store/snippets";
import { SnippetPickerService } from "../core/snippet-picker";
import { openSnippetPickerModal } from "../ui/components/SnippetPickerModal";
import { openAddSnippetFromSelection } from "../ui/components/AddFromSelection";
import { expandTriggerAtCursor, jumpToNextField } from "./field-commands";

export default class HotstringsPlugin extends Plugin {
    settings!: SnipSidianSettings;

    async onload() {
        await this.loadSettings();

        // B-149: registered as a CM6 editor extension (gated on
        // genuine-typing `userEvent`s — see `change-source-gate.ts`)
        // instead of the old bare `workspace.on("editor-change")`
        // hook. `registerEditorExtension` is managed by Obsidian's
        // Component lifecycle — no manual disposer to track or call
        // in `onunload` (unlike the old `this.off`).
        //
        // B-137: `getPrefix` resolves the effective prefix char at
        // call time from live settings — `undefined` (mode off)
        // unless the user has opted in via the General tab.
        const getPrefix = (): string | undefined => {
            if (!this.settings.expansion?.requirePrefix) return undefined;
            const char = this.settings.expansion.prefixChar;
            // Hardening: clamp to the supported set — corrupt or
            // foreign saved data (anything other than ":" or ";")
            // must not silently kill all expansion in prefix mode.
            return char === ":" || char === ";" ? char : ":";
        };
        this.registerEditorExtension(
            buildExpansionExtension(
                this.app,
                () => getDict(this.settings),
                getPrefix,
                // B-176: read at use time, so toggling needs no reload.
                () => this.settings.expansion?.highlight === true,
            ),
        );

        // Snippet Picker command
        this.addCommand({
            id: "insert-snippet",
            name: "Insert snippet…",
            // B-215: without an icon the mobile toolbar shows a "?".
            icon: "text-cursor-input",
            callback: () => {
                const snippets = getAllSnippetsFlat(this.settings);
                const api = new SnippetPickerService(snippets);
                openSnippetPickerModal(this.app, api);
            }
        });

        // B-175: turn the current selection into a snippet. Only offered
        // while something is selected; the note is never modified.
        this.addCommand({
            id: "add-snippet-from-selection",
            name: "Add snippet from selection",
            icon: "text-select",
            editorCheckCallback: (checking, editor) => {
                const selection = editor.getSelection();
                if (selection.length === 0) return false;
                if (!checking) openAddSnippetFromSelection(this, selection);
                return true;
            }
        });

        // B-244: expands the trigger right before the caret without a
        // separator (same guards as typing); with no trigger, jumps to the
        // next field of an open B-243 session. No default hotkey.
        this.addCommand({
            id: "expand-trigger",
            name: "Expand trigger at cursor",
            icon: "zap",
            editorCallback: (editor) => {
                expandTriggerAtCursor(this.app, editor, () => getDict(this.settings), getPrefix).catch((err: unknown) => {
                    console.error("[snipsy] expand-trigger error", err);
                });
            },
        });

        // B-243: the Tab key is the main way; this is for a keyboard-less
        // device (mobile toolbar) or a custom hotkey. No default hotkey.
        this.addCommand({
            id: "next-field",
            name: "Next field",
            icon: "arrow-right-to-line",
            editorCallback: (editor) => {
                jumpToNextField(editor);
            },
        });

        // Open Settings command
        this.addCommand({
            id: "open-settings",
            name: "Open settings",
            icon: "settings",
            callback: () => {
                this.app.setting.open();
                this.app.setting.openTabById(this.manifest.id);
            }
        });

        this.addSettingTab(new SnipSidianSettingTab(this.app, this));
    }

    async loadSettings() {
        const saved = (await this.loadData()) as Partial<SnipSidianSettings> | null;
        if (saved?.snippets) {
            // Existing install: the stored map is the source of truth. Never
            // re-merge DEFAULT_SNIPPETS here — doing so resurrected deleted or
            // renamed defaults on every launch (B-130, issues #55/#56).
            this.settings = { ...saved, snippets: saved.snippets };
        } else {
            // First install (no data.json, or one without a snippets map):
            // seed the shipped defaults once and persist immediately, so a
            // later delete/rename of a default snippet sticks. Seeded as the
            // "Defaults" group (B-131) so the set is one deletable unit in
            // the Snippets tab and restorable from the General tab.
            this.settings = { ...saved, snippets: defaultSnippetsAsGroup() };
            await this.saveSettings();
        }
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}
