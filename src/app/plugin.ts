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
            name: "Open Snipsy settings",
            callback: () => {
                // @ts-ignore Obsidian internal API - setting.open() and openTabById() exist at runtime but are not in type definitions
                this.app.setting.open();
                // @ts-ignore Obsidian internal API - setting.open() and openTabById() exist at runtime but are not in type definitions
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
        const saved = await this.loadData();
        const savedSnippets = (saved?.snippets ?? {}) as Record<string, string>;
        this.settings = {
            snippets: {
                ...DEFAULT_SNIPPETS,
                ...savedSnippets
            }
        };
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}
