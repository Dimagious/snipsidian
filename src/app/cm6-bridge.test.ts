import { describe, it, expect, vi } from "vitest";

// mock the engine adapter call
vi.mock("../adapters/obsidian-editor", () => ({
    tryExpandAtSeparator: vi.fn().mockResolvedValue(undefined),
}));
import { tryExpandAtSeparator } from "../adapters/obsidian-editor";
import { registerEditorChange } from "./cm6-bridge";

function makeApp() {
    const calls: any[] = [];
    const tokens: any[] = [];
    const app = {
        workspace: {
            on: vi.fn((evt: string, cb: Function) => {
                calls.push({ evt, cb });
                const token = { evt, cb, id: Math.random() };
                tokens.push(token);
                return token;
            }),
            offref: vi.fn((token: any) => {
                // simulate de-registration
                const i = tokens.indexOf(token);
                if (i !== -1) tokens.splice(i, 1);
            }),
            getActiveFile: vi.fn(() => ({ name: "note.md" })),
        },
    } as any;
    return { app, calls, tokens };
}

describe("app/registerEditorChange", () => {
    it("registers editor-change handler and returns disposer", async () => {
        const { app, calls, tokens } = makeApp();
        const getSnips = () => ({ fn: "function $|() {}" });

        const dispose = registerEditorChange(app, getSnips);
        expect(app.workspace.on).toHaveBeenCalledWith("editor-change", expect.any(Function));
        expect(tokens.length).toBe(1);

        // fire the callback (simulate typing)
        const cb = calls[0].cb;
        await cb({/* editor */ }, {/* info */ });

        expect(tryExpandAtSeparator).toHaveBeenCalledTimes(1);
        // disposer unregisters
        dispose();
        expect(app.workspace.offref).toHaveBeenCalledWith(expect.objectContaining({ evt: "editor-change" }));
    });
});
