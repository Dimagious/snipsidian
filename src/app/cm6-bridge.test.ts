import { describe, it, expect, vi, beforeEach } from "vitest";

// mock the engine adapter call
vi.mock("../adapters/obsidian-editor", () => ({
    tryExpandAtSeparator: vi.fn().mockResolvedValue(undefined),
}));
import { tryExpandAtSeparator } from "../adapters/obsidian-editor";
import { handleViewUpdate } from "./cm6-bridge";

/**
 * B-149: `handleViewUpdate` is exported separately from the
 * `EditorView.updateListener.of(...)` extension builder so tests can
 * drive it with a hand-built fake `ViewUpdate` — no real CM6
 * `EditorView` required. Casts through `as any` at the boundary, same
 * pattern the rest of the suite uses for Obsidian/CM6 types (see
 * `src/test/stubs/obsidian.ts`).
 */

type FakeTx = { userEvent?: string };

function makeUpdate(opts: {
    docChanged?: boolean;
    hasFocus?: boolean;
    composing?: boolean;
    transactions?: FakeTx[];
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
