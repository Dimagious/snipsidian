import { Notice, Plugin, type Editor } from "obsidian";
import { buildExpansionExtension } from "./cm6-bridge";
import { SnipSidianSettingTab } from "../ui/settings";
import { defaultSnippetsAsGroup } from "../store/presets";
import type { SnipSidianSettings } from "../types";
import { getDict, getAllSnippetsFlat } from "../store/snippets";
import { getCompiledPatterns, patternsSignature } from "../store/patterns";
import { patternHealth, type CompiledPatterns, type PatternHealth } from "../engine/patterns";
import { expandsOnTab, expandsOnType } from "../store/expansion-mode";
import { isTextSnippetsData } from "../store/migrations";
import { TEXT_SNIPPETS_PLUGIN_ID } from "../packages/text-snippets";
import { backupOriginalData, migrateTextSnippetsData, protectUnknownData } from "./text-snippets-migration";
import { sanitizeForNotice } from "../shared/notice-text";
import { SnippetPickerService } from "../core/snippet-picker";
import { openSnippetPickerModal } from "../ui/components/SnippetPickerModal";
import { openAddSnippetFromSelection } from "../ui/components/AddFromSelection";
import { expandTriggerAtCursor, jumpToNextField } from "./field-commands";

export default class HotstringsPlugin extends Plugin {
    settings!: SnipSidianSettings;
    /** ADR-0008: compiled pattern rules of the current settings; dropped when settings are loaded or the rules change. */
    private compiledPatterns: CompiledPatterns | undefined;
    /** `patternsSignature` of the settings `compiledPatterns` was built from. */
    private compiledSignature: string | undefined;

    private getPatterns(): CompiledPatterns {
        if (!this.compiledPatterns) {
            this.compiledPatterns = getCompiledPatterns(this.settings);
            this.compiledSignature = patternsSignature(this.settings);
        }
        return this.compiledPatterns;
    }

    /**
     * ADR-0008: what the runtime guard saw on the live compiled rules (switched-off rules, deadline cuts), for the
     * Patterns page. Reads the cached instance the hot path uses, never a fresh compile. Session only.
     */
    patternHealth(): PatternHealth {
        return patternHealth(this.getPatterns());
    }

    /** B-254: original Text Snippets file text while it has no backup yet. */
    private unsavedOriginal: string | null = null;
    /** One "changes are not being saved" Notice per session (backup failing). */
    private backupFailureShown = false;

