// src/app/cm6-bridge.ts
import type { App, WorkspaceLeaf } from "obsidian";
import { tryExpandAtSeparator } from "../adapters/obsidian-editor";
import { readClipboardSafe } from "../adapters/clipboard";
import { clock } from "../adapters/clock";
import type { Dict } from "../engine/types";

export function registerEditorChange(
    app: App,
    getSnippets: () => Dict
) {
    const off = app.workspace.on("editor-change", async (editor) => {
        if (!editor) return;
        const file = app.workspace.getActiveFile();
        const filename = file?.name;
        await tryExpandAtSeparator(editor, getSnippets(), {
            filename,
            now: clock.now(),
            readClipboard: readClipboardSafe
        });
    });
    return () => app.workspace.offref(off as unknown as WorkspaceLeaf);
}
