import { describe, it, expect, vi } from "vitest";
import {
    EditorSelection,
    EditorState,
    Transaction,
    type TransactionSpec,
} from "@codemirror/state";
import { keymap, type EditorView } from "@codemirror/view";
import {
    buildFieldSessionExtension,
    endFieldSessionEffect,
    escapeFieldSession,
    fieldDecorations,
    fieldSessionField,
    hasFieldSession,
    nextField,
    previousField,
    startFieldSession,
    type FieldCommandView,
} from "./field-session";
import type { FieldStops } from "../engine/types";

/**
 * B-243. Real `@codemirror/state`, no DOM: a tiny harness applies
 * `state.update(spec)` like `EditorView.dispatch` does minus rendering.
 */
function isReadyTransaction(
    arg: Transaction | readonly Transaction[] | TransactionSpec,
): arg is Transaction | readonly Transaction[] {
    return arg instanceof Transaction || Array.isArray(arg);
}

class Harness implements FieldCommandView {
    state: EditorState;
    composing = false;
    dispatched: TransactionSpec[] = [];

    constructor(doc: string, anchor = 0, extra: readonly import("@codemirror/state").Extension[] = []) {
        this.state = EditorState.create({
            doc,
            selection: { anchor },
            extensions: [EditorState.allowMultipleSelections.of(true), buildFieldSessionExtension(), ...extra],
        });
    }

    dispatch(tr: Transaction): void;
    dispatch(trs: readonly Transaction[]): void;
    dispatch(...specs: TransactionSpec[]): void;
    dispatch(...args: Array<Transaction | readonly Transaction[] | TransactionSpec>): void {
        const specs: TransactionSpec[] = [];
        for (const arg of args) {
            if (isReadyTransaction(arg)) throw new Error("Harness.dispatch takes specs only");
            specs.push(arg);
        }
        this.dispatched.push(...specs);
        this.state = this.state.update(...specs).state;
    }

    get text(): string {
        return this.state.doc.toString();
    }
    get sel(): { anchor: number; head: number } {
        const { anchor, head } = this.state.selection.main;
        return { anchor, head };
    }
    get session() {
        return this.state.field(fieldSessionField);
    }
    /** Typing as the browser does it: a tagged user transaction. */
    type(at: number, text: string): void {
        this.dispatch({
            changes: { from: at, insert: text },
            selection: { anchor: at + text.length },
            userEvent: "input.type",
        });
    }
}

/** `[](url)`-style fixture: text with empty fields at the given offsets. */
function open(doc: string, fields: number[], final = doc.length): Harness {
    const h = new Harness(doc, doc.length);
    expect(startFieldSession(h, { fields, final })).toBe(true);
    return h;
}

describe("field-session: start", () => {
    it("puts the caret in the first field and records fields in visit order", () => {
        const h = open("[](url)", [1, 6]);
        expect(h.sel).toEqual({ anchor: 1, head: 1 });
        expect(h.session).toEqual({
            stops: [{ from: 1, to: 1 }, { from: 6, to: 6 }],
            current: 0,
            final: 7,
        });
    });

    it("refuses an offset outside the document (the note changed meanwhile)", () => {
        const h = new Harness("abc", 0);
        expect(startFieldSession(h, { fields: [1, 9], final: 3 })).toBe(false);
        expect(startFieldSession(h, { fields: [1, 2], final: 4 })).toBe(false);
        expect(startFieldSession(h, { fields: [-1, 2], final: 3 })).toBe(false);
        expect(h.dispatched).toHaveLength(0);
        expect(hasFieldSession(h.state)).toBe(false);
    });

    it("refuses an empty field list and a view without the extension", () => {
        const h = new Harness("abc", 0);
        expect(startFieldSession(h, { fields: [], final: 0 })).toBe(false);
        const bare: FieldCommandView & { state: EditorState } = {
            state: EditorState.create({ doc: "abc" }),
            composing: false,
            dispatch: vi.fn(),
        };
        const stops: FieldStops = { fields: [1], final: 3 };
        expect(startFieldSession(bare, stops)).toBe(false);
        expect(bare.dispatch).not.toHaveBeenCalled();
    });

    it("a new expansion replaces the open session", () => {
        const h = open("a b", [0, 2]);
        expect(startFieldSession(h, { fields: [3, 3], final: 3 })).toBe(true);
        expect(h.session?.stops).toEqual([{ from: 3, to: 3 }, { from: 3, to: 3 }]);
        expect(h.session?.current).toBe(0);
    });
});