    async onload() {
        await this.loadSettings();
        this.reportRefusedPatterns();

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
                // ADR-0008: rebuilt only when settings are saved, not per keystroke.
                () => this.getPatterns(),
                // B-255: both read at use time, so toggling needs no reload.
                () => expandsOnType(this.settings),
                () => expandsOnTab(this.settings),
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

        const runExpandTrigger = (editor: Editor, manual = false): void => {
            expandTriggerAtCursor(
                this.app,
                editor,
                () => getDict(this.settings),
                getPrefix,
                () => this.getPatterns(),
                { manual },
            ).catch((err: unknown) => {
                console.error("[snipsy] expand-trigger error", err);
            });
        };

        // B-244: expands the trigger right before the caret without a
        // separator (same guards as typing); with no trigger, jumps to the
        // next field of an open B-243 session. No default hotkey.
        this.addCommand({
            id: "expand-trigger",
            name: "Expand trigger at cursor",
            icon: "zap",
            editorCallback: (editor) => runExpandTrigger(editor),
        });

        // B-256: the compatibility build (this plugin shipped under the id of
        // "Text Snippets") keeps that plugin's command id and name, so hotkeys
        // users bound to it keep working. No default hotkey (the original's
        // Mod+Tab never worked reliably: Cmd+Tab belongs to macOS, Ctrl+Tab
        // switches tabs); plain Tab is the main path. Acts like the original:
        // a selection is the trigger, a caret inside a word takes the whole
        // word. Under `snipsidian` nothing is added.
        if (this.manifest.id === TEXT_SNIPPETS_PLUGIN_ID) {
            this.addCommand({
                id: "text-snippets",
                name: "Run snippet replacement",
                icon: "zap",
                editorCallback: (editor) => runExpandTrigger(editor, true),
            });
        }

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
        this.compiledPatterns = undefined;
        const loaded: unknown = await this.loadData();
        if (isTextSnippetsData(loaded)) {
            // B-254: a Text Snippets data.json (`snippets` is a string list,
            // not Snipsy's map). Convert it, keeping a copy of the original.
            const outcome = await migrateTextSnippetsData({
                adapter: this.app.vault.adapter,
                dir: this.pluginDir(),
                saved: loaded,
            });
            this.settings = outcome.settings;
            this.unsavedOriginal = outcome.unsavedOriginal;
            if (outcome.save) await this.saveSettings();
            return;
        }
        const saved = loaded as Partial<SnipSidianSettings> | null;
        const compat = this.manifest.id === TEXT_SNIPPETS_PLUGIN_ID;
        // A file under the compat id that is neither shape would fall into the
        // fresh-install branch and be overwritten: back it up first.
        const unknown = compat && loaded !== null && loaded !== undefined && !saved?.snippets;
        if (saved?.snippets) {
            // Existing install: the stored map is the source of truth. Never
            // re-merge DEFAULT_SNIPPETS here — doing so resurrected deleted or
            // renamed defaults on every launch (B-130, issues #55/#56).
            this.settings = { ...saved, snippets: saved.snippets };
        } else if (compat) {
            // B-255: fresh install of the compatibility build. Its users never
            // had Snipsy's defaults, so nothing is seeded, and it behaves like
            // Text Snippets did: Tab / command only, no expansion while typing.
            const guard = unknown
                ? await protectUnknownData({ adapter: this.app.vault.adapter, dir: this.pluginDir(), loaded })
                : { save: true, unsavedOriginal: null };
            const base = typeof saved === "object" && saved !== null && !Array.isArray(saved) ? saved : {};
            this.settings = {
                ...base,
                snippets: {},
                expansion: { onType: false, onTab: true, ...base.expansion },
            };
            this.unsavedOriginal = guard.unsavedOriginal;
            if (guard.save) await this.saveSettings();
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

    /**
     * ADR-0008: runs the saved pattern rules through the S-015 gate once at
     * load and reports each refused rule, so a bad rule from a synced or
     * hand-edited data.json is visible in the console. The rule is disabled
     * alone; the others keep working.
     */
    private reportRefusedPatterns(): void {
        for (const { id, reason } of this.getPatterns().errors) {
            console.warn("[snipsy] pattern rule disabled", { id, reason });
        }
    }

    /** The plugin's own folder (where `data.json` lives). */
    private pluginDir(): string {
        return this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
    }

    async saveSettings() {
        // Every settings change goes through here (the UI saves after each edit, the community cache saves after
        // each fetch). Recompile on the next keystroke only when the rules or the muted groups changed: an unrelated
        // save must not reset what the runtime guard learned (strikes, switch-offs). Before the backup guard below:
        // a refused save leaves the settings changed in memory, and rules compiled from the old ones must not go on
        // running.
        if (this.compiledPatterns && patternsSignature(this.settings) !== this.compiledSignature) {
            this.compiledPatterns = undefined;
        }
        // B-254: never overwrite the Text Snippets file while its backup is
        // missing: retry the backup first; a failure refuses the save.
        if (this.unsavedOriginal !== null) {
            try {
                await backupOriginalData(this.app.vault.adapter, this.pluginDir(), this.unsavedOriginal);
            } catch (err) {
                // Callers often drop a rejected save silently (toggles, delete):
                // say once per session why nothing sticks, then still refuse.
                if (!this.backupFailureShown) {
                    this.backupFailureShown = true;
                    const reason = sanitizeForNotice(err instanceof Error ? err.message : String(err));
                    new Notice(
                        `Changes are not being saved: the backup of your Text Snippets file failed (${reason}). Fix the problem and change a setting again.`,
                        15000,
                    );
                }
                throw err;
            }
            this.unsavedOriginal = null;
        }
        await this.saveData(this.settings);
    }
}
