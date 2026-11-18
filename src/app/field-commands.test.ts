import { describe, it, expect, vi } from "vitest";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import type { App } from "obsidian";
import { MockEditor, asEditor } from "../test/factories/editor";
import { compilePatternRules, NO_PATTERNS } from "../engine/patterns";
import { expandTriggerAtCursor, jumpToNextField } from "./field-commands";
import {
    buildFieldSessionExtension,
    fieldSessionField,
    startFieldSession,
    startFieldSessionInEditor,
} from "../adapters/field-session";

/** A stand-in for the CM6 view behind `editor.cm`: real state, no DOM. */
class FakeView {
    state: EditorState;
    composing = false;
    dispatched: TransactionSpec[] = [];
    constructor(doc: string) {
        this.state = EditorState.create({ doc, extensions: [buildFieldSessionExtension()] });
    }
    dispatch(...specs: TransactionSpec[]): void {
        this.dispatched.push(...specs);
        this.state = this.state.update(...specs).state;
    }
    get session() {
        return this.state.field(fieldSessionField);
    }
}

function editorWith(text: string, ch: number, view?: FakeView): MockEditor {
    const mock = new MockEditor(text);
    mock.setCursor({ line: 0, ch });
    return view ? Object.assign(mock, { cm: view }) : mock;
}

const app = { workspace: { activeEditor: { file: { name: "note.md" } } } } as unknown as App;
const noPrefix = (): undefined => undefined;

describe("field-commands: startFieldSessionInEditor", () => {
    it("opens the session in the view behind the editor", () => {
        const view = new FakeView("[]()");
        const ok = startFieldSessionInEditor(asEditor(editorWith("[]()", 1, view)), { fields: [1, 3], final: 4 });
        expect(ok).toBe(true);
        expect(view.session?.stops).toHaveLength(2);
    });

    it("does nothing without stops or without a CM6 view (legacy editor)", () => {
        const view = new FakeView("[]()");
        expect(startFieldSessionInEditor(asEditor(editorWith("[]()", 1, view)), undefined)).toBe(false);
        expect(startFieldSessionInEditor(asEditor(editorWith("[]()", 1)), { fields: [1], final: 4 })).toBe(false);
        expect(view.dispatched).toHaveLength(0);
    });
});

describe("field-commands: jumpToNextField", () => {
    it("jumps while a session is open", () => {
        const view = new FakeView("a  b");
        startFieldSession(view, { fields: [1, 3], final: 4 });
        expect(jumpToNextField(asEditor(editorWith("a  b", 1, view)))).toBe(true);
        expect(view.state.selection.main.head).toBe(3);
    });

    it("does nothing without a session or without a view", () => {
        const view = new FakeView("a  b");
        expect(jumpToNextField(asEditor(editorWith("a  b", 1, view)))).toBe(false);
        expect(view.dispatched).toHaveLength(0);
        expect(jumpToNextField(asEditor(editorWith("a  b", 1)))).toBe(false);
    });
});

describe("field-commands: expandTriggerAtCursor (B-244)", () => {
    const dict = { brb: "be right back", lnk: "[$1]($2)" };

    it("expands the trigger at the caret", async () => {
        const mock = editorWith("say brb", 7);
        await expandTriggerAtCursor(app, asEditor(mock), () => dict, noPrefix);
        expect(mock.getLine(0)).toBe("say be right back");
    });

    it("starts the field session for a snippet with fields", async () => {
        const view = new FakeView("[]()");
        const mock = editorWith("lnk", 3, view);
        await expandTriggerAtCursor(app, asEditor(mock), () => dict, noPrefix);
        expect(mock.getLine(0)).toBe("[]()");
        expect(view.session?.stops).toEqual([{ from: 1, to: 1 }, { from: 3, to: 3 }]);
        expect(view.state.selection.main.head).toBe(1);
    });

    it("no trigger and a session open: jumps to the next field", async () => {
        const view = new FakeView("a  b");
        startFieldSession(view, { fields: [1, 3], final: 4 });
        const mock = editorWith("a  b", 1, view);
        await expandTriggerAtCursor(app, asEditor(mock), () => dict, noPrefix);
        expect(view.state.selection.main.head).toBe(3);
        expect(mock.getLine(0)).toBe("a  b");
    });

    it("a trigger wins over the jump even while a session is open", async () => {
        const view = new FakeView("x brb");
        startFieldSession(view, { fields: [0, 5], final: 5 });
        const mock = editorWith("x brb", 5, view);
        await expandTriggerAtCursor(app, asEditor(mock), () => dict, noPrefix);
        expect(mock.getLine(0)).toBe("x be right back");
        expect(view.session?.current).toBe(0);
    });

    it("neither a trigger nor a session: nothing happens", async () => {
        const view = new FakeView("plain");
        const mock = editorWith("plain", 5, view);
        await expandTriggerAtCursor(app, asEditor(mock), () => dict, noPrefix);
        expect(mock.getLine(0)).toBe("plain");
        expect(view.dispatched).toHaveLength(0);
    });

    it("passes the prefix and the note name through to the engine", async () => {
        const mock = editorWith("brb", 3);
        await expandTriggerAtCursor(app, asEditor(mock), () => dict, () => ":");
        expect(mock.getLine(0)).toBe("brb");
        const spy = vi.fn(() => ":");
        const prefixed = editorWith(":brb", 4);
        await expandTriggerAtCursor(app, asEditor(prefixed), () => ({ ...dict, fname: "$filename" }), spy);
        expect(prefixed.getLine(0)).toBe("be right back");
        expect(spy).toHaveBeenCalledTimes(1);
        const named = editorWith(":fname", 6);
        await expandTriggerAtCursor(app, asEditor(named), () => ({ fname: "$filename" }), spy);
        expect(named.getLine(0)).toBe("note.md");
    });
});

describe("field-commands: expandTriggerAtCursor with patterns (ADR-0008)", () => {
    const set = compilePatternRules([
        { id: "s", source: "/(\\d+)\\/(\\d+)$/", replacement: "{{1}}\u2044{{2}}", enabled: true, mode: "separator" },
        { id: "i", source: "/cat$/", replacement: "INSTANT", enabled: true, mode: "instant" },
    ]);

    it("expands a separator-mode pattern at the caret", async () => {
        const mock = editorWith("take 3/4", 8);
        await expandTriggerAtCursor(app, asEditor(mock), () => ({}), noPrefix, () => set);
        expect(mock.getLine(0)).toBe("take 3\u20444");
    });

    it("does not run instant-mode rules", async () => {
        const mock = editorWith("a cat", 5);
        await expandTriggerAtCursor(app, asEditor(mock), () => ({}), noPrefix, () => set);
        expect(mock.getLine(0)).toBe("a cat");
    });

    it("without patterns the command behaves as before", async () => {
        const mock = editorWith("take 3/4", 8);
        await expandTriggerAtCursor(app, asEditor(mock), () => ({}), noPrefix);
        await expandTriggerAtCursor(app, asEditor(mock), () => ({}), noPrefix, () => NO_PATTERNS);
        expect(mock.getLine(0)).toBe("take 3/4");
    });
});
