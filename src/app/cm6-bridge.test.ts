import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// mock the engine adapter call
vi.mock("../adapters/obsidian-editor", () => ({
    tryExpandAtSeparator: vi.fn().mockResolvedValue(undefined),
}));
import { tryExpandAtSeparator } from "../adapters/obsidian-editor";
import { handleViewUpdate, CompositionRetry } from "./cm6-bridge";

/**
 * B-149: `handleViewUpdate` is exported separately from the
 * `EditorView.updateListener.of(...)` extension builder so tests can
 * drive it with a hand-built fake `ViewUpdate` — no real CM6
 * `EditorView` required. Casts through `as any` at the boundary, same
 * pattern the rest of the suite uses for Obsidian/CM6 types (see
 * `src/test/stubs/obsidian.ts`).
 */

type FakeTx = { userEvent?: string };
const DOC = {};

function makeUpdate(opts: {
    docChanged?: boolean;
    hasFocus?: boolean;
    composing?: boolean;
    transactions?: FakeTx[];
    /** Whether the update inserts text (false = pure deletion). */
    inserts?: boolean;
    doc?: object;
    head?: number;
}) {
    const transactions = (opts.transactions ?? [{ userEvent: "input.type" }]).map((tx) => ({
        annotation: (_type: unknown) => tx.userEvent,
    }));
    return {
        docChanged: opts.docChanged ?? true,
        view: {
            hasFocus: opts.hasFocus ?? true,
            composing: opts.composing ?? false,
        },
        transactions,
        changes: {
            iterChanges: (
                f: (a: number, b: number, c: number, d: number, t: { length: number }) => void,
            ) => f(0, 0, 0, 0, { length: opts.inserts === false ? 0 : 1 }),
        },
        state: { doc: opts.doc ?? DOC, selection: { main: { head: opts.head ?? 3 } } },
    } as any;
}

function makeApp(opts: { editor?: unknown; filename?: string } = {}) {
    const editor = opts.editor === undefined ? { mock: "editor" } : opts.editor;
    return {
        workspace: {
            activeEditor: editor
                ? { editor, file: opts.filename ? { name: opts.filename } : null }
                : null,
        },
    } as any;
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
        view: { composing: boolean; hasFocus: boolean; state?: unknown } = {
            composing: false,
            hasFocus: true,
        },
    ) {
        view.state ??= { doc: DOC, selection: { main: { head: 3 } } };
        (view as any).dom = { ownerDocument: { defaultView: viewWin } };
        const retry = new CompositionRetry(view as any, makeApp(), () => ({}), () => undefined);
        return { retry, view: view as { composing: boolean; hasFocus: boolean; state: any } };
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
        (view as any).dom = {
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

    function updateWithView() {
        const update = makeUpdate({});
        update.view.dispatch = vi.fn();
        return update;
    }

    it("dispatches the mark effect on the update's view when the setting is on", async () => {
        vi.mocked(tryExpandAtSeparator).mockResolvedValueOnce(RESULT);
        const update = updateWithView();
        handleViewUpdate(makeApp(), () => ({}), update, () => undefined, () => true);
        await new Promise((r) => setTimeout(r, 0));
        expect(update.view.dispatch).toHaveBeenCalledTimes(1);
        const spec = update.view.dispatch.mock.calls[0][0];
        expect(spec.effects.value).toEqual(RESULT);
    });

    it("dispatches nothing when the setting is off (default)", async () => {
        vi.mocked(tryExpandAtSeparator).mockResolvedValueOnce(RESULT);
        const update = updateWithView();
        handleViewUpdate(makeApp(), () => ({}), update);
        await new Promise((r) => setTimeout(r, 0));
        expect(update.view.dispatch).not.toHaveBeenCalled();
    });

    it("dispatches nothing when no expansion happened", async () => {
        const update = updateWithView();
        handleViewUpdate(makeApp(), () => ({}), update, () => undefined, () => true);
        await new Promise((r) => setTimeout(r, 0));
        expect(update.view.dispatch).not.toHaveBeenCalled();
    });

    it("the B-191 composition retry marks the expansion too", async () => {
        vi.mocked(tryExpandAtSeparator).mockResolvedValueOnce(RESULT);
        const view = { composing: false, hasFocus: true, state: { doc: DOC, selection: { main: { head: 3 } } }, dispatch: vi.fn() } as any;
        const retry = new CompositionRetry(view, makeApp(), () => ({}), () => undefined, () => true);
        const update = makeUpdate({ composing: true });
        update.view = view;
        view.composing = true;
        retry.record(update);
        expect(retry.pending).toBe(true);
        view.composing = false;
        retry.runPending();
        await new Promise((r) => setTimeout(r, 0));
        expect(view.dispatch).toHaveBeenCalledTimes(1);
    });
});
