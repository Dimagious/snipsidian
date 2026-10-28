// src/app/cm6-bridge.ts
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { Transaction, type Extension, type Text } from "@codemirror/state";
import type { App } from "obsidian";
import { tryExpandAtSeparator } from "../adapters/obsidian-editor";
import { readClipboardSafe } from "../adapters/clipboard";
import { clock } from "../adapters/clock";
import type { Dict } from "../engine/types";
import {
    isDeferredByComposition,
    shouldAttemptExpansion,
    shouldRunDeferredExpansion,
} from "./change-source-gate";

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
export type UpdateOutcome = "expanded" | "deferred" | "ignored";

export function handleViewUpdate(
    app: App,
    getSnippets: () => Dict,
    update: ViewUpdate,
    /** B-137: resolves the effective prefix char at call time
     *  (`undefined` when the mode is off). Optional so existing
     *  callers/tests that don't care about prefix mode don't need to
     *  pass one — defaults to "off". */
    getPrefix: () => string | undefined = () => undefined,
): UpdateOutcome {
    // Cheap short-circuit: no point building the userEvent list (or
    // resolving the active editor) for selection-only updates —
    // typing always changes the document, so a no-op-for-the-doc
    // update can never be a typing event anyway.
    if (!update.docChanged) return "ignored";

    // Obsidian can have multiple CM6 `EditorView` instances alive at
    // once (split panes, popout windows). `app.workspace.activeEditor`
    // tracks whichever one is actually focused — restrict to that so
    // an edit in a background pane never gets bridged to the wrong
    // (unrelated) `Editor` wrapper below.
    if (!update.view.hasFocus) return "ignored";

    const userEvents = update.transactions.map((tr) =>
        tr.annotation(Transaction.userEvent),
    );
    const composing = update.view.composing;
    if (!shouldAttemptExpansion(userEvents, composing)) {
        // B-191: tell the caller when composition was the only thing
        // that stopped a typing update, so it can retry after
        // `compositionend`.
        return isDeferredByComposition(userEvents, composing)
            ? "deferred"
            : "ignored";
    }

    runExpansion(app, getSnippets, getPrefix);
    return "expanded";
}

/**
 * Resolves the active editor and runs the expansion. Shared by the
 * live-update path and the B-191 post-composition retry.
 */
function runExpansion(
    app: App,
    getSnippets: () => Dict,
    getPrefix: () => string | undefined,
): void {
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

/** True when any change in the update inserts text (a pure deletion,
 *  e.g. a cancelled preedit, must not be retried: B-132). */
function insertsText(update: ViewUpdate): boolean {
    let inserted = false;
    update.changes.iterChanges((_fromA, _toA, _fromB, _toB, text) => {
        if (text.length > 0) inserted = true;
    });
    return inserted;
}

/**
 * B-191: per-view state for the post-composition retry. `pending` is
 * true while the most recent document change was a typing update that
 * inserted text but was skipped only because the view was composing.
 * Any later document change overwrites it, so an expansion that
 * already happened (or a non-typing change) can never be repeated.
 * The retry also requires the document and cursor to be exactly as
 * they were when the update was recorded. O(1) per update.
 */
export class CompositionRetry {
    pending = false;
    private doc: Text | undefined;
    private head = -1;
    /** Pending animation-frame handle and the window that owns it. */
    private frame: number | undefined;
    private frameWin: Window | undefined;
    private timer: number | undefined;

    constructor(
        private readonly view: EditorView,
        private readonly app: App,
        private readonly getSnippets: () => Dict,
        private readonly getPrefix: () => string | undefined,
    ) {}

    /** Fed from the update listener (not a plugin `update()`, which
     *  runs mid-update where dispatching is forbidden). */
    record(update: ViewUpdate): void {
        // Load-bearing: selection-only updates (common mid-composition)
        // must NOT clear `pending`; only a document change may.
        if (!update.docChanged) return;
        const outcome = handleViewUpdate(
            this.app,
            this.getSnippets,
            update,
            this.getPrefix,
        );
        this.pending = outcome === "deferred" && insertsText(update);
        if (this.pending) {
            this.doc = update.state.doc;
            this.head = update.state.selection.main.head;
        }
    }

    /**
     * Called from the `compositionend` DOM handler. CM6 may still
     * report `composing` while that handler runs, and on Android
     * Chrome its own compositionend observer flushes DOM changes in
     * an animation frame (`observer.flushSoon`); dispatching
     * before that frame would drop the queued records. Whichever of
     * the two frame callbacks is registered first, the macrotask
     * queued from ours runs after both, so we wait one frame and then
     * a macrotask, and re-check before dispatch.
     */
    onCompositionEnd(): void {
        if (!this.pending) return;
        this.cancel();
        // The view's own window: in a popout the main window's frames
        // can be paused (hidden/minimized) while the editor is live.
        const win = this.view.dom.ownerDocument.defaultView ?? window;
        this.frameWin = win;
        this.frame = win.requestAnimationFrame(() => {
            this.frame = undefined;
            this.timer = window.setTimeout(() => {
                this.timer = undefined;
                this.runPending();
            }, 0);
        });
    }

    runPending(): void {
        if (!this.pending) return;
        if (this.view.composing) return; // keep pending: B-141
        if (
            !shouldRunDeferredExpansion(
                this.pending,
                this.view.composing,
                this.view.hasFocus,
            )
        ) {
            this.pending = false; // lost focus: stale
            return;
        }
        const { state } = this.view;
        const unchanged =
            state.doc === this.doc && state.selection.main.head === this.head;
        this.pending = false;
        if (!unchanged) return;
        runExpansion(this.app, this.getSnippets, this.getPrefix);
    }

    private cancel(): void {
        if (this.frame !== undefined) this.frameWin?.cancelAnimationFrame(this.frame);
        this.frame = undefined;
        if (this.timer !== undefined) window.clearTimeout(this.timer);
        this.timer = undefined;
    }

    destroy(): void {
        this.cancel();
        this.pending = false;
    }
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
    const retry = ViewPlugin.define(
        (view) => new CompositionRetry(view, app, getSnippets, getPrefix),
        {
            eventHandlers: {
                compositionend(this: CompositionRetry) {
                    this.onCompositionEnd();
                },
            },
        },
    );
    return [
        retry,
        EditorView.updateListener.of((update) => {
            const state = update.view.plugin(retry);
            if (state) state.record(update);
            else handleViewUpdate(app, getSnippets, update, getPrefix);
        }),
    ];
}
