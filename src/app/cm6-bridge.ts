// src/app/cm6-bridge.ts
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { MapMode, Transaction, type Extension, type Text } from "@codemirror/state";
import type { App } from "obsidian";
import { canExpandAtCursor, tryExpandAtSeparator, tryExpandInstant } from "../adapters/obsidian-editor";
import { expandTriggerAtCursor } from "./field-commands";
import { buildExpansionMarkExtension, markExpansion } from "./expansion-mark";
import { buildFieldSessionExtension, startFieldSession } from "../adapters/field-session";
import { readClipboardSafe } from "../adapters/clipboard";
import { clock } from "../adapters/clock";
import type { Dict } from "../engine/types";
import { NO_PATTERNS, type CompiledPatterns } from "../engine/patterns";
import { isCloserStepOver, isDeleteUserEvent, PairedCloserTracker, pairInsertCloser } from "./auto-pair";
import {
    isDeferredByComposition,
    isSingleCharTyping,
    isTypingUserEvent,
    listContinuationTail,
    shouldAttemptExpansion,
    type ChangeInfo,
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
    /** B-176: resolves the "Highlight expansions" setting at call time
     *  (default off: nothing extra happens on the hot path). */
    getHighlight: () => boolean = () => false,
    /** ADR-0008: the compiled pattern rules, resolved at call time. */
    getPatterns: () => CompiledPatterns = () => NO_PATTERNS,
    /** ADR-0008: the closer Obsidian's auto-pair inserted last in this view (per-view state owned by the caller).
     *  Without one nothing is tracked (a caret step over a closer is then never read as typing). */
    pairs?: PairedCloserTracker,
    /** B-255: "Expand while typing" setting, resolved at call time
     *  (default on). Off = typing never expands (Tab / command only). */
    getOnType: () => boolean = () => true,
): UpdateOutcome {
    // B-255: manual mode. Typing never expands, patterns included (the caret
    // step over a closer is typing too). Also keeps the composition retry
    // idle: it only arms itself from a "deferred" outcome.
    if (!getOnType()) {
        pairs?.clear();
        return "ignored";
    }
    // Cheap short-circuit: no point building the userEvent list (or
    // resolving the active editor) for selection-only updates —
    // typing always changes the document, so a no-op-for-the-doc
    // update can never be a typing event anyway. The one exception is the
    // caret stepping over an auto-inserted closer (typing `)` after `(c`).
    if (!update.docChanged) {
        return handleSelectionOnly(app, getSnippets, update, getPrefix, getHighlight, getPatterns, pairs);
    }

    // Obsidian can have multiple CM6 `EditorView` instances alive at
    // once (split panes, popout windows). `app.workspace.activeEditor`
    // tracks whichever one is actually focused — restrict to that so
    // an edit in a background pane never gets bridged to the wrong
    // (unrelated) `Editor` wrapper below (the `hasFocus` check further down).
    const userEvents = update.transactions.map((tr) =>
        tr.annotation(Transaction.userEvent),
    );
    // Tracked before the focus check: the closer moves with the text whichever pane it is typed in.
    const typing = followPairedCloser(update, userEvents, getPatterns, pairs);
    if (!update.view.hasFocus) return "ignored";
    const composing = update.view.composing;
    if (!shouldAttemptExpansion(userEvents, composing)) {
        // B-191: tell the caller when composition was the only thing
        // that stopped a typing update, so it can retry after
        // `compositionend`.
        return isDeferredByComposition(userEvents, composing)
            ? "deferred"
            : "ignored";
    }

    runExpansion(update.view, app, getSnippets, getPrefix, getHighlight, getPatterns, typing.instant, {
        pairCloser: typing.pairCloser,
        listContinuation: findListContinuation(update),
    });
    return "expanded";
}

/** A list marker the editor renumbered: `"2. "` becomes `"3. "`, with the same indentation, quote prefix and delimiter. */
const NUMBERED_MARKER = /^[ \t]*(?:>[ \t]*)*\d{1,9}[.)][ \t]+$/;

