import { Plugin } from "obsidian";
import { registerEditorChange } from "./cm6-bridge";
import { SnipSidianSettingTab } from "../ui/settings";
import { DEFAULT_SNIPPETS } from "../presets";
import type { SnipSidianSettings } from "../types";
import { getDict } from "../store/snippets";

const DEFAULT_SETTINGS: SnipSidianSettings = { snippets: DEFAULT_SNIPPETS };

export default class HotstringsPlugin extends Plugin {
    settings!: SnipSidianSettings;
    private off?: () => void;

    async onload() {
        await this.loadSettings();

        // Editor hook (equivalent to current 'editor-change')
        this.off = registerEditorChange(this.app, () => getDict(this.settings));

        // Demo command (keeping compatibility)
        this.addCommand({
            id: "insert-hello-world",
            name: "Insert Hello World",
            editorCallback: (editor) => editor.replaceSelection("Hello World")
        });

        this.addSettingTab(new SnipSidianSettingTab(this.app, this));
        console.log("Snipsy modular plugin loaded");
    }

    onunload() {
        try { this.off?.(); } catch { }
        console.log("Snipsy modular plugin unloaded");
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
