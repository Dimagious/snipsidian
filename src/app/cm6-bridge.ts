// src/app/cm6-bridge.ts
import { EditorView, type ViewUpdate } from "@codemirror/view";
import { Transaction, type Extension } from "@codemirror/state";
import type { App } from "obsidian";
import { tryExpandAtSeparator } from "../adapters/obsidian-editor";
import { readClipboardSafe } from "../adapters/clipboard";
import { clock } from "../adapters/clock";
import type { Dict } from "../engine/types";
import { shouldAttemptExpansion } from "./change-source-gate";

/**
 * B-149: replaces the old bare `workspace.on("editor-change", ...)`
 * hook, which reacted to ANY document change — undo, redo, paste,
 * drag-drop, another plugin's programmatic edit, all looked
 * identical to "the user just typed a separator" from that handler's
 * point of view. Registering a CM6 `EditorView.updateListener`
 * extension instead gives access to each change's `Transaction`,
 * whose `userEvent` annotation says WHERE the change came from — the
 * `shouldAttemptExpansion` gate (`change-source-gate.ts`) decides
 * from that whether this is genuine typing.
 *
 * This function handles one `ViewUpdate` and is exported separately
 * from `buildExpansionExtension` below so tests can drive it with a
 * hand-built fake update — no real CM6 `EditorView` required.
 *
 * The gate gets ONE thing to decide: attempt expansion or not. The
 * actual expansion logic is unchanged — it still goes through
 * `tryExpandAtSeparator`, the same adapter the old bare
 * `editor-change` hook called. `src/engine/**` is untouched by this
 * change.
 */
export function handleViewUpdate(
    app: App,
    getSnippets: () => Dict,
    update: ViewUpdate,
    /** B-137: resolves the effective prefix char at call time
     *  (`undefined` when the mode is off). Optional so existing
     *  callers/tests that don't care about prefix mode don't need to
     *  pass one — defaults to "off". */
    getPrefix: () => string | undefined = () => undefined,
): void {
    // Cheap short-circuit: no point building the userEvent list (or
    // resolving the active editor) for selection-only updates —
    // typing always changes the document, so a no-op-for-the-doc
    // update can never be a typing event anyway.
    if (!update.docChanged) return;

    // Obsidian can have multiple CM6 `EditorView` instances alive at
    // once (split panes, popout windows). `app.workspace.activeEditor`
    // tracks whichever one is actually focused — restrict to that so
    // an edit in a background pane never gets bridged to the wrong
    // (unrelated) `Editor` wrapper below.
    if (!update.view.hasFocus) return;

    const userEvents = update.transactions.map((tr) =>
        tr.annotation(Transaction.userEvent),
    );
    if (!shouldAttemptExpansion(userEvents, update.view.composing)) return;

    const fileInfo = app.workspace.activeEditor;
    const editor = fileInfo?.editor;
    if (!editor) return;
    const filename = fileInfo.file?.name;

    // B-020: surface engine errors instead of silently swallowing
    // them. A broken snippet (e.g. an invalid `$date` format or a
    // regex-trigger that throws on compile) used to be a black hole —
    // no visible expansion AND no log to debug from. `tryExpandAtSeparator`
    // is async (it may await a clipboard read); errors are logged with
    // the active filename so the user / maintainer can correlate, and
    // never thrown back into CM6's update-listener callback — an
    // uncaught rejection there risks breaking other view plugins.
    tryExpandAtSeparator(editor, getSnippets(), {
        filename,
        now: clock.now(),
        readClipboard: readClipboardSafe,
        prefix: getPrefix(),
    }).catch((err) => {
        console.error(
            "[snipsy] expansion error",
            { filename, error: err instanceof Error ? err.message : String(err) },
            err,
        );
    });
}

/**
 * Builds the CM6 extension. Registered via `plugin.registerEditorExtension`
 * in `src/app/plugin.ts` — `cm6-bridge.ts` only had access to `app`
 * before B-149, but `registerEditorExtension` lives on `Plugin`, not
 * `App`, so registration now happens in `plugin.ts` and this module
 * just builds the `Extension` value.
 */
export function buildExpansionExtension(
    app: App,
    getSnippets: () => Dict,
    getPrefix: () => string | undefined = () => undefined,
): Extension {
    return EditorView.updateListener.of((update) =>
        handleViewUpdate(app, getSnippets, update, getPrefix),
    );
}
