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
        // B-020: surface engine errors instead of silently swallowing
        // them. A broken snippet (e.g. an invalid `$date` format or
        // a regex-trigger that throws on compile) used to be a black
        // hole — no visible expansion AND no log to debug from. Now
        // the editor-change handler logs the thrown error with the
        // active filename so the user / maintainer can correlate.
        // Re-thrown errors here would propagate into Obsidian's
        // event loop and risk killing other plugins' handlers — log
        // and swallow at the boundary, fail-open on individual
        // expansions.
        try {
            await tryExpandAtSeparator(editor, getSnippets(), {
                filename,
                now: clock.now(),
                readClipboard: readClipboardSafe
            });
        } catch (err) {
            console.error(
                "[snipsy] expansion error",
                { filename, error: err instanceof Error ? err.message : String(err) },
                err,
            );
        }
    });
    return () => app.workspace.offref(off as unknown as WorkspaceLeaf);
}