/** Whether an edit rewrote one numbered list marker into another of the same shape (only the number differs). */
function isRenumbering(replaced: string, inserted: string): boolean {
    return (
        NUMBERED_MARKER.test(replaced) &&
        NUMBERED_MARKER.test(inserted) &&
        replaced.replace(/\d+/, "") === inserted.replace(/\d+/, "")
    );
}

/**
 * B-246: the text Obsidian inserted when Enter in a list item or a quote continued it (`"\n- "`), when this update is
 * exactly that: one change ending at a single empty caret, plus only what the editor does around such an Enter, and
 * all of it after the caret (real Obsidian 1.14.5): the numbers of the items below shifted (`"2. "` becomes `"3. "`
 * in the same transaction), and the blanks that followed the caret dropped (Enter in the middle of `- sig tail`,
 * as a plain line drops the space it breaks at). Anything else is `undefined` and the update is read as before (a
 * plain Enter has the caret at column 0 of the new line).
 */
function findListContinuation(update: ViewUpdate): string | undefined {
    const { ranges, main } = update.state.selection;
    if (ranges.length !== 1 || !main.empty) return undefined;
    // Cheapest first, no walk of the changes on the typing hot path: an Enter always adds a line.
    if (!(update.state.doc.lines > update.startState.doc.lines)) return undefined;
    const changes: Array<{ fromA: number; toA: number; fromB: number; toB: number; text: Text }> = [];
    update.changes.iterChanges((fromA, toA, fromB, toB, text) => {
        changes.push({ fromA, toA, fromB, toB, text });
    }, true); // individually: the insertion and the blanks it makes the editor drop sit side by side
    // Cheap first: only a two-line insertion that ends at the caret can be a continuation.
    const caret = main.head;
    const at = changes.findIndex((c) => c.text.lines === 2 && c.toB === caret);
    const found = changes[at];
    if (found === undefined) return undefined;
    const startDoc = update.startState.doc;
    const tail = listContinuationTail(found.text.toString(), startDoc.sliceString(found.fromA, found.toA));
    if (tail === undefined) return undefined;
    const benign = changes.every(
        (c, i) =>
            i === at ||
            (c.fromB >= caret &&
                (isRenumbering(startDoc.sliceString(c.fromA, c.toA), c.text.toString()) ||
                    // the blanks right after the caret, dropped
                    (c.fromB === caret && c.text.length === 0 && /^[ \t]+$/.test(startDoc.sliceString(c.fromA, c.toA))))),
    );
    return benign ? tail : undefined;
}

/**
 * ADR-0008 + Obsidian "Auto pair brackets": a selection-only update that moves
 * the caret one character over a closer the editor inserted is the user typing
 * that closer. Instant pattern rules only: literal snippets and separator
 * rules keep their behaviour (a step-over never expanded them, and the closer
 * is not newly typed text). Anything else that moves the caret ends the tracking.
 */
function handleSelectionOnly(
    app: App,
    getSnippets: () => Dict,
    update: ViewUpdate,
    getPrefix: () => string | undefined,
    getHighlight: () => boolean,
    getPatterns: () => CompiledPatterns,
    pairs: PairedCloserTracker | undefined,
): UpdateOutcome {
    // Nothing is inspected unless a closer is being tracked (so an instant rule exists, and a pair was just typed).
    if (pairs === undefined || !pairs.tracked) return "ignored";
    const before = update.startState.selection;
    const after = update.state.selection;
    // A focus or geometry update that leaves the caret where it was says nothing.
    if (before.main.head === after.main.head) return "ignored";
    const stepOver = isCloserStepOver(
        {
            userEvents: update.transactions.map((tr) => tr.annotation(Transaction.userEvent)),
            before: { ranges: before.ranges.length, empty: before.main.empty, head: before.main.head },
            after: { ranges: after.ranges.length, empty: after.main.empty, head: after.main.head },
            passed:
                after.main.head === before.main.head + 1
                    ? update.state.doc.sliceString(before.main.head, after.main.head)
                    : "",
        },
        pairs,
    );
    pairs.clear(); // consumed, or the caret went somewhere else
    if (!stepOver || !getPatterns().hasInstant) return "ignored";
    if (!update.view.hasFocus || update.view.composing) return "ignored";
    runExpansion(update.view, app, getSnippets, getPrefix, getHighlight, getPatterns, true, { closerStepOver: true });
    return "expanded";
}