describe("field-session: Tab / Shift+Tab", () => {
    it("Tab walks the fields, then lands on the final stop and ends the session", () => {
        const h = open("a  b  c", [1, 4], 7);
        expect(nextField(h)).toBe(true);
        expect(h.sel).toEqual({ anchor: 4, head: 4 });
        expect(h.session?.current).toBe(1);
        expect(nextField(h)).toBe(true);
        expect(h.sel).toEqual({ anchor: 7, head: 7 });
        expect(hasFieldSession(h.state)).toBe(false);
        // The session is over: Tab is no longer ours.
        expect(nextField(h)).toBe(false);
    });

    it("Shift+Tab goes back and stays on the first field", () => {
        const h = open("a  b  c", [1, 4, 6], 7);
        nextField(h);
        nextField(h);
        expect(h.session?.current).toBe(2);
        expect(previousField(h)).toBe(true);
        expect(h.sel.head).toBe(4);
        expect(previousField(h)).toBe(true);
        expect(previousField(h)).toBe(true);
        expect(h.sel.head).toBe(1);
        expect(h.session?.current).toBe(0);
        expect(hasFieldSession(h.state)).toBe(true);
    });

    it("revisiting a filled field selects its text", () => {
        const h = open("[](x)", [1, 3]);
        h.type(1, "name");
        nextField(h);
        previousField(h);
        expect(h.sel).toEqual({ anchor: 1, head: 5 });
        expect(hasFieldSession(h.state)).toBe(true);
    });

    it("adjacent fields at one position are walked one by one (no sticking)", () => {
        const h = open("[]", [1, 1]);
        expect(nextField(h)).toBe(true);
        expect(h.session?.current).toBe(1);
        // Typing now goes to the SECOND field and must not swallow the first.
        h.type(1, "z");
        expect(h.session?.stops).toEqual([{ from: 1, to: 1 }, { from: 1, to: 2 }]);
        expect(nextField(h)).toBe(true);
        expect(hasFieldSession(h.state)).toBe(false);
    });

    it("typing in the first of two adjacent fields leaves the second after the text", () => {
        const h = open("[]", [1, 1]);
        h.type(1, "ab");
        expect(h.session?.stops).toEqual([{ from: 1, to: 3 }, { from: 3, to: 3 }]);
        nextField(h);
        expect(h.sel.head).toBe(3);
    });
});

describe("field-session: keys are ours only while a session is open", () => {
    it("every command returns false and dispatches nothing without a session", () => {
        const h = new Harness("- item", 6);
        expect(nextField(h)).toBe(false);
        expect(previousField(h)).toBe(false);
        expect(escapeFieldSession(h)).toBe(false);
        expect(h.dispatched).toHaveLength(0);
        expect(h.text).toBe("- item");
    });

    it("composition and a read-only editor keep the key native", () => {
        const h = open("a  b", [1, 3]);
        h.composing = true;
        expect(nextField(h)).toBe(false);
        expect(previousField(h)).toBe(false);
        h.composing = false;
        const ro = new Harness("a  b", 4, [EditorState.readOnly.of(true)]);
        startFieldSession(ro, { fields: [1, 3], final: 4 });
        expect(nextField(ro)).toBe(false);
        expect(ro.session?.current).toBe(0);
    });

    it("Escape ends the session but still returns false (the key is not consumed)", () => {
        const h = open("a  b", [1, 3]);
        expect(escapeFieldSession(h)).toBe(false);
        expect(hasFieldSession(h.state)).toBe(false);
        expect(h.text).toBe("a  b");
    });

    it("the extension binds Tab, Shift-Tab and Escape", () => {
        const h = new Harness("x");
        const keys = h.state.facet(keymap).flat().map((b) => b.key);
        expect(keys).toEqual(expect.arrayContaining(["Tab", "Shift-Tab", "Escape"]));
    });
});

describe("field-session: Tab outside a session (B-255)", () => {
    function tabRun(fallback?: (view: EditorView) => boolean): ((view: Harness) => boolean) | undefined {
        const state = EditorState.create({ doc: "x", extensions: [buildFieldSessionExtension(fallback)] });
        const binding = state.facet(keymap).flat().find((b) => b.key === "Tab");
        const run = binding?.run;
        return run ? (h) => run(h as never) : undefined;
    }

    it("a session keeps Tab: next field wins, the fallback is not consulted", () => {
        const fallback = vi.fn(() => true);
        const run = tabRun(fallback);
        const h = open("a  b", [1, 3]);
        expect(run?.(h)).toBe(true);
        expect(h.state.selection.main.head).toBe(3);
        expect(fallback).not.toHaveBeenCalled();
    });

    it("without a session the fallback decides: taken -> true, declined -> false", () => {
        const h = new Harness("brb");
        expect(tabRun(() => true)?.(h)).toBe(true);
        expect(tabRun(() => false)?.(h)).toBe(false);
    });

    it("without a fallback Tab is not taken (unchanged behavior)", () => {
        expect(tabRun()?.(new Harness("brb"))).toBe(false);
    });
});

