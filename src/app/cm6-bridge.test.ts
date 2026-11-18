import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import type { App } from "obsidian";
import { nth } from "../test/helpers";

// mock the engine adapter call
vi.mock("../adapters/obsidian-editor", () => ({
    tryExpandAtSeparator: vi.fn().mockResolvedValue(undefined),
    tryExpandInstant: vi.fn().mockResolvedValue(undefined),
}));
import { tryExpandAtSeparator, tryExpandInstant } from "../adapters/obsidian-editor";
import { compilePatternRules, NO_PATTERNS, type CompiledPatterns } from "../engine/patterns";
import { handleViewUpdate, CompositionRetry, buildExpansionExtension } from "./cm6-bridge";
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
    inserted?: { length: number; lines: number; deleted?: number };
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
            iterChanges: (
                f: (a: number, b: number, c: number, d: number, t: { length: number; lines: number }) => void,
            ) => {
                const ins = opts.inserted ?? { length: opts.inserts === false ? 0 : 1, lines: 1 };
                const head = opts.selection?.head ?? opts.head ?? 3;
                f(head - ins.length, head - ins.length + (ins.deleted ?? 0), head - ins.length, head, {
                    length: ins.length,
                    lines: ins.lines,
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