/**
 * Keeps the auto-inserted closer's position in step with a document change.
 * Typing and deleting carry it along (a typo fixed inside the pair keeps the
 * closer, and so the rule); it is dropped when the closer itself is deleted or
 * on any other write (undo, paste, a programmatic edit, Snipsy's own), and a
 * new auto-pair replaces it. Returns what the update means for instant rules.
 * Cheap first: with no instant rule, or no typing in the update, nothing is
 * inspected at all.
 */
function followPairedCloser(
    update: ViewUpdate,
    userEvents: ReadonlyArray<string | undefined>,
    getPatterns: () => CompiledPatterns,
    pairs: PairedCloserTracker | undefined,
): TypingShape {
    if (!getPatterns().hasInstant) {
        pairs?.clear();
        return NOT_INSTANT;
    }
    const followable = userEvents.length > 0 && userEvents.every((event) => isTypingUserEvent(event) || isDeleteUserEvent(event));
    if (followable) pairs?.map((pos) => update.changes.mapPos(pos, 1, MapMode.TrackAfter));
    else pairs?.clear();
    if (!userEvents.some(isTypingUserEvent)) return NOT_INSTANT;
    const shape = inspectTyping(update);
    if (!followable) return { instant: shape.instant, pairCloser: undefined };
    if (shape.pairCloser !== undefined) pairs?.track(update.state.selection.main.head, shape.pairCloser);
    return shape;
}

/** What one update means for instant rules. */
type TypingShape = {
    /** One typed character, or an auto-paired opener (two characters, caret between). */
    instant: boolean;
    /** The closer an auto-pair just inserted after the caret. */
    pairCloser: string | undefined;
};
const NOT_INSTANT: TypingShape = { instant: false, pairCloser: undefined };

/** Reads the change list and selection of an update (only called when an instant rule exists). */
function inspectTyping(update: ViewUpdate): TypingShape {
    const changes: ChangeInfo[] = [];
    update.changes.iterChanges((fromA, toA, _fromB, toB, text) => {
        // The inserted text is read only for the two-character shape (an auto-pair).
        changes.push({
            deleted: toA - fromA,
            inserted: text.length,
            lines: text.lines,
            end: toB,
            text: text.length === 2 ? text.toString() : undefined,
        });
    });
    const { ranges, main } = update.state.selection;
    const selection = { ranges: ranges.length, empty: main.empty, head: main.head };
    const pairCloser = pairInsertCloser(changes, selection);
    return { instant: pairCloser !== undefined || isSingleCharTyping(changes, selection), pairCloser };
}

/**
 * ADR-0008: whether instant pattern rules may run for this update. Cheap
 * first: nothing is inspected unless an instant rule exists.
 */
function isInstantCandidate(update: ViewUpdate, getPatterns: () => CompiledPatterns): boolean {
    return getPatterns().hasInstant && inspectTyping(update).instant;
}

/**
 * Resolves the active editor and runs the expansion. Shared by the
 * live-update path and the B-191 post-composition retry.
 */