describe("field-session: staying in sync with the document", () => {
    it("typing inside a field grows it, the next field shifts", () => {
        const h = open("[](x)", [1, 3]);
        h.type(1, "text");
        expect(h.text).toBe("[text](x)");
        expect(h.session?.stops).toEqual([{ from: 1, to: 5 }, { from: 7, to: 7 }]);
        nextField(h);
        h.type(7, "u");
        expect(h.session?.stops).toEqual([{ from: 1, to: 5 }, { from: 7, to: 8 }]);
        expect(h.session?.final).toBe(h.text.length);
    });

    it("`$2$1`: typing into $1 (second in the document) pushes $2 the right way", () => {
        // visit order: $1 first (offset 1), then $2 (offset 1); document order is $2, $1
        const h = new Harness("[]", 2);
        expect(startFieldSession(h, { fields: [1, 1], docOrder: [1, 0], final: 2 })).toBe(true);
        h.type(1, "ab");
        // $2 is BEFORE $1 in the document: it stays at 1, $1 holds the text
        expect(h.session?.stops).toEqual([{ from: 1, to: 3 }, { from: 1, to: 1 }]);
        expect(nextField(h)).toBe(true);
        expect(h.sel.head).toBe(1);
        h.type(1, "z");
        expect(h.text).toBe("[zab]");
        expect(h.session?.stops).toEqual([{ from: 2, to: 4 }, { from: 1, to: 2 }]);
    });

    it("a change fully inside the current field is input whatever its user event (auto-paired brackets)", () => {
        const h = open("[](x)", [1, 3]);
        h.dispatch({ changes: { from: 1, insert: "()" }, selection: { anchor: 2 } });
        expect(h.text).toBe("[()](x)");
        expect(hasFieldSession(h.state)).toBe(true);
        expect(h.session?.stops).toEqual([{ from: 1, to: 3 }, { from: 5, to: 5 }]);
        h.dispatch({ changes: { from: 2, insert: "a" }, selection: { anchor: 3 }, userEvent: "input.complete" });
        expect(hasFieldSession(h.state)).toBe(true);
    });

    it("an untagged change that spills out of the current field still ends the session", () => {
        const h = open("[](x)", [1, 3]);
        h.dispatch({ changes: { from: 1, to: 4, insert: "q" } });
        expect(hasFieldSession(h.state)).toBe(false);
    });

    it("deleting inside a field shrinks it and keeps the session", () => {
        const h = open("[](x)", [1, 3]);
        h.type(1, "ab");
        h.dispatch({ changes: { from: 2, to: 3 }, selection: { anchor: 2 }, userEvent: "delete.backward" });
        expect(h.session?.stops[0]).toEqual({ from: 1, to: 2 });
    });

    it("a change BEFORE the fields moves every range and the final stop", () => {
        const h = open("[](x)", [1, 3], 5);
        h.dispatch({ changes: { from: 0, insert: "ZZ" } }); // sync / another plugin
        expect(h.session?.stops).toEqual([{ from: 3, to: 3 }, { from: 5, to: 5 }]);
        expect(h.session?.final).toBe(7);
        expect(h.sel.head).toBe(3);
    });

    it("an unrelated change AFTER the fields leaves them alone", () => {
        const h = open("[](x)", [1, 3], 5);
        h.dispatch({ changes: { from: 5, insert: "!!" } });
        // the change touches the final stop only, not a field
        expect(h.session?.stops).toEqual([{ from: 1, to: 1 }, { from: 3, to: 3 }]);
    });

    it("a non-typing change that touches a field ends the session (another expansion)", () => {
        const h = open("[](x)", [1, 3]);
        h.dispatch({ changes: { from: 0, to: 2, insert: "<>" } });
        expect(hasFieldSession(h.state)).toBe(false);
    });

    it("the whole document being replaced ends the session", () => {
        const h = open("[](x)", [1, 3]);
        h.dispatch({ changes: { from: 0, to: h.state.doc.length, insert: "fresh note" } });
        expect(hasFieldSession(h.state)).toBe(false);
        expect(h.text).toBe("fresh note");
    });

    it("undo and redo end the session without throwing", () => {
        const h = open("[](x)", [1, 3]);
        h.type(1, "a");
        h.dispatch({ changes: { from: 1, to: 2 }, userEvent: "undo" });
        expect(hasFieldSession(h.state)).toBe(false);
        const g = open("[](x)", [1, 3]);
        g.dispatch({ changes: { from: 1, insert: "a" }, userEvent: "redo" });
        expect(hasFieldSession(g.state)).toBe(false);
    });
});

