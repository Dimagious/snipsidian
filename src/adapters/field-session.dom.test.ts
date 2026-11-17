import { afterEach, describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
    buildFieldSessionExtension,
    hasFieldSession,
    nextField,
    startFieldSession,
} from "./field-session";

/**
 * B-243, real `EditorView` under jsdom: the decorations are actually rendered,
 * so a widget that cannot be built (the HierarchyRequestError of
 * `document.createSpan`) fails here instead of in the user's note.
 */
const views: EditorView[] = [];

function mount(doc: string): EditorView {
    const view = new EditorView({
        state: EditorState.create({ doc, extensions: [buildFieldSessionExtension()] }),
        parent: document.body,
    });
    views.push(view);
    return view;
}

afterEach(() => {
    for (const view of views.splice(0)) view.destroy();
});

describe("field-session in a real EditorView", () => {
    it("renders a widget for every empty field, the current one marked, without throwing", () => {
        const view = mount("[]()");
        expect(startFieldSession(view, { fields: [1, 3], final: 4 })).toBe(true);
        const empty = view.dom.querySelectorAll(".snipsy-field-empty");
        expect(empty).toHaveLength(2);
        expect(view.dom.querySelectorAll(".snipsy-field-empty.snipsy-field-current")).toHaveLength(1);
        expect(empty[0]?.getAttribute("aria-hidden")).toBe("true");
        expect(view.state.doc.toString()).toBe("[]()");
    });

    it("moving on re-renders: the widgets follow the current field, and vanish with the session", () => {
        const view = mount("[]()");
        startFieldSession(view, { fields: [1, 3], final: 4 });
        nextField(view);
        const current = view.dom.querySelectorAll(".snipsy-field-empty.snipsy-field-current");
        expect(current).toHaveLength(1);
        nextField(view);
        expect(hasFieldSession(view.state)).toBe(false);
        expect(view.dom.querySelectorAll(".snipsy-field-empty")).toHaveLength(0);
    });

    it("a filled field is marked, not replaced by a widget", () => {
        const view = mount("[]()");
        startFieldSession(view, { fields: [1, 3], final: 4 });
        view.dispatch({
            changes: { from: 1, insert: "text" },
            selection: { anchor: 5 },
            userEvent: "input.type",
        });
        expect(view.dom.querySelectorAll(".snipsy-field.snipsy-field-current")).toHaveLength(1);
        expect(view.dom.querySelectorAll(".snipsy-field-empty")).toHaveLength(1);
    });

    it("blur keeps the session (the Command Palette blurs the editor), and after refocus Tab still jumps", () => {
        const view = mount("[]()");
        startFieldSession(view, { fields: [1, 3], final: 4 });
        view.contentDOM.dispatchEvent(new FocusEvent("blur"));
        expect(hasFieldSession(view.state)).toBe(true);
        expect(view.dom.querySelectorAll(".snipsy-field-empty")).toHaveLength(2);
        view.contentDOM.dispatchEvent(new FocusEvent("focus"));
        expect(nextField(view)).toBe(true);
        expect(view.state.selection.main.head).toBe(3);
    });
});
