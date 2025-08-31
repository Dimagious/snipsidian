import { Plugin } from "obsidian";

export default class SnipSidianPlugin extends Plugin {
    async onload() {
        console.log("SnipSidian plugin loaded!");

        this.addCommand({
            id: "insert-hello-world",
            name: "Insert Hello World",
            editorCallback: (editor) => {
                editor.replaceSelection("Hello World");
            },
        });
    }

    onunload() {
        console.log("SnipSidian plugin unloaded!");
    }
}