describe("field-session: selection", () => {
    it("moving the caret outside every field ends the session", () => {
        const h = open("[](x) tail", [1, 3]);
        h.dispatch({ selection: { anchor: 9 } });
        expect(hasFieldSession(h.state)).toBe(false);
    });

    it("clicking into another field makes it the current one", () => {
        const h = open("[](x)", [1, 3]);
        h.dispatch({ selection: { anchor: 3 } });
        expect(h.session?.current).toBe(1);
        expect(nextField(h)).toBe(true);
        expect(hasFieldSession(h.state)).toBe(false);
    });

    it("a caret move inside the current field keeps the very same session object", () => {
        const h = open("[](x)", [1, 3]);
        h.type(1, "abc");
        const before = h.session;
        h.dispatch({ selection: { anchor: 2 } });
        expect(h.session).toBe(before);
    });

    it("a selection reaching past the field ends it; one inside the field keeps it", () => {
        const h = open("[](x)", [1, 3]);
        h.type(1, "abc");
        h.dispatch({ selection: { anchor: 1, head: 3 } });
        expect(hasFieldSession(h.state)).toBe(true);
        h.dispatch({ selection: { anchor: 1, head: 6 } });
        expect(hasFieldSession(h.state)).toBe(false);
    });

    it("multiple cursors end the session", () => {
        const h = open("[](x) y", [1, 3]);
        h.dispatch({ selection: EditorSelection.create([EditorSelection.cursor(1), EditorSelection.cursor(7)]) });
        expect(hasFieldSession(h.state)).toBe(false);
    });

    it("an explicit end effect drops the session", () => {
        const h = open("[](x)", [1, 3]);
        h.dispatch({ effects: endFieldSessionEffect.of(null) });
        expect(hasFieldSession(h.state)).toBe(false);
    });

    it("a transaction without changes or selection returns the same session", () => {
        const h = open("[](x)", [1, 3]);
        const before = h.session;
        h.dispatch({ scrollIntoView: true });
        expect(h.session).toBe(before);
    });
});

describe("field-session: decorations", () => {
    function collect(session: Parameters<typeof fieldDecorations>[0]): Array<{ from: number; to: number; cls: string }> {
        const out: Array<{ from: number; to: number; cls: string }> = [];
        const spec = (v: unknown): string =>
            typeof v === "object" && v !== null && "class" in v ? String(v.class) : "widget";
        fieldDecorations(session).between(0, 1000, (from, to, deco) => {
            out.push({ from, to, cls: spec(deco.spec) });
        });
        return out;
    }

    it("none without a session", () => {
        expect(collect(null)).toEqual([]);
    });

    it("a filled field is a mark (current one stronger), an empty one a widget, in document order", () => {
        const decos = collect({
            stops: [{ from: 8, to: 8 }, { from: 1, to: 4 }],
            current: 1,
            final: 9,
        });
        expect(decos).toEqual([
            { from: 1, to: 4, cls: "snipsy-field snipsy-field-current" },
            { from: 8, to: 8, cls: "widget" },
        ]);
    });

    it("a non-current filled field has the base class only", () => {
        const decos = collect({ stops: [{ from: 0, to: 2 }, { from: 5, to: 6 }], current: 0, final: 6 });
        expect(decos.map((d) => d.cls)).toEqual(["snipsy-field snipsy-field-current", "snipsy-field"]);
    });

    it("empty-field widgets compare by the current/other state", () => {
        const widgets: Array<{ eq(o: unknown): boolean }> = [];
        fieldDecorations({ stops: [{ from: 1, to: 1 }, { from: 2, to: 2 }], current: 0, final: 2 }).between(
            0,
            10,
            (_f, _t, deco) => {
                const spec: unknown = deco.spec;
                if (typeof spec === "object" && spec !== null && "widget" in spec) {
                    widgets.push(spec.widget as { eq(o: unknown): boolean });
                }
            },
        );
        const [first, second] = widgets;
        expect(first?.eq(second)).toBe(false);
        expect(first?.eq(first)).toBe(true);
    });
});
