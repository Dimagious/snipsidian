import { Plugin } from "obsidian";
import { registerEditorChange } from "./cm6-bridge";
import { SnipSidianSettingTab } from "../ui/settings";
import { DEFAULT_SNIPPETS } from "../presets";
import type { SnipSidianSettings } from "../types";
import { getDict, getAllSnippetsFlat } from "../store/snippets";
import { SnippetPickerService } from "../core/snippet-picker";
import { openSnippetPickerModal } from "../ui/components/SnippetPickerModal";

export default class HotstringsPlugin extends Plugin {
    settings!: SnipSidianSettings;
    private off?: () => void;

    async onload() {
        await this.loadSettings();

        // Editor hook (equivalent to current 'editor-change')
        this.off = registerEditorChange(this.app, () => getDict(this.settings));

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

    onunload() {
        try { 
            this.off?.(); 
        } catch {
            // Ignore errors during cleanup
        }
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
            // later delete/rename of a default snippet sticks.
            this.settings = { ...saved, snippets: { ...DEFAULT_SNIPPETS } };
            await this.saveSettings();
        }
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}
