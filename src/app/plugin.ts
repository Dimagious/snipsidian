import { Plugin } from "obsidian";
import { buildExpansionExtension } from "./cm6-bridge";
import { SnipSidianSettingTab } from "../ui/settings";
import { defaultSnippetsAsGroup } from "../store/presets";
import type { SnipSidianSettings } from "../types";
import { getDict, getAllSnippetsFlat } from "../store/snippets";
import { SnippetPickerService } from "../core/snippet-picker";
import { openSnippetPickerModal } from "../ui/components/SnippetPickerModal";

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
        this.registerEditorExtension(
            buildExpansionExtension(
                this.app,
                () => getDict(this.settings),
                () => {
                    if (!this.settings.expansion?.requirePrefix) return undefined;
                    const char = this.settings.expansion.prefixChar;
                    // Hardening: clamp to the supported set — corrupt or
                    // foreign saved data (anything other than ":" or ";")
                    // must not silently kill all expansion in prefix mode.
                    return char === ":" || char === ";" ? char : ":";
                },
            ),
        );

        // Snippet Picker command
        this.addCommand({
            id: "insert-snippet",
            name: "Insert snippet…",
            callback: () => {
                const snippets = getAllSnippetsFlat(this.settings);
                const api = new SnippetPickerService(snippets);
                openSnippetPickerModal(this.app, api);
            }
        });

        // Open Settings command
        this.addCommand({
            id: "open-settings",
            name: "Open settings",
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
