import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import type { App } from "obsidian";
import { nth } from "../test/helpers";

// mock the engine adapter call
vi.mock("../adapters/obsidian-editor", () => ({
    tryExpandAtSeparator: vi.fn().mockResolvedValue(undefined),
    tryExpandInstant: vi.fn().mockResolvedValue(undefined),
    canExpandAtCursor: vi.fn().mockReturnValue(false),
}));
vi.mock("./field-commands", () => ({
    expandTriggerAtCursor: vi.fn().mockResolvedValue(undefined),
}));
import { canExpandAtCursor, tryExpandAtSeparator, tryExpandInstant } from "../adapters/obsidian-editor";
import { expandTriggerAtCursor } from "./field-commands";
import { compilePatternRules, NO_PATTERNS, type CompiledPatterns } from "../engine/patterns";
import { handleViewUpdate, handleTab, CompositionRetry, buildExpansionExtension } from "./cm6-bridge";
import { PairedCloserTracker } from "./auto-pair";
import { buildFieldSessionExtension, fieldSessionField, startFieldSessionEffect } from "../adapters/field-session";

/**
 * B-149: `handleViewUpdate` is exported separately from the
 * `EditorView.updateListener.of(...)` extension builder so tests can
 * drive it with a hand-built fake `ViewUpdate` — no real CM6
 * `EditorView` required. The fakes below are plain objects; `asView`,
 * `asUpdate` and `asApp` are the places where they are presented as the
 * CM6/Obsidian types.
 */

type FakeTx = { userEvent?: string };
type FakeState = { doc: object; selection: { main: { head: number } } };
/** The part of an `EditorView` the bridge reads or writes. */
interface FakeView {
    hasFocus: boolean;
    composing: boolean;
    state?: FakeState;
    dom?: unknown;
    dispatch?: unknown;
}
const DOC = {};

function asView(view: FakeView): EditorView {
    return view as unknown as EditorView;
}

function makeUpdate(opts: {
    docChanged?: boolean;
    hasFocus?: boolean;
    composing?: boolean;
    transactions?: FakeTx[];
    /** Whether the update inserts text (false = pure deletion). */
    inserts?: boolean;
    doc?: object;
    head?: number;
    /** Replaces the default view, e.g. one a `CompositionRetry` also holds. */
    view?: FakeView;
    dispatch?: unknown;
    /** What the update inserts (default: one character, no line break). */
    inserted?: { length: number; lines: number; deleted?: number; text?: string; end?: number };
    /** The selection after the update. */
    selection?: { ranges: number; empty: boolean; head: number };
}): ViewUpdate {
    const transactions = (opts.transactions ?? [{ userEvent: "input.type" }]).map((tx) => ({
        annotation: (_type: unknown) => tx.userEvent,
    }));
    return {
        docChanged: opts.docChanged ?? true,
        view: opts.view ?? {
            hasFocus: opts.hasFocus ?? true,
            composing: opts.composing ?? false,
            ...(opts.dispatch ? { dispatch: opts.dispatch } : {}),
        },
        transactions,
        changes: {
            mapPos: (pos: number) => pos,
            iterChanges: (
                f: (a: number, b: number, c: number, d: number, t: { length: number; lines: number; toString(): string }) => void,
            ) => {
                const ins = opts.inserted ?? { length: opts.inserts === false ? 0 : 1, lines: 1 };
                const head = opts.selection?.head ?? opts.head ?? 3;
                f(head - ins.length, head - ins.length + (ins.deleted ?? 0), head - ins.length, ins.end ?? head, {
                    length: ins.length,
                    lines: ins.lines,
                    toString: () => ins.text ?? "",
                });
            },
        },
        state: {
            doc: opts.doc ?? DOC,
            selection: {
                ranges: new Array<unknown>(opts.selection?.ranges ?? 1).fill({}),
                main: { head: opts.selection?.head ?? opts.head ?? 3, empty: opts.selection?.empty ?? true },
            },
        },
    } as unknown as ViewUpdate;
}

function makeApp(opts: { editor?: unknown; filename?: string } = {}): App {
    const editor = opts.editor === undefined ? { mock: "editor" } : opts.editor;
    return {
        workspace: {
            activeEditor: editor
                ? { editor, file: opts.filename ? { name: opts.filename } : null }
                : null,
        },
    } as unknown as App;
}

describe("cm6-bridge/handleViewUpdate", () => {
    beforeEach(() => {
        // `tryExpandAtSeparator`'s default `mockResolvedValue` survives
        // `clearAllMocks` (it only resets calls/instances/results, not
        // implementations) — each test starts with a clean call count.
        vi.clearAllMocks();
    });

    it("attempts expansion on a genuine typing update", async () => {
        const app = makeApp({ filename: "note.md" });
        const getSnippets = () => ({ fn: "function $|() {}" });

        handleViewUpdate(app, getSnippets, makeUpdate({}));
        // tryExpandAtSeparator is invoked synchronously (fire-and-forget
        // .catch chain) — flush the microtask so any error handling runs.
        await Promise.resolve();

        expect(tryExpandAtSeparator).toHaveBeenCalledTimes(1);
        expect(tryExpandAtSeparator).toHaveBeenCalledWith(
            { mock: "editor" },
            { fn: "function $|() {}" },
            expect.objectContaining({ filename: "note.md" }),
        );
    });

    it("does nothing when the document didn't change (selection-only update)", () => {
        const app = makeApp();
        handleViewUpdate(app, () => ({}), makeUpdate({ docChanged: false }));
        expect(tryExpandAtSeparator).not.toHaveBeenCalled();
    });

    it("does nothing when the view isn't focused (background split/popout)", () => {
        const app = makeApp();
        handleViewUpdate(app, () => ({}), makeUpdate({ hasFocus: false }));
        expect(tryExpandAtSeparator).not.toHaveBeenCalled();
    });

    it("[B-149] does not attempt expansion on undo", () => {
        const app = makeApp();
        handleViewUpdate(
            app,
            () => ({}),
            makeUpdate({ transactions: [{ userEvent: "undo" }] }),
        );
        expect(tryExpandAtSeparator).not.toHaveBeenCalled();
    });

    it("[B-149] does not attempt expansion on redo", () => {
        const app = makeApp();
        handleViewUpdate(
            app,
            () => ({}),
            makeUpdate({ transactions: [{ userEvent: "redo" }] }),
        );
        expect(tryExpandAtSeparator).not.toHaveBeenCalled();
    });

    it("[B-149] does not attempt expansion on paste", () => {
        const app = makeApp();
        handleViewUpdate(
            app,
            () => ({}),
            makeUpdate({ transactions: [{ userEvent: "input.paste" }] }),
        );
        expect(tryExpandAtSeparator).not.toHaveBeenCalled();
    });

    it("[B-149] does not attempt expansion on drop", () => {
        const app = makeApp();
        handleViewUpdate(
            app,
            () => ({}),
            makeUpdate({ transactions: [{ userEvent: "input.drop" }] }),
        );
        expect(tryExpandAtSeparator).not.toHaveBeenCalled();
    });

    it("[B-149] does not attempt expansion on an untagged programmatic edit", () => {
        const app = makeApp();
        handleViewUpdate(
            app,
            () => ({}),
            makeUpdate({ transactions: [{ userEvent: undefined }] }),
        );
        expect(tryExpandAtSeparator).not.toHaveBeenCalled();
    });

    it("[B-149] attempts expansion for Enter/newline insertion (bare \"input\" userEvent)", async () => {
        const app = makeApp({ filename: "note.md" });
        handleViewUpdate(
            app,
            () => ({ brb: "be right back" }),
            makeUpdate({ transactions: [{ userEvent: "input" }] }),
        );
        await Promise.resolve();
        expect(tryExpandAtSeparator).toHaveBeenCalledTimes(1);
    });

    it("[B-141] does not attempt expansion while the view is composing (IME)", () => {
        const app = makeApp();
        handleViewUpdate(
            app,
            () => ({}),
            makeUpdate({ composing: true, transactions: [{ userEvent: "input.type" }] }),
        );
        expect(tryExpandAtSeparator).not.toHaveBeenCalled();
    });

    it("does nothing when there is no active editor to bridge to", () => {
        const app = makeApp({ editor: null });
        handleViewUpdate(app, () => ({}), makeUpdate({}));
        expect(tryExpandAtSeparator).not.toHaveBeenCalled();
    });

    it("[B-020] logs engine errors instead of letting them propagate", async () => {
        const boom = new Error("expansion failed");
        vi.mocked(tryExpandAtSeparator).mockRejectedValueOnce(boom);
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        const app = makeApp({ filename: "note.md" });
        handleViewUpdate(app, () => ({}), makeUpdate({}));
        // Let the rejected promise's .catch handler run.
        await Promise.resolve();
        await Promise.resolve();

        expect(errorSpy).toHaveBeenCalledWith(
            "[snipsy] expansion error",
            expect.objectContaining({ filename: "note.md", error: "expansion failed" }),
            boom,
        );

        errorSpy.mockRestore();
    });
});

