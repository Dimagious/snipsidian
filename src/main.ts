import { Plugin } from "obsidian";
import { SnipSidianSettingTab } from "./ui/settings";
import { DEFAULT_SNIPPETS } from "./presets";
import type { SnipSidianSettings } from "./types";
import { expandIfTriggered } from "./core/expander";

const DEFAULT_SETTINGS: SnipSidianSettings = { snippets: DEFAULT_SNIPPETS };

export default class SnipSidianPlugin extends Plugin {
    settings: SnipSidianSettings;

    async onload() {
        console.log("SnipSidian plugin loaded!");
        await this.loadSettings();

        this.addCommand({
            id: "insert-hello-world",
            name: "Insert Hello World",
            editorCallback: (editor) => editor.replaceSelection("Hello World"),
        });

        this.registerEvent(
            this.app.workspace.on("editor-change", (editor) => {
                if (!editor) return;
                expandIfTriggered(editor, this.settings.snippets);
            })
        );

        this.addSettingTab(new SnipSidianSettingTab(this.app, this));
    }

    onunload() {
        console.log("SnipSidian plugin unloaded!");
    }

    async loadSettings() {
        const saved = await this.loadData();
        const savedSnippets = (saved?.snippets ?? {}) as Record<string, string>;
        this.settings = {
            snippets: {
                ...DEFAULT_SNIPPETS,   // keep new defaults
                ...savedSnippets,      // user overrides
            },
        };
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}