function runExpansion(
    view: EditorView,
    app: App,
    getSnippets: () => Dict,
    getPrefix: () => string | undefined,
    getHighlight: () => boolean,
    getPatterns: () => CompiledPatterns,
    instant: boolean,
    opts: {
        /** The caret stepped over an auto-inserted closer: only instant rules, never literal snippets. */
        closerStepOver?: boolean;
        /** The update inserted an auto-pair: an instant rule that consumes its opener takes the closer too. */
        pairCloser?: string;
        /** B-246: Enter in a list item continued the list; the text it inserted (`"\n- "`). */
        listContinuation?: string;
    } = {},
): void {
    const fileInfo = app.workspace.activeEditor;
    const editor = fileInfo?.editor;
    if (!editor) return;
    const filename = fileInfo.file?.name;
    // B-204 / B-218: `{{title}}` and `{{notedate:FMT}}` read the name without its extension.
    const basename = fileInfo.file?.basename;

    // B-020: surface engine errors instead of silently swallowing
    // them. A broken snippet (e.g. an invalid `$date` format or a
    // regex-trigger that throws on compile) used to be a black hole —
    // no visible expansion AND no log to debug from. `tryExpandAtSeparator`
    // is async (it may await a clipboard read); errors are logged with
    // the active filename so the user / maintainer can correlate, and
    // never thrown back into CM6's update-listener callback — an
    // uncaught rejection there risks breaking other view plugins.
    const patterns = getPatterns();
    const { closerStepOver = false } = opts;
    // The closer is tied to the caret and line of THIS update (read now, before any await): a fallback attempt that
    // re-reads the live caret later must not take a `)` the user typed or clicked next to meanwhile.
    const caret = opts.pairCloser === undefined ? undefined : editor.getCursor();
    const pairCloser =
        opts.pairCloser === undefined || caret === undefined
            ? undefined
            : { closer: opts.pairCloser, caret, lineText: editor.getLine(caret.line) ?? "" };
    const deps = { filename, basename, now: clock.now(), readClipboard: readClipboardSafe, pairCloser };
    // Literal triggers first, then the pattern rules strictly top to bottom
    // whatever their mode (ADR-0008, one order): on a typed separator that is
    // all inside `tryExpandAtSeparator` (a separator rule reads the line before
    // the separator, an instant rule the line through it). Any other typed
    // character only has instant rules, tried by `tryExpandInstant`. One
    // keystroke expands at most once.
    // A closer step-over was never a typed separator for literal snippets or separator rules: an empty dictionary
    // and the instant rules alone keep it that way.
    const rules = closerStepOver ? patterns.rules.filter((rule) => rule.mode === "instant") : patterns.rules;
    const separator = tryExpandAtSeparator(editor, closerStepOver ? {} : getSnippets(), {
        ...deps,
        prefix: getPrefix(),
        patterns: rules.length > 0 ? rules : undefined,
        instant,
        listContinuation: opts.listContinuation,
    });
    const expanded = instant
        ? separator.then((first) => first ?? tryExpandInstant(editor, patterns.rules, deps))
        : separator;
    expanded.then((result) => {
        if (!result) return;
        // B-243: two or more fields open a session (the caret goes to the
        // first one); the highlight/undo mark would be cleared by that caret
        // move at once, so it is skipped.
        if (result.session && startFieldSession(view, result.session)) return;
        // B-176: mark the landed expansion (opt-in). The field validates
        // the range against the live document, so a stale result is dropped.
        if (getHighlight()) markExpansion(view, result);
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
    /** ADR-0008: the pending update was a single typed character. */
    private instant = false;
    private doc: Text | undefined;
    private head = -1;
    /** B-246: the pending update was an Enter that continued a list or a quote: what it inserted. */
    private listContinuation: string | undefined;
    /** Pending animation-frame handle and the window that owns it. */
    private frame: number | undefined;
    private frameWin: Window | undefined;
    private timer: number | undefined;
    /** ADR-0008: the closer the editor's auto-pair inserted last, in this view. */
    private readonly pairs = new PairedCloserTracker();

    constructor(
        private readonly view: EditorView,
        private readonly app: App,
        private readonly getSnippets: () => Dict,
        private readonly getPrefix: () => string | undefined,
        private readonly getHighlight: () => boolean = () => false,
        private readonly getPatterns: () => CompiledPatterns = () => NO_PATTERNS,
        private readonly getOnType: () => boolean = () => true,
    ) {}

    /** Fed from the update listener (not a plugin `update()`, which
     *  runs mid-update where dispatching is forbidden). */
    record(update: ViewUpdate): void {
        // Load-bearing: selection-only updates (common mid-composition)
        // must NOT clear `pending`; only a document change may. They still
        // reach `handleViewUpdate` for the auto-pair closer step-over, which
        // never touches `pending` (its expansion is a document change of its own).
        if (!update.docChanged) {
            handleViewUpdate(
                this.app,
                this.getSnippets,
                update,
                this.getPrefix,
                this.getHighlight,
                this.getPatterns,
                this.pairs,
                this.getOnType,
            );
            return;
        }
        const outcome = handleViewUpdate(
            this.app,
            this.getSnippets,
            update,
            this.getPrefix,
            this.getHighlight,
            this.getPatterns,
            this.pairs,
            this.getOnType,
        );
        this.pending = outcome === "deferred" && insertsText(update);
        if (this.pending) {
            this.instant = isInstantCandidate(update, this.getPatterns);
            this.doc = update.state.doc;
            this.head = update.state.selection.main.head;
            this.listContinuation = findListContinuation(update);
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
        runExpansion(
            this.view,
            this.app,
            this.getSnippets,
            this.getPrefix,
            this.getHighlight,
            this.getPatterns,
            this.instant,
            { listContinuation: this.listContinuation },
        );
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
    getHighlight: () => boolean = () => false,
    /** ADR-0008: the compiled pattern rules, resolved at call time. */
    getPatterns: () => CompiledPatterns = () => NO_PATTERNS,
    /** B-255: "Expand while typing" (default on). */
    getOnType: () => boolean = () => true,
    /** B-255: "Expand on Tab" (default off). */
    getOnTab: () => boolean = () => false,
): Extension {
    const retry = ViewPlugin.define(
        (view) => new CompositionRetry(view, app, getSnippets, getPrefix, getHighlight, getPatterns, getOnType),
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
            else handleViewUpdate(app, getSnippets, update, getPrefix, getHighlight, getPatterns, undefined, getOnType);
        }),
        buildExpansionMarkExtension(getHighlight),
        // B-255: the one Tab keymap lives in the field-session extension
        // (a session keeps Tab first); this is its "no session" fallback.
        buildFieldSessionExtension((view) => handleTab(view, app, getSnippets, getPrefix, getOnTab, getHighlight, getPatterns)),
    ];
}

/**
 * B-255: Tab with no field session open. Takes the key only when "Expand on
 * Tab" is on and there is a trigger to expand (before the caret, the word
 * around it, or the selection: the original plugin's rules, with the guards of
 * the "Expand trigger at cursor" command, decided synchronously); otherwise
 * returns `false` so Tab indents or does whatever it did before.
 */
export function handleTab(
    view: EditorView,
    app: App,
    getSnippets: () => Dict,
    getPrefix: () => string | undefined,
    getOnTab: () => boolean,
    getHighlight: () => boolean = () => false,
    /** ADR-0008: pattern rules count like a literal trigger; Tab never takes an auto-pair closer. */
    getPatterns: () => CompiledPatterns = () => NO_PATTERNS,
): boolean {
    if (!getOnTab() || view.composing || view.state.readOnly) return false;
    const editor = app.workspace.activeEditor?.editor;
    // Only the focused editor's own view: never act on another pane's caret.
    if (!editor || editor.cm !== view) return false;
    const dict = getSnippets();
    const patterns = getPatterns();
    const found = canExpandAtCursor(editor, dict, getPrefix(), patterns.rules);
    if (!found) return false;
    // The check's hit goes on to the expansion: the rules run once per Tab, and a rule the first run switched off
    // or cut by the time budget cannot make the second one find nothing (Tab taken, nothing done).
    expandTriggerAtCursor(app, editor, () => dict, getPrefix, () => patterns, { manual: true, prepared: found })
        .then((result) => {
            // Same as typing (B-176): a field session clears the mark at once,
            // so only a plain expansion is marked (highlight / Backspace undo).
            if (result && !result.session && getHighlight()) markExpansion(view, result);
        })
        .catch((err: unknown) => {
            console.error("[snipsy] Tab expansion error", err);
        });
    return true;
}