describe("cm6-bridge/CompositionRetry [B-191]", () => {
    // `buildExpansionExtension` (the CM6 wiring: ViewPlugin +
    // compositionend handler) needs a real EditorView and is covered by
    // e2e/ime.spec.ts only.
    let frames: Array<() => void> = [];
    let timers: Array<() => void> = [];
    let cancelledFrames: number[] = [];
    let viewWin: unknown;

    beforeEach(() => {
        vi.clearAllMocks();
        frames = [];
        timers = [];
        cancelledFrames = [];
        const win = {
            requestAnimationFrame: (fn: () => void) => frames.push(fn),
            cancelAnimationFrame: (id: number) => {
                cancelledFrames.push(id);
                frames[id - 1] = () => {};
            },
            setTimeout: (fn: () => void) => timers.push(fn),
            clearTimeout: (id: number) => {
                timers[id - 1] = () => {};
            },
        };
        vi.stubGlobal("window", win);
        viewWin = win;
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    function make(
        init: { composing: boolean; hasFocus: boolean } = {
            composing: false,
            hasFocus: true,
        },
    ): { retry: CompositionRetry; view: FakeView & { state: FakeState } } {
        const view: FakeView & { state: FakeState } = {
            ...init,
            state: { doc: DOC, selection: { main: { head: 3 } } },
            dom: { ownerDocument: { defaultView: viewWin } },
        };
        const retry = new CompositionRetry(asView(view), makeApp(), () => ({}), () => undefined);
        return { retry, view };
    }

    /** One animation frame, then the macrotask queued by it. */
    function flushTimers() {
        frames.splice(0).forEach((f) => f());
        timers.splice(0).forEach((f) => f());
    }

    it("handleViewUpdate reports a typing update blocked only by composition", () => {
        expect(
            handleViewUpdate(makeApp(), () => ({}), makeUpdate({ composing: true })),
        ).toBe("deferred");
        expect(tryExpandAtSeparator).not.toHaveBeenCalled();
    });

    it("handleViewUpdate does not report paste/undo while composing", () => {
        for (const userEvent of ["input.paste", "undo", "input.drop"]) {
            expect(
                handleViewUpdate(
                    makeApp(),
                    () => ({}),
                    makeUpdate({ composing: true, transactions: [{ userEvent }] }),
                ),
            ).toBe("ignored");
        }
    });

    it("runs the deferred expansion once after compositionend", () => {
        const { retry, view } = make({ composing: true, hasFocus: true });
        retry.record(makeUpdate({ composing: true }));
        expect(retry.pending).toBe(true);
        expect(tryExpandAtSeparator).not.toHaveBeenCalled();

        retry.onCompositionEnd();
        view.composing = false;
        flushTimers();
        expect(tryExpandAtSeparator).toHaveBeenCalledTimes(1);
        expect(retry.pending).toBe(false);

        // a second compositionend does nothing
        retry.onCompositionEnd();
        flushTimers();
        expect(tryExpandAtSeparator).toHaveBeenCalledTimes(1);
    });

    it("a later non-composing doc change clears pending (no double expansion)", async () => {
        const { retry } = make({ composing: true, hasFocus: true });
        retry.record(makeUpdate({ composing: true }));
        retry.record(makeUpdate({ composing: false })); // expands normally
        await Promise.resolve();
        expect(tryExpandAtSeparator).toHaveBeenCalledTimes(1);
        expect(retry.pending).toBe(false);

        retry.onCompositionEnd();
        flushTimers();
        expect(tryExpandAtSeparator).toHaveBeenCalledTimes(1);
    });

    it("a later non-typing doc change clears pending", () => {
        const { retry } = make();
        retry.record(makeUpdate({ composing: true }));
        retry.record(makeUpdate({ transactions: [{ userEvent: "undo" }] }));
        expect(retry.pending).toBe(false);
    });

    it("selection-only updates leave pending untouched", () => {
        const { retry } = make();
        retry.record(makeUpdate({ composing: true }));
        retry.record(makeUpdate({ docChanged: false }));
        expect(retry.pending).toBe(true);
    });

    it("paste/undo while composing never becomes pending", () => {
        const { retry } = make();
        retry.record(
            makeUpdate({ composing: true, transactions: [{ userEvent: "input.paste" }] }),
        );
        expect(retry.pending).toBe(false);
        retry.onCompositionEnd();
        flushTimers();
        expect(tryExpandAtSeparator).not.toHaveBeenCalled();
    });

    it("skips the deferred attempt while the view still reports composing", () => {
        const { retry } = make({ composing: true, hasFocus: true });
        retry.record(makeUpdate({ composing: true }));
        retry.onCompositionEnd();
        flushTimers();
        expect(tryExpandAtSeparator).not.toHaveBeenCalled();
        expect(retry.pending).toBe(true);
    });

    it("skips the deferred attempt when the view lost focus", () => {
        const { retry, view } = make({ composing: true, hasFocus: true });
        retry.record(makeUpdate({ composing: true }));
        view.composing = false;
        view.hasFocus = false;
        retry.onCompositionEnd();
        flushTimers();
        expect(tryExpandAtSeparator).not.toHaveBeenCalled();
    });

    it("destroy drops pending state", () => {
        const { retry, view } = make({ composing: true, hasFocus: true });
        retry.record(makeUpdate({ composing: true }));
        retry.destroy();
        view.composing = false;
        retry.onCompositionEnd();
        flushTimers();
        expect(tryExpandAtSeparator).not.toHaveBeenCalled();
    });

    it("does not run before the animation frame (CM6 Android flush)", () => {
        const { retry } = make();
        retry.record(makeUpdate({ composing: true }));
        retry.onCompositionEnd();
        expect(tryExpandAtSeparator).not.toHaveBeenCalled();
        expect(timers).toHaveLength(0);
        frames.splice(0).forEach((f) => f());
        // frame ran, macrotask still pending
        expect(tryExpandAtSeparator).not.toHaveBeenCalled();
        timers.splice(0).forEach((f) => f());
        expect(tryExpandAtSeparator).toHaveBeenCalledTimes(1);
    });

    it("coalesces repeated compositionend into one run (cancels the first frame)", () => {
        const { retry } = make();
        retry.record(makeUpdate({ composing: true }));
        retry.onCompositionEnd();
        retry.onCompositionEnd();
        expect(cancelledFrames).toEqual([1]);
        flushTimers();
        expect(tryExpandAtSeparator).toHaveBeenCalledTimes(1);
    });

    it("destroy cancels a scheduled frame", () => {
        const { retry } = make();
        retry.record(makeUpdate({ composing: true }));
        retry.onCompositionEnd();
        retry.destroy();
        expect(cancelledFrames).toEqual([1]);
        flushTimers();
        expect(tryExpandAtSeparator).not.toHaveBeenCalled();
    });

    it("does not run when the document changed since the update was recorded", () => {
        const { retry, view } = make();
        retry.record(makeUpdate({ composing: true }));
        view.state = { doc: {}, selection: { main: { head: 3 } } };
        retry.onCompositionEnd();
        flushTimers();
        expect(tryExpandAtSeparator).not.toHaveBeenCalled();
        expect(retry.pending).toBe(false);
    });

    it("does not run when the cursor moved since the update was recorded", () => {
        const { retry, view } = make();
        retry.record(makeUpdate({ composing: true }));
        view.state = { doc: DOC, selection: { main: { head: 0 } } };
        retry.onCompositionEnd();
        flushTimers();
        expect(tryExpandAtSeparator).not.toHaveBeenCalled();
    });

    it("clears pending when the retry finds the view unfocused", () => {
        const { retry, view } = make();
        retry.record(makeUpdate({ composing: true }));
        view.hasFocus = false;
        retry.onCompositionEnd();
        flushTimers();
        expect(retry.pending).toBe(false);
        view.hasFocus = true;
        retry.onCompositionEnd();
        flushTimers();
        expect(tryExpandAtSeparator).not.toHaveBeenCalled();
    });

    it("a deletion-only composing update does not set pending (cancelled preedit)", () => {
        const { retry } = make();
        retry.record(makeUpdate({ composing: true, inserts: false }));
        expect(retry.pending).toBe(false);
        retry.onCompositionEnd();
        flushTimers();
        expect(tryExpandAtSeparator).not.toHaveBeenCalled();
    });

    it("schedules the frame on the view's own window (popout)", () => {
        const { retry, view } = make();
        const popFrames: Array<() => void> = [];
        view.dom = {
            ownerDocument: {
                defaultView: {
                    requestAnimationFrame: (fn: () => void) => popFrames.push(fn),
                    cancelAnimationFrame: () => {},
                },
            },
        };
        retry.record(makeUpdate({ composing: true }));
        retry.onCompositionEnd();
        expect(popFrames).toHaveLength(1);
        expect(frames).toHaveLength(0);
    });
});

describe("cm6-bridge: expansion mark wiring (B-176)", () => {
    const RESULT = { from: 0, insert: "be right back", original: "brb", separator: " " };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    type MarkSpec = { effects: { value: unknown } };
    function updateWithView(): { update: ViewUpdate; dispatch: Mock<(spec: MarkSpec) => void> } {
        const dispatch = vi.fn<(spec: MarkSpec) => void>();
        return { update: makeUpdate({ dispatch }), dispatch };
    }

    it("dispatches the mark effect on the update's view when the setting is on", async () => {
        vi.mocked(tryExpandAtSeparator).mockResolvedValueOnce(RESULT);
        const { update, dispatch } = updateWithView();
        handleViewUpdate(makeApp(), () => ({}), update, () => undefined, () => true);
        await new Promise((r) => setTimeout(r, 0));
        expect(dispatch).toHaveBeenCalledTimes(1);
        const spec = nth(dispatch.mock.calls, 0)[0];
        expect(spec.effects.value).toEqual(RESULT);
    });

    it("dispatches nothing when the setting is off (default)", async () => {
        vi.mocked(tryExpandAtSeparator).mockResolvedValueOnce(RESULT);
        const { update, dispatch } = updateWithView();
        handleViewUpdate(makeApp(), () => ({}), update);
        await new Promise((r) => setTimeout(r, 0));
        expect(dispatch).not.toHaveBeenCalled();
    });

    it("dispatches nothing when no expansion happened", async () => {
        const { update, dispatch } = updateWithView();
        handleViewUpdate(makeApp(), () => ({}), update, () => undefined, () => true);
        await new Promise((r) => setTimeout(r, 0));
        expect(dispatch).not.toHaveBeenCalled();
    });

    it("the B-191 composition retry marks the expansion too", async () => {
        vi.mocked(tryExpandAtSeparator).mockResolvedValueOnce(RESULT);
        const dispatch = vi.fn();
        const view: FakeView = { composing: false, hasFocus: true, state: { doc: DOC, selection: { main: { head: 3 } } }, dispatch };
        const retry = new CompositionRetry(asView(view), makeApp(), () => ({}), () => undefined, () => true);
        const update = makeUpdate({ composing: true, view });
        view.composing = true;
        retry.record(update);
        expect(retry.pending).toBe(true);
        view.composing = false;
        retry.runPending();
        await new Promise((r) => setTimeout(r, 0));
        expect(dispatch).toHaveBeenCalledTimes(1);
    });
});

describe("cm6-bridge: field session wiring (B-243)", () => {
    const WITH_FIELDS = {
        from: 0,
        insert: "[]()",
        original: "lnk",
        separator: " ",
        session: { fields: [1, 3], final: 4 },
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    type Spec = { selection?: { anchor: number }; effects: { is(e: unknown): boolean; value: unknown } };

    function updateOnRealState(extensions: boolean): { update: ViewUpdate; dispatch: Mock<(spec: Spec) => void> } {
        const dispatch = vi.fn<(spec: Spec) => void>();
        const state = EditorState.create({ doc: "[]() ", extensions: extensions ? [buildFieldSessionExtension()] : [] });
        const view = { composing: false, hasFocus: true, state, dispatch };
        return { update: makeUpdate({ view }), dispatch };
    }

    it("a result with fields starts the session and puts the caret in the first field", async () => {
        vi.mocked(tryExpandAtSeparator).mockResolvedValueOnce(WITH_FIELDS);
        const { update, dispatch } = updateOnRealState(true);
        handleViewUpdate(makeApp(), () => ({}), update);
        await new Promise((r) => setTimeout(r, 0));
        expect(dispatch).toHaveBeenCalledTimes(1);
        const spec = nth(dispatch.mock.calls, 0)[0];
        expect(spec.selection).toEqual({ anchor: 1 });
        expect(spec.effects.is(startFieldSessionEffect)).toBe(true);
    });

    it("the highlight mark is skipped when a session starts (the caret move would clear it)", async () => {
        vi.mocked(tryExpandAtSeparator).mockResolvedValueOnce(WITH_FIELDS);
        const { update, dispatch } = updateOnRealState(true);
        handleViewUpdate(makeApp(), () => ({}), update, () => undefined, () => true);
        await new Promise((r) => setTimeout(r, 0));
        expect(dispatch).toHaveBeenCalledTimes(1);
    });

    it("if the session cannot start (extension missing), the mark path still runs", async () => {
        vi.mocked(tryExpandAtSeparator).mockResolvedValueOnce(WITH_FIELDS);
        const { update, dispatch } = updateOnRealState(false);
        handleViewUpdate(makeApp(), () => ({}), update, () => undefined, () => true);
        await new Promise((r) => setTimeout(r, 0));
        expect(dispatch).toHaveBeenCalledTimes(1);
        expect(nth(dispatch.mock.calls, 0)[0].effects.is(startFieldSessionEffect)).toBe(false);
    });

    it("the extension carries the session field", () => {
        const state = EditorState.create({ doc: "x", extensions: [buildExpansionExtension(makeApp(), () => ({}))] });
        expect(() => state.field(fieldSessionField)).not.toThrow();
    });
});


describe("cm6-bridge: instant patterns (ADR-0008)", () => {
    const instant = compilePatternRules([
        { id: "i", source: "/<<$/", replacement: "\u226a", enabled: true, mode: "instant" },
    ]);
    const separatorOnly = compilePatternRules([
        { id: "s", source: "/<<$/", replacement: "\u226a", enabled: true, mode: "separator" },
    ]);
    const getInstant = (): CompiledPatterns => instant;
    const run = (update: ViewUpdate, getPatterns: () => CompiledPatterns = getInstant) =>
        handleViewUpdate(makeApp({ filename: "n.md" }), () => ({ brb: "x" }), update, () => undefined, () => false, getPatterns);

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("after a typed character with nothing expanded, tries the instant rules", async () => {
        run(makeUpdate({}));
        await new Promise((r) => setTimeout(r, 0));
        expect(tryExpandInstant).toHaveBeenCalledTimes(1);
        expect(tryExpandInstant).toHaveBeenCalledWith(
            { mock: "editor" },
            instant.rules,
            expect.objectContaining({ filename: "n.md" }),
        );
    });

    // ADR-0008, one order: the separator path gets EVERY rule (it tries them top to bottom, a separator rule before
    // the separator and an instant rule through it) plus the typed-character flag. The old "separator rules first,
    // instant rules after" split is gone.
    it("hands all rules and the instant flag to the separator path, which decides the order", async () => {
        run(makeUpdate({}));
        await new Promise((r) => setTimeout(r, 0));
        expect(tryExpandAtSeparator).toHaveBeenLastCalledWith(
            { mock: "editor" },
            { brb: "x" },
            expect.objectContaining({ patterns: instant.rules, instant: true }),
        );
        run(makeUpdate({}), () => separatorOnly);
        await new Promise((r) => setTimeout(r, 0));
        expect(tryExpandAtSeparator).toHaveBeenLastCalledWith(
            { mock: "editor" },
            { brb: "x" },
            expect.objectContaining({ patterns: separatorOnly.rules, instant: false }),
        );
        expect(tryExpandInstant).toHaveBeenCalledTimes(1); // only for the first run, which has an instant rule
        run(makeUpdate({}), () => NO_PATTERNS);
        await new Promise((r) => setTimeout(r, 0));
        expect(vi.mocked(tryExpandAtSeparator).mock.calls[2]?.[2].patterns).toBeUndefined();
    });

    it("a mixed list is passed whole, in list order (the order is the user's)", async () => {
        const mixed = compilePatternRules([
            { id: "a", source: String.raw`/\.\.\.$/`, replacement: "\u2026", enabled: true, mode: "instant" },
            { id: "b", source: String.raw`/(\w+)\.\.$/`, replacement: "[{{1}}]", enabled: true, mode: "separator" },
        ]);
        run(makeUpdate({}), () => mixed);
        await new Promise((r) => setTimeout(r, 0));
        const deps = vi.mocked(tryExpandAtSeparator).mock.calls[0]?.[2];
        expect(deps?.patterns?.map((r) => r.id)).toEqual(["a", "b"]);
        expect(deps?.instant).toBe(true);
    });

    it("a literal or separator expansion wins: the instant rules are not tried", async () => {
        vi.mocked(tryExpandAtSeparator).mockResolvedValueOnce({ from: 0, insert: "x", original: "brb", separator: " " });
        run(makeUpdate({}));
        await new Promise((r) => setTimeout(r, 0));
        expect(tryExpandInstant).not.toHaveBeenCalled();
    });

    it("an instant expansion is reported to the highlight mark like any other", async () => {
        const result = { from: 0, insert: "\u226a", original: "<<", separator: "" };
        vi.mocked(tryExpandInstant).mockResolvedValueOnce(result);
        const dispatch = vi.fn();
        handleViewUpdate(
            makeApp(),
            () => ({}),
            makeUpdate({ view: { hasFocus: true, composing: false, dispatch } }),
            () => undefined,
            () => true,
            getInstant,
        );
        await new Promise((r) => setTimeout(r, 0));
        expect(dispatch).toHaveBeenCalledTimes(1);
    });

    it.each([
        ["paste-sized text", { inserted: { length: 30, lines: 1 } }],
        ["two characters (auto-paired bracket)", { inserted: { length: 2, lines: 1 } }],
        ["Enter", { inserted: { length: 1, lines: 2 } }],
        ["typing over a selection", { inserted: { length: 1, lines: 1, deleted: 3 } }],
        ["multiple cursors", { selection: { ranges: 2, empty: true, head: 3 } }],
        ["a selection", { selection: { ranges: 1, empty: false, head: 3 } }],
    ])("does not try instant rules for %s", async (_name, opts) => {
        run(makeUpdate(opts));
        await new Promise((r) => setTimeout(r, 0));
        expect(tryExpandAtSeparator).toHaveBeenCalledTimes(1); // the literal path still runs
        expect(tryExpandInstant).not.toHaveBeenCalled();
    });

    it("does not try instant rules when the change is not typing, or while composing", async () => {
        for (const update of [
            makeUpdate({ transactions: [{ userEvent: "input.paste" }] }),
            makeUpdate({ transactions: [{ userEvent: "undo" }] }),
            makeUpdate({ transactions: [{ userEvent: undefined }] }),
            makeUpdate({ composing: true }),
        ]) run(update);
        await new Promise((r) => setTimeout(r, 0));
        expect(tryExpandInstant).not.toHaveBeenCalled();
    });

    it("never inspects the update when no instant rule exists (the hot path stays as it was)", () => {
        const update = makeUpdate({});
        const spy = vi.spyOn(update.changes, "iterChanges");
        run(update, () => NO_PATTERNS);
        run(update, () => separatorOnly);
        expect(spy).not.toHaveBeenCalled();
    });

    it("the composition retry remembers that the deferred update was a single typed character", async () => {
        const win = { requestAnimationFrame: (fn: () => void) => { fn(); return 1; }, cancelAnimationFrame: () => {} };
        vi.stubGlobal("window", { ...win, setTimeout: (fn: () => void) => { fn(); return 1; }, clearTimeout: () => {} });
        try {
            const view = { composing: true, hasFocus: true, state: { doc: DOC, selection: { main: { head: 3 } } }, dom: { ownerDocument: { defaultView: win } } };
            const retry = new CompositionRetry(asView(view), makeApp(), () => ({}), () => undefined, () => false, getInstant);
            retry.record(makeUpdate({ composing: true }));
            expect(retry.pending).toBe(true);
            view.composing = false;
            retry.runPending();
            await new Promise((r) => setTimeout(r, 0));
            expect(tryExpandInstant).toHaveBeenCalledTimes(1);

            // a deferred multi-character commit does not qualify
            vi.clearAllMocks();
            view.composing = true;
            retry.record(makeUpdate({ composing: true, inserted: { length: 3, lines: 1 } }));
            view.composing = false;
            retry.runPending();
            await new Promise((r) => setTimeout(r, 0));
            expect(tryExpandAtSeparator).toHaveBeenCalledTimes(1);
            expect(tryExpandInstant).not.toHaveBeenCalled();
        } finally {
            vi.unstubAllGlobals();
        }
    });
});

describe("cm6-bridge: instant patterns next to auto-paired brackets (ADR-0008)", () => {
    // `x (c)` with "Auto pair brackets": `(` inserts `()` (caret between), the final `)` only steps over the closer.
    const copyright = compilePatternRules([
        { id: "c", source: String.raw`/\(c\)$/i`, replacement: "\u00a9", enabled: true, mode: "instant" },
        { id: "sep", source: String.raw`/\(tm\)$/i`, replacement: "\u2122", enabled: true, mode: "separator" },
    ]);
    const getRules = (): CompiledPatterns => copyright;
    // The bridge reads the caret and the line when a pair is inserted (the closer is tied to them).
    const editor = { mock: "editor", getCursor: () => ({ line: 0, ch: 3 }), getLine: () => "x ()" };
    const app = makeApp({ editor, filename: "n.md" });
    const getSnippets = () => ({ brb: "be right back" });

    /** The pair insert: `()` typed at offset 2 of "x ", caret between. */
    const pairInsert = (opts: { text?: string; transactions?: FakeTx[] } = {}) =>
        makeUpdate({
            inserted: { length: 2, lines: 1, text: opts.text ?? "()", end: 4 },
            selection: { ranges: 1, empty: true, head: 3 },
            ...(opts.transactions ? { transactions: opts.transactions } : {}),
        });

    /** A selection-only update moving the caret from `from` to `to` over `passed`. */
    const caretMove = (opts: {
        from: number;
        to: number;
        passed?: string;
        transactions?: FakeTx[];
        ranges?: number;
        empty?: boolean;
        beforeEmpty?: boolean;
        hasFocus?: boolean;
        composing?: boolean;
    }) => {
        const update = makeUpdate({
            docChanged: false,
            transactions: opts.transactions ?? [{ userEvent: undefined }],
            selection: { ranges: opts.ranges ?? 1, empty: opts.empty ?? true, head: opts.to },
            ...(opts.hasFocus === undefined ? {} : { hasFocus: opts.hasFocus }),
            ...(opts.composing === undefined ? {} : { composing: opts.composing }),
        });
        return Object.assign(update, {
            startState: { selection: { ranges: [{}], main: { head: opts.from, empty: opts.beforeEmpty ?? true } } },
            state: {
                ...update.state,
                doc: { sliceString: (from: number, to: number) => (to - from === 1 ? (opts.passed ?? ")") : "??") },
            },
        });
    };

    const feed = (update: ViewUpdate, pairs: PairedCloserTracker, getPatterns: () => CompiledPatterns = getRules) =>
        handleViewUpdate(app, getSnippets, update, () => undefined, () => false, getPatterns, pairs);
    const flush = () => new Promise((r) => setTimeout(r, 0));
    /** Types `x (c` then the pair insert came first: the tracker now holds the closer after the caret. */
    const trackedAfterOpener = (): PairedCloserTracker => {
        const pairs = new PairedCloserTracker();
        feed(pairInsert(), pairs);
        expect(pairs.tracked).toBe(true);
        return pairs;
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("shape 2: the auto-paired opener is an instant keystroke (the rule sees the text up to the caret)", async () => {
        feed(pairInsert(), new PairedCloserTracker());
        await flush();
        expect(tryExpandAtSeparator).toHaveBeenLastCalledWith(
            editor,
            { brb: "be right back" },
            expect.objectContaining({ patterns: copyright.rules, instant: true }),
        );
    });

    it.each(["()", "[]", "{}", '""', "''", "``", "**", "__"])("shape 2: %s counts as an auto-pair", async (text) => {
        feed(pairInsert({ text }), new PairedCloserTracker());
        await flush();
        expect(vi.mocked(tryExpandAtSeparator).mock.calls[0]?.[2].instant).toBe(true);
    });

    it.each(["ab", "(]", "))", "  ", ""])("shape 2: the two characters %j are not an auto-pair", async (text) => {
        const pairs = new PairedCloserTracker();
        feed(pairInsert({ text }), pairs);
        await flush();
        expect(vi.mocked(tryExpandAtSeparator).mock.calls[0]?.[2].instant).toBe(false);
        expect(pairs.tracked).toBe(false);
    });

    it("shape 2: a pasted pair is not typing, and is not tracked", async () => {
        const pairs = new PairedCloserTracker();
        feed(pairInsert({ transactions: [{ userEvent: "input.paste" }] }), pairs);
        await flush();
        expect(tryExpandAtSeparator).not.toHaveBeenCalled();
        expect(pairs.tracked).toBe(false);
    });

    it("shape 1: stepping over the tracked closer after typing `(c` expands the instant rules only", async () => {
        const pairs = trackedAfterOpener(); // closer at offset 3
        // type `c` inside the pair: the closer moves to 4 (CM6 maps it through the insertion)
        const typed = makeUpdate({ selection: { ranges: 1, empty: true, head: 4 } });
        Object.assign(typed.changes, { mapPos: (pos: number) => pos + 1 });
        feed(typed, pairs);
        expect(pairs.isAt(4, ")")).toBe(true);
        vi.clearAllMocks();

        feed(caretMove({ from: 4, to: 5 }), pairs);
        await flush();
        expect(tryExpandAtSeparator).toHaveBeenCalledTimes(1);
        // no literal snippets (empty dictionary), only the instant rule, flagged as instant
        expect(tryExpandAtSeparator).toHaveBeenCalledWith(
            editor,
            {},
            expect.objectContaining({ patterns: [copyright.rules[0]], instant: true }),
        );
        expect(pairs.tracked).toBe(false); // consumed
    });

    it("shape 1: also with a `{ userEvent: \"input.type\" }` tag", async () => {
        const pairs = new PairedCloserTracker();
        pairs.track(4, ")");
        feed(caretMove({ from: 4, to: 5, transactions: [{ userEvent: "input.type" }] }), pairs);
        await flush();
        expect(tryExpandAtSeparator).toHaveBeenCalledTimes(1);
    });

    it("shape 1: the result reaches the highlight mark like any other expansion", async () => {
        const dispatch = vi.fn();
        vi.mocked(tryExpandAtSeparator).mockResolvedValueOnce({ from: 2, insert: "\u00a9", original: "(c)", separator: "" });
        const pairs = new PairedCloserTracker();
        pairs.track(4, ")");
        const update = caretMove({ from: 4, to: 5 });
        Object.assign(update.view, { dispatch });
        handleViewUpdate(app, getSnippets, update, () => undefined, () => true, getRules, pairs);
        await flush();
        expect(dispatch).toHaveBeenCalledTimes(1);
    });

    it("shape 1: a caret move onto a closer Snipsy never saw inserted (programmatic setCursor) does not expand", async () => {
        feed(caretMove({ from: 4, to: 5 }), new PairedCloserTracker());
        await flush();
        expect(tryExpandAtSeparator).not.toHaveBeenCalled();
    });

    it("shape 1: the tracked closer at another offset does not match", async () => {
        const pairs = new PairedCloserTracker();
        pairs.track(9, ")");
        feed(caretMove({ from: 4, to: 5 }), pairs);
        await flush();
        expect(tryExpandAtSeparator).not.toHaveBeenCalled();
        expect(pairs.tracked).toBe(false);
    });

    it.each([
        ["an arrow key (select)", { transactions: [{ userEvent: "select" }] }],
        ["a mouse click (select.pointer)", { transactions: [{ userEvent: "select.pointer" }] }],
        ["a move of two characters", { from: 4, to: 6 }],
        ["a move backwards", { from: 5, to: 4 }],
        ["multiple cursors", { ranges: 2 }],
        ["a selection after the move", { empty: false }],
        ["a selection before the move", { beforeEmpty: false }],
        ["a character that is not a closer", { passed: "a" }],
        ["a different closer than the tracked one", { passed: "]" }],
    ])("shape 1: %s does not expand, and ends the tracking", async (_name, opts) => {
        const pairs = new PairedCloserTracker();
        pairs.track(4, ")");
        feed(caretMove({ from: 4, to: 5, ...opts }), pairs);
        await flush();
        expect(tryExpandAtSeparator).not.toHaveBeenCalled();
        expect(tryExpandInstant).not.toHaveBeenCalled();
        expect(pairs.tracked).toBe(false);
    });

    it("shape 1: not while composing, not in a background pane", async () => {
        for (const opts of [{ composing: true }, { hasFocus: false }]) {
            const pairs = new PairedCloserTracker();
            pairs.track(4, ")");
            feed(caretMove({ from: 4, to: 5, ...opts }), pairs);
        }
        await flush();
        expect(tryExpandAtSeparator).not.toHaveBeenCalled();
    });

    it("shape 1: an update that leaves the caret where it was (focus, geometry) keeps the tracking", async () => {
        const pairs = new PairedCloserTracker();
        pairs.track(4, ")");
        feed(caretMove({ from: 4, to: 4 }), pairs);
        expect(pairs.tracked).toBe(true);
    });

    it("shape 1: without an instant rule nothing runs and the tracking is dropped", async () => {
        const pairs = new PairedCloserTracker();
        pairs.track(4, ")");
        feed(caretMove({ from: 4, to: 5 }), pairs, () => separatorOnlyRules);
        await flush();
        expect(tryExpandAtSeparator).not.toHaveBeenCalled();
        // the next typed update drops it for good
        feed(makeUpdate({}), pairs, () => separatorOnlyRules);
        expect(pairs.tracked).toBe(false);
    });

    it("a separator-only rule set is not affected by a pair insert", async () => {
        const pairs = new PairedCloserTracker();
        feed(pairInsert(), pairs, () => separatorOnlyRules);
        await flush();
        expect(vi.mocked(tryExpandAtSeparator).mock.calls[0]?.[2].instant).toBe(false);
        expect(pairs.tracked).toBe(false);
    });

    it("the tracking ends after an unrelated edit (undo, paste, programmatic write)", () => {
        for (const userEvent of ["undo", "input.paste", undefined, "snipsy.expand"]) {
            const pairs = trackedAfterOpener();
            feed(makeUpdate({ transactions: [{ userEvent }] }), pairs);
            expect(pairs.tracked).toBe(false);
        }
    });

    it("typing inside the pair carries the tracked closer along, and a deletion over it ends the tracking", () => {
        const carried = trackedAfterOpener();
        const typed = makeUpdate({ selection: { ranges: 1, empty: true, head: 4 } });
        Object.assign(typed.changes, { mapPos: (pos: number) => pos + 1 });
        feed(typed, carried);
        expect(carried.isAt(4, ")")).toBe(true);

        const deleted = trackedAfterOpener();
        const gone = makeUpdate({ inserts: false });
        Object.assign(gone.changes, { mapPos: () => null });
        feed(gone, deleted);
        expect(deleted.tracked).toBe(false);
    });

    it("a second auto-pair replaces the tracked closer (only the latest is followed)", () => {
        const pairs = trackedAfterOpener();
        feed(makeUpdate({ inserted: { length: 2, lines: 1, text: "[]", end: 8 }, selection: { ranges: 1, empty: true, head: 7 } }), pairs);
        expect(pairs.isAt(7, "]")).toBe(true);
        expect(pairs.isAt(3, ")")).toBe(false);
    });

    it("the composition retry follows the closer across a selection-only update", async () => {
        const view = { composing: false, hasFocus: true, state: { doc: DOC, selection: { main: { head: 3 } } } };
        const retry = new CompositionRetry(asView(view), app, () => ({}), () => undefined, () => false, getRules);
        // typing `(` inserts the pair (view.plugin owns the tracker, so the pair insert goes through `record`)
        retry.record(makeUpdate({ view, inserted: { length: 2, lines: 1, text: "()", end: 4 }, selection: { ranges: 1, empty: true, head: 3 } }));
        await flush();
        vi.clearAllMocks();
        // then the caret steps over the closer at offset 3
        retry.record(caretMove({ from: 3, to: 4 }));
        await flush();
        expect(tryExpandAtSeparator).toHaveBeenCalledTimes(1);
        expect(retry.pending).toBe(false);
    });

    // ---- the real CM6 `ChangeSet` (no stubbed `mapPos`): the tracker follows the text exactly ----

    /** One real transaction on `state`, presented as the update the bridge receives. */
    const real = (state: EditorState, spec: TransactionSpec): { update: ViewUpdate; state: EditorState } => {
        const tr = state.update(spec);
        const update = {
            docChanged: tr.docChanged,
            view: { hasFocus: true, composing: false },
            transactions: [tr],
            changes: tr.changes,
            state: tr.state,
            startState: state,
        } as unknown as ViewUpdate;
        return { update, state: tr.state };
    };

    describe("the tracked closer follows a real ChangeSet", () => {
        // "ab()cd": the closer `)` is at offset 3
        const start = (): { state: EditorState; pairs: PairedCloserTracker } => {
            const pairs = new PairedCloserTracker();
            pairs.track(3, ")");
            return { state: EditorState.create({ doc: "ab()cd", selection: { anchor: 3 } }), pairs };
        };

        it("an insertion at the closer (typing inside the pair) moves it by the inserted length", () => {
            const { state, pairs } = start();
            feed(real(state, { changes: { from: 3, insert: "v" }, selection: { anchor: 4 }, userEvent: "input.type" }).update, pairs);
            expect(pairs.isAt(4, ")")).toBe(true);
        });

        it("an insertion after the closer leaves it", () => {
            const { state, pairs } = start();
            feed(real(state, { changes: { from: 4, insert: "v" }, selection: { anchor: 5 }, userEvent: "input.type" }).update, pairs);
            expect(pairs.isAt(3, ")")).toBe(true);
        });

        it("a deletion before the closer moves it back", () => {
            const { state, pairs } = start();
            feed(real(state, { changes: { from: 1, to: 2 }, selection: { anchor: 2 }, userEvent: "delete.backward" }).update, pairs);
            expect(pairs.isAt(2, ")")).toBe(true);
        });

        it("a deletion of the closer itself ends the tracking", () => {
            const { state, pairs } = start();
            feed(real(state, { changes: { from: 3, to: 4 }, userEvent: "delete.forward" }).update, pairs);
            expect(pairs.tracked).toBe(false);
        });

        it("Backspace inside an empty pair deletes both characters and ends the tracking", () => {
            const { state, pairs } = start();
            feed(real(state, { changes: { from: 2, to: 4 }, selection: { anchor: 2 }, userEvent: "delete.backward" }).update, pairs);
            expect(pairs.tracked).toBe(false);
        });
    });

    it("a typo fixed inside the pair keeps the rule: `x (v`, Backspace, `c`, `)` gives the sign", async () => {
        const pairs = new PairedCloserTracker();
        let state = EditorState.create({ doc: "x ", selection: { anchor: 2 } });
        const step = (spec: TransactionSpec): void => {
            const r = real(state, spec);
            state = r.state;
            feed(r.update, pairs);
        };
        step({ changes: { from: 2, insert: "()" }, selection: { anchor: 3 }, userEvent: "input.type" }); // the editor pairs `(`
        step({ changes: { from: 3, insert: "v" }, selection: { anchor: 4 }, userEvent: "input.type" });
        expect(pairs.isAt(4, ")")).toBe(true);
        step({ changes: { from: 3, to: 4 }, selection: { anchor: 3 }, userEvent: "delete.backward" });
        expect(pairs.isAt(3, ")")).toBe(true);
        step({ changes: { from: 3, insert: "c" }, selection: { anchor: 4 }, userEvent: "input.type" });
        expect(state.doc.toString()).toBe("x (c)");
        await flush();
        vi.clearAllMocks();

        step({ selection: { anchor: 5 } }); // typing `)` only steps over the closer
        await flush();
        expect(tryExpandAtSeparator).toHaveBeenCalledTimes(1);
        expect(tryExpandAtSeparator).toHaveBeenCalledWith(
            editor,
            {},
            expect.objectContaining({ patterns: [copyright.rules[0]], instant: true }),
        );
    });

    it("`*x*` with auto-paired Markdown: the pair insert, typing inside, then the step-over fire the rule", async () => {
        const star = compilePatternRules([{ id: "b", source: String.raw`/\*x\*$/`, replacement: "B", enabled: true, mode: "instant" }]);
        const pairs = new PairedCloserTracker();
        let state = EditorState.create({ doc: "", selection: { anchor: 0 } });
        const step = (spec: TransactionSpec): void => {
            const r = real(state, spec);
            state = r.state;
            feed(r.update, pairs, () => star);
        };
        step({ changes: { from: 0, insert: "**" }, selection: { anchor: 1 }, userEvent: "input.type" });
        expect(pairs.isAt(1, "*")).toBe(true);
        // the pair insert itself is an instant keystroke (the rule sees `*`)
        expect(vi.mocked(tryExpandAtSeparator).mock.calls.at(-1)?.[2].instant).toBe(true);
        step({ changes: { from: 1, insert: "x" }, selection: { anchor: 2 }, userEvent: "input.type" });
        await flush();
        vi.clearAllMocks();
        step({ selection: { anchor: 3 } });
        await flush();
        // `*` is no delimiter: the separator path finds nothing and the instant rules run
        expect(tryExpandAtSeparator).toHaveBeenCalledTimes(1);
        expect(tryExpandInstant).toHaveBeenCalledTimes(1);
        expect(vi.mocked(tryExpandInstant).mock.calls[0]?.[1]).toEqual(star.rules);
    });

    it("`_w_` with auto-paired Markdown: stepping over the underscore closer runs the instant rules", async () => {
        const under = compilePatternRules([{ id: "i", source: String.raw`/_(\w+)_$/`, replacement: "{{1}}", enabled: true, mode: "instant" }]);
        const pairs = new PairedCloserTracker();
        pairs.track(4, "_");
        feed(caretMove({ from: 4, to: 5, passed: "_" }), pairs, () => under);
        await flush();
        expect(tryExpandAtSeparator).toHaveBeenCalledTimes(1);
        expect(tryExpandInstant).toHaveBeenCalledTimes(1);
        expect(pairs.tracked).toBe(false);
    });

    it("stepping over a closer never passes the pair closer on (nothing to take along)", async () => {
        const pairs = new PairedCloserTracker();
        pairs.track(4, ")");
        feed(caretMove({ from: 4, to: 5 }), pairs);
        await flush();
        expect(vi.mocked(tryExpandAtSeparator).mock.calls[0]?.[2].pairCloser).toBeUndefined();
    });

    // ---- an instant rule that consumes the opener takes the auto-inserted closer along ----

    it("the pair insert hands the closer to the expansion, for both entry points", async () => {
        feed(pairInsert(), new PairedCloserTracker());
        await flush();
        // tied to the caret and the line of the update, read before any await
        const tied = { closer: ")", caret: { line: 0, ch: 3 }, lineText: "x ()" };
        expect(vi.mocked(tryExpandAtSeparator).mock.calls[0]?.[2].pairCloser).toEqual(tied);
        expect(vi.mocked(tryExpandInstant).mock.calls[0]?.[2].pairCloser).toEqual(tied);
    });

    it("a pair insert in a transaction that is not purely typing hands nothing on, and is not tracked", async () => {
        const pairs = new PairedCloserTracker();
        feed(pairInsert({ transactions: [{ userEvent: "input.type" }, { userEvent: undefined }] }), pairs);
        await flush();
        expect(vi.mocked(tryExpandAtSeparator).mock.calls[0]?.[2].pairCloser).toBeUndefined();
        expect(pairs.tracked).toBe(false);
    });

    it("a single typed character has no pair closer", async () => {
        feed(makeUpdate({}), new PairedCloserTracker());
        await flush();
        expect(vi.mocked(tryExpandAtSeparator).mock.calls[0]?.[2].pairCloser).toBeUndefined();
    });

    // ---- hot path ----

    it.each(["undo", "input.paste", "select", "snipsy.expand", undefined])(
        "an update with no typing or deletion (%s) is not inspected at all, and drops the tracking",
        (userEvent) => {
            const pairs = trackedAfterOpener();
            const update = makeUpdate({ transactions: [{ userEvent }] });
            const iter = vi.spyOn(update.changes, "iterChanges");
            feed(update, pairs);
            expect(iter).not.toHaveBeenCalled();
            expect(pairs.tracked).toBe(false);
        },
    );

    it("without a tracker (a view the plugin does not own) a pair insert is still a keystroke and a step-over is never typing", async () => {
        handleViewUpdate(app, getSnippets, pairInsert(), () => undefined, () => false, getRules);
        await flush();
        expect(vi.mocked(tryExpandAtSeparator).mock.calls[0]?.[2].instant).toBe(true);
        vi.clearAllMocks();
        handleViewUpdate(app, getSnippets, caretMove({ from: 3, to: 4 }), () => undefined, () => false, getRules);
        await flush();
        expect(tryExpandAtSeparator).not.toHaveBeenCalled();
    });
});

const separatorOnlyRules: CompiledPatterns = compilePatternRules([
    { id: "s", source: String.raw`/\(c\)$/`, replacement: "\u00a9", enabled: true, mode: "separator" },
]);

describe("cm6-bridge: manual mode, expand while typing off (B-255)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("typing never expands when onType is off, even for genuine typing", () => {
        const outcome = handleViewUpdate(makeApp(), () => ({ fn: "x" }), makeUpdate({}), () => undefined, () => false, () => NO_PATTERNS, undefined, () => false);
        expect(outcome).toBe("ignored");
        expect(tryExpandAtSeparator).not.toHaveBeenCalled();
    });

    it("onType off also stops instant pattern rules and drops a tracked auto-pair closer", () => {
        const instantRules = compilePatternRules([
            { id: "i", source: "/<<$/", replacement: "\u226a", enabled: true, mode: "instant" },
        ]);
        const pairs = new PairedCloserTracker();
        pairs.track(3, ")");
        const outcome = handleViewUpdate(
            makeApp(),
            () => ({}),
            makeUpdate({}),
            () => undefined,
            () => false,
            () => instantRules,
            pairs,
            () => false,
        );
        expect(outcome).toBe("ignored");
        expect(pairs.tracked).toBe(false);
        expect(tryExpandAtSeparator).not.toHaveBeenCalled();
        expect(tryExpandInstant).not.toHaveBeenCalled();
    });

    it("typing still expands when onType is on (and by default)", () => {
        handleViewUpdate(makeApp(), () => ({}), makeUpdate({}), () => undefined, () => false, () => NO_PATTERNS, undefined, () => true);
        handleViewUpdate(makeApp(), () => ({}), makeUpdate({}));
        expect(tryExpandAtSeparator).toHaveBeenCalledTimes(2);
    });

    it("is read at call time: flipping the setting takes effect on the next update", () => {
        let onType = false;
        const app = makeApp();
        handleViewUpdate(app, () => ({}), makeUpdate({}), () => undefined, () => false, () => NO_PATTERNS, undefined, () => onType);
        expect(tryExpandAtSeparator).not.toHaveBeenCalled();
        onType = true;
        handleViewUpdate(app, () => ({}), makeUpdate({}), () => undefined, () => false, () => NO_PATTERNS, undefined, () => onType);
        expect(tryExpandAtSeparator).toHaveBeenCalledTimes(1);
    });

    it("the composition retry stays idle when onType is off (nothing becomes pending)", () => {
        const view = { hasFocus: true, composing: true };
        const retry = new CompositionRetry(asView(view), makeApp(), () => ({}), () => undefined, () => false, () => NO_PATTERNS, () => false);
        retry.record(makeUpdate({ view, composing: true }));
        expect(retry.pending).toBe(false);
        retry.destroy();
    });
});

describe("cm6-bridge: Tab expansion (B-255)", () => {
    const view = { composing: false, state: { readOnly: false } };
    const editor = { cm: view } as unknown;

    beforeEach(() => {
        vi.clearAllMocks();
    });

    function tab(opts: { onTab?: boolean; found?: boolean; editorOverride?: unknown; v?: unknown } = {}): boolean {
        vi.mocked(canExpandAtCursor).mockReturnValue(opts.found ?? true);
        const app = makeApp({ editor: opts.editorOverride === undefined ? editor : opts.editorOverride });
        return handleTab((opts.v ?? view) as EditorView, app, () => ({ brb: "x" }), () => undefined, () => opts.onTab ?? true);
    }

    it("takes Tab and runs the command expansion when a trigger sits before the caret", () => {
        expect(tab()).toBe(true);
        expect(expandTriggerAtCursor).toHaveBeenCalledTimes(1);
    });

    it("lets Tab through when there is no trigger (indent keeps working)", () => {
        expect(tab({ found: false })).toBe(false);
        expect(expandTriggerAtCursor).not.toHaveBeenCalled();
    });

    it("lets Tab through when Expand on Tab is off, without even looking", () => {
        expect(tab({ onTab: false })).toBe(false);
        expect(canExpandAtCursor).not.toHaveBeenCalled();
    });

    it("lets Tab through during IME composition and in a read-only view", () => {
        expect(tab({ v: { ...view, composing: true } })).toBe(false);
        const ro = { composing: false, state: { readOnly: true } };
        expect(tab({ v: ro, editorOverride: { cm: ro } })).toBe(false);
        expect(expandTriggerAtCursor).not.toHaveBeenCalled();
    });

    it("never acts on another pane's editor (editor.cm is a different view)", () => {
        expect(tab({ editorOverride: { cm: { composing: false, state: { readOnly: false } } } })).toBe(false);
        expect(tab({ editorOverride: null })).toBe(false);
        expect(expandTriggerAtCursor).not.toHaveBeenCalled();
    });

    it("expands in manual mode (selection, caret inside a word) like the original plugin", () => {
        expect(tab()).toBe(true);
        expect(nth(vi.mocked(expandTriggerAtCursor).mock.calls, 0)[5]).toEqual({ manual: true });
    });

    describe("with pattern rules (ADR-0008)", () => {
        const patterns = compilePatternRules([
            { id: "s", source: "/dd$/", replacement: "x", enabled: true, mode: "separator" },
        ]);
        const tabWith = (getPatterns?: () => CompiledPatterns): boolean => {
            vi.mocked(canExpandAtCursor).mockReturnValue(true);
            const app = makeApp({ editor });
            return handleTab(
                view as unknown as EditorView,
                app,
                () => ({ brb: "x" }),
                () => undefined,
                () => true,
                () => false,
                getPatterns,
            );
        };

        it("hands the rules to the can-expand check and the same rules to the command expansion", () => {
            expect(tabWith(() => patterns)).toBe(true);
            expect(vi.mocked(canExpandAtCursor).mock.calls[0]?.[3]).toBe(patterns.rules);
            const call = nth(vi.mocked(expandTriggerAtCursor).mock.calls, 0);
            expect(call[4]?.()).toBe(patterns);
            expect(call[5]).toEqual({ manual: true });
        });

        it("without patterns the check gets an empty rule list (as before)", () => {
            expect(tabWith()).toBe(true);
            expect(vi.mocked(canExpandAtCursor).mock.calls[0]?.[3]).toEqual([]);
        });

        it("a Tab that matches no literal trigger and no rule is passed on, nothing runs", () => {
            vi.mocked(canExpandAtCursor).mockReturnValue(false);
            const app = makeApp({ editor });
            const taken = handleTab(
                view as unknown as EditorView,
                app,
                () => ({}),
                () => undefined,
                () => true,
                () => false,
                () => patterns,
            );
            expect(taken).toBe(false);
            expect(expandTriggerAtCursor).not.toHaveBeenCalled();
        });

        it("Tab with Expand on Tab off never looks at the rules", () => {
            const getPatterns = vi.fn(() => patterns);
            const app = makeApp({ editor });
            expect(
                handleTab(view as unknown as EditorView, app, () => ({}), () => undefined, () => false, () => false, getPatterns),
            ).toBe(false);
            expect(getPatterns).not.toHaveBeenCalled();
        });
    });

    describe("highlight / Backspace-undo mark (B-176) on Tab expansions", () => {
        const info = { from: 0, insert: "xx", original: "brb", separator: "" };
        function tabWith(getHighlight: boolean, result: object | undefined): { dispatch: Mock } {
            const dispatch = vi.fn();
            const v = { ...view, dispatch };
            vi.mocked(expandTriggerAtCursor).mockResolvedValueOnce(result as never);
            vi.mocked(canExpandAtCursor).mockReturnValue(true);
            const app = makeApp({ editor: { cm: v } });
            handleTab(v as unknown as EditorView, app, () => ({ brb: "x" }), () => undefined, () => true, () => getHighlight);
            return { dispatch };
        }

        it("marks the landed expansion when Highlight expansions is on", async () => {
            const { dispatch } = tabWith(true, info);
            await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1));
        });

        it("marks nothing when the setting is off, when a field session took the caret, or when nothing expanded", async () => {
            const off = tabWith(false, info);
            const session = tabWith(true, { ...info, session: { fields: [1, 2], final: 3 } });
            const none = tabWith(true, undefined);
            await new Promise((r) => setTimeout(r, 0));
            expect(off.dispatch).not.toHaveBeenCalled();
            expect(session.dispatch).not.toHaveBeenCalled();
            expect(none.dispatch).not.toHaveBeenCalled();
        });
    });

    it("logs a failing expansion instead of an unhandled rejection", async () => {
        const boom = new Error("boom");
        vi.mocked(expandTriggerAtCursor).mockRejectedValueOnce(boom);
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        expect(tab()).toBe(true);
        await new Promise((r) => setTimeout(r, 0));
        expect(log).toHaveBeenCalledWith("[snipsy] Tab expansion error", boom);
        log.mockRestore();
    });

    it("the built extension routes Tab outside a session to handleTab", () => {
        vi.mocked(canExpandAtCursor).mockReturnValue(true);
        const state = EditorState.create({
            doc: "brb",
            extensions: [buildExpansionExtension(makeApp({ editor }), () => ({ brb: "x" }), () => undefined, () => false, () => NO_PATTERNS, () => true, () => true)],
        });
        const binding = state.facet(keymap).flat().find((b) => b.key === "Tab");
        expect(binding?.run?.(Object.assign(view, { state }) as unknown as EditorView)).toBe(true);
        expect(expandTriggerAtCursor).toHaveBeenCalled();
    });
});
