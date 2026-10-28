import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi } from "vitest";
import {
    EditorSelection,
    EditorState,
    StateEffect,
    Transaction,
    type TransactionSpec,
} from "@codemirror/state";
import { EditorView, keymap, type DecorationSet } from "@codemirror/view";
import {
    buildExpansionMarkExtension,
    clearExpansionEffect,
    expansionMarkField,
    markExpansion,
    markExpansionEffect,
    SNIPSY_UNDO_EVENT,
    undoExpansion,
    type MarkCommandView,
    type ExpansionMarkInfo,
} from "./expansion-mark";
import { isTypingUserEvent, shouldAttemptExpansion } from "./change-source-gate";

/**
 * B-176. Real `@codemirror/state` with no DOM: the field logic and the
 * Backspace command are driven through a tiny harness whose `dispatch`
 * applies `state.update(spec)`, exactly what `EditorView.dispatch` does
 * minus rendering.
 */

class Harness {
    state: EditorState;
    composing = false;
    enabled = true;
    transactions: Transaction[] = [];

    constructor(doc: string, anchor: number) {
        this.state = EditorState.create({
            doc,
            selection: { anchor },
            extensions: [EditorState.allowMultipleSelections.of(true), buildExpansionMarkExtension(() => this.enabled)],
        });
    }

    dispatch = (spec: TransactionSpec): void => {
        const tr = this.state.update(spec);
        this.transactions.push(tr);
        this.state = tr.state;
    };

    get text(): string {
        return this.state.doc.toString();
    }
    get head(): number {
        return this.state.selection.main.head;
    }
    get mark() {
        return this.state.field(expansionMarkField);
    }

    /**
     * What the plugin does for `brb ` -> `be right back `: the Obsidian
     * editor replaces the trigger (an untagged transaction; the caret,
     * which sits after the separator, is mapped through the change), then
     * the bridge reports where it landed.
     */
    expand(opts: {
        from: number;
        to: number;
        insert: string;
        separator: string;
        original: string;
        cursor?: number;
    }): void {
        this.dispatch({
            changes: { from: opts.from, to: opts.to, insert: opts.insert },
            ...(opts.cursor !== undefined ? { selection: { anchor: opts.cursor } } : {}),
        });
        markExpansion(this, {
            from: opts.from,
            insert: opts.insert,
            original: opts.original,
            separator: opts.separator,
        });
    }

    backspace(): boolean {
        return undoExpansion(this, () => this.enabled);
    }
}

function brb(): Harness {
    const h = new Harness("brb ", 4);
    h.expand({ from: 0, to: 3, insert: "be right back", separator: " ", original: "brb" });
    return h;
}

describe("expansion-mark: mark creation", () => {
    it("records the range, the caret and the text to restore", () => {
        const h = brb();
        expect(h.text).toBe("be right back ");
        expect(h.mark).toEqual({
            from: 0,
            to: 13,
            end: 14,
            cursor: 14,
            restore: "brb ",
            expected: "be right back ",
        });
    });

    it("draws exactly the inserted text, not the separator", () => {
        const h = brb();
        const sets = h.state.facet(EditorView.decorations).filter(
            (v): v is DecorationSet => typeof v !== "function",
        );
        const ranges: Array<{ from: number; to: number; cls: string }> = [];
        for (const set of sets) {
            const iter = set.iter();
            while (iter.value) {
                ranges.push({ from: iter.from, to: iter.to, cls: iter.value.spec.class });
                iter.next();
            }
        }
        expect(ranges).toEqual([{ from: 0, to: 13, cls: "snipsy-expanded" }]);
    });

    it("keeps the undo window for an empty replacement but draws nothing", () => {
        const h = new Harness("x ", 2);
        h.expand({ from: 0, to: 1, insert: "", separator: " ", original: "x" });
        expect(h.text).toBe(" ");
        expect(h.mark?.restore).toBe("x ");
        const sets = h.state.facet(EditorView.decorations).filter(
            (v): v is DecorationSet => typeof v !== "function",
        );
        expect(sets.every((s) => s.size === 0)).toBe(true);
        expect(h.backspace()).toBe(true);
        expect(h.text).toBe("x ");
    });

    it("does not mark when the user moved away before the edit landed", () => {
        const h = new Harness("brb  tail", 9);
        h.expand({ from: 0, to: 3, insert: "be right back", separator: " ", original: "brb" });
        // caret (end of doc) is outside [from, end]
        expect(h.mark).toBeNull();
    });

    it("does not mark when the document no longer holds the separator", () => {
        const h = new Harness("brb!", 4);
        h.expand({ from: 0, to: 3, insert: "be right back", separator: " ", original: "brb" });
        expect(h.mark).toBeNull();
    });

    it("does not mark a range that runs past the document", () => {
        const h = new Harness("ab", 2);
        markExpansion(h, { from: 0, insert: "x".repeat(40), original: "x", separator: " " });
        expect(h.mark).toBeNull();
    });

    it("does not mark while a range is selected", () => {
        const h = new Harness("brb ", 4);
        h.dispatch({ changes: { from: 0, to: 3, insert: "be right back" }, selection: { anchor: 0, head: 5 } });
        markExpansion(h, { from: 0, insert: "be right back", original: "brb", separator: " " });
        expect(h.mark).toBeNull();
    });
});

describe("expansion-mark: Backspace restores trigger + separator", () => {
    it("restores exactly what was typed, in one transaction, and clears the mark", () => {
        const h = brb();
        const before = h.transactions.length;
        expect(h.backspace()).toBe(true);
        expect(h.transactions.length - before).toBe(1);
        expect(h.text).toBe("brb ");
        expect(h.head).toBe(4);
        expect(h.mark).toBeNull();
    });

    it("the restore is not typing, so the B-149 gate does not re-expand it", () => {
        const h = brb();
        h.backspace();
        const tr = h.transactions[h.transactions.length - 1]!;
        const event = tr.annotation(Transaction.userEvent);
        expect(event).toBe(SNIPSY_UNDO_EVENT);
        expect(isTypingUserEvent(event)).toBe(false);
        expect(shouldAttemptExpansion([event], false)).toBe(false);
    });

    it("is not joined into CM6 history delete grouping (own history step)", () => {
        // `@codemirror/commands` joins /^(input\.type|delete)($|\.)/ events.
        expect(SNIPSY_UNDO_EVENT).not.toMatch(/^(input\.type|delete)($|\.)/);
    });

    it("a second Backspace is native (the window is single-use)", () => {
        const h = brb();
        h.backspace();
        expect(h.backspace()).toBe(false);
    });

    it("is native when no expansion happened", () => {
        const h = new Harness("plain text", 5);
        expect(h.backspace()).toBe(false);
        expect(h.transactions).toHaveLength(0);
    });

    it("is native while a range is selected", () => {
        const h = brb();
        h.dispatch({ selection: { anchor: 0, head: 14 } });
        expect(h.mark).toBeNull();
        expect(h.backspace()).toBe(false);
    });

    it("is native mid-composition and in a read-only editor", () => {
        const h = brb();
        h.composing = true;
        expect(h.backspace()).toBe(false);
        expect(h.mark).not.toBeNull();
        h.composing = false;
        h.state = h.state.update({ effects: StateEffect.appendConfig.of(EditorState.readOnly.of(true)) }).state;
        expect(h.backspace()).toBe(false);
        expect(h.text).toBe("be right back ");
    });

    it("is native when the setting is off, even with a live mark", () => {
        const h = brb();
        h.enabled = false;
        expect(h.backspace()).toBe(false);
        expect(h.text).toBe("be right back ");
    });

    it("Enter as the separator restores the line break", () => {
        const h = new Harness("brb\n", 4);
        h.expand({ from: 0, to: 3, insert: "be right back", separator: "\n", original: "brb" });
        expect(h.mark?.cursor).toBe(14);
        h.backspace();
        expect(h.text).toBe("brb\n");
        expect(h.head).toBe(4);
    });

    it("prefix mode: the consumed prefix char comes back too", () => {
        const h = new Harness("say :brb ", 9);
        h.expand({ from: 4, to: 8, insert: "be right back", separator: " ", original: ":brb" });
        h.backspace();
        expect(h.text).toBe("say :brb ");
        expect(h.head).toBe(9);
    });

    it("punctuation separator is restored as typed", () => {
        const h = new Harness("x brb, y", 6);
        h.expand({ from: 2, to: 5, insert: "be right back", separator: ",", original: "brb" });
        expect(h.mark).not.toBeNull();
        h.backspace();
        expect(h.text).toBe("x brb, y");
        expect(h.head).toBe(6);
    });

    it("multi-line replacement is restored as a whole", () => {
        const h = new Harness("callout ", 8);
        h.expand({ from: 0, to: 7, insert: "> [!note]\n> body\n> end", separator: " ", original: "callout" });
        expect(h.mark?.to).toBe(22);
        h.backspace();
        expect(h.text).toBe("callout ");
        expect(h.head).toBe(8);
    });

    it("$| caret inside the range: the window is open at the caret, Backspace restores and lands after the separator", () => {
        // `cb ` -> "```\n\n```" with the caret between the fences (offset 4)
        const h = new Harness("cb ", 3);
        h.expand({ from: 0, to: 2, insert: "```\n\n```", separator: " ", original: "cb", cursor: 4 });
        expect(h.mark?.cursor).toBe(4);
        h.backspace();
        expect(h.text).toBe("cb ");
        expect(h.head).toBe(3);
    });

    it("$| caret inside the range: moving the caret closes the window", () => {
        const h = new Harness("cb ", 3);
        h.expand({ from: 0, to: 2, insert: "```\n\n```", separator: " ", original: "cb", cursor: 4 });
        h.dispatch({ selection: { anchor: 3 } });
        expect(h.mark).toBeNull();
        expect(h.backspace()).toBe(false);
    });
});

describe("expansion-mark: mapping through other edits (Substitutions #22 class)", () => {
    it("text inserted ABOVE shifts the mark and Backspace still restores the right text", () => {
        const h = new Harness("line one\nbrb ", 13);
        h.expand({ from: 9, to: 12, insert: "be right back", separator: " ", original: "brb" });
        h.dispatch({ changes: { from: 0, insert: "NEW HEADER\n\n" } }); // sync / other plugin
        expect(h.mark).toMatchObject({ from: 21, to: 34, end: 35 });
        expect(h.mark?.cursor).toBe(h.head);
        h.backspace();
        expect(h.text).toBe("NEW HEADER\n\nline one\nbrb ");
        expect(h.head).toBe(h.text.length);
    });

    it("text inserted exactly at the start of the range shifts it right", () => {
        const h = brb();
        h.dispatch({ changes: { from: 0, insert: ">> " } });
        expect(h.mark).toMatchObject({ from: 3, to: 16, end: 17 });
        h.backspace();
        expect(h.text).toBe(">> brb ");
    });

    it("text inserted BELOW leaves the mark alone", () => {
        const h = brb();
        h.dispatch({ changes: { from: h.text.length, insert: "\nfooter" } });
        expect(h.mark).toMatchObject({ from: 0, to: 13, end: 14 });
        h.dispatch({ selection: { anchor: 14 } }); // caret unchanged: still live
        expect(h.backspace()).toBe(true);
        expect(h.text).toBe("brb \nfooter");
    });

    it("text deleted above shifts the mark left", () => {
        const h = new Harness("abc\nbrb ", 8);
        h.expand({ from: 4, to: 7, insert: "be right back", separator: " ", original: "brb" });
        h.dispatch({ changes: { from: 0, to: 4 } });
        expect(h.mark).toMatchObject({ from: 0, to: 13, end: 14 });
        h.backspace();
        expect(h.text).toBe("brb ");
    });

    it("an edit overlapping the range clears the mark", () => {
        const h = brb();
        h.dispatch({ changes: { from: 3, to: 5, insert: "XX" } });
        expect(h.mark).toBeNull();
    });

    it("an insertion between the inserted text and the separator clears the mark", () => {
        const h = brb();
        h.dispatch({ changes: { from: 13, insert: "!" } });
        expect(h.mark).toBeNull();
    });

    it("returns the same object for a transaction that changes nothing relevant", () => {
        const h = brb();
        const before = h.mark;
        h.dispatch({ effects: StateEffect.define<number>().of(1) });
        expect(h.mark).toBe(before);
    });
});

describe("expansion-mark: when the window closes", () => {
    it("on a caret move", () => {
        const h = brb();
        h.dispatch({ selection: { anchor: 5 } });
        expect(h.mark).toBeNull();
        expect(h.backspace()).toBe(false);
    });

    it("on a caret move away and back (no resurrection)", () => {
        const h = brb();
        h.dispatch({ selection: { anchor: 5 } });
        h.dispatch({ selection: { anchor: 14 } });
        expect(h.backspace()).toBe(false);
    });

    it("on the next typed character", () => {
        const h = brb();
        h.dispatch({ changes: { from: 14, insert: "t" }, selection: { anchor: 15 }, userEvent: "input.type" });
        expect(h.mark).toBeNull();
        expect(h.backspace()).toBe(false);
    });

    it("on user typing elsewhere, even with the caret untouched", () => {
        const h = brb();
        h.dispatch({ changes: { from: 0, insert: "x" }, userEvent: "input.type" });
        expect(h.mark).toBeNull();
    });

    it("on a native delete, undo, redo or drag", () => {
        for (const ev of ["delete.backward", "undo", "redo", "move.drop"]) {
            const h = brb();
            h.dispatch({ changes: { from: 0, insert: "x" }, userEvent: ev });
            expect(h.mark, ev).toBeNull();
        }
    });

    it("on an explicit clear effect", () => {
        const h = brb();
        h.dispatch({ effects: clearExpansionEffect.of(null) });
        expect(h.mark).toBeNull();
    });

    it("another expansion replaces the mark", () => {
        const h = brb();
        h.dispatch({ changes: { from: 14, insert: "omw " }, selection: { anchor: 18 }, userEvent: "input.type" });
        h.expand({ from: 14, to: 17, insert: "on my way", separator: " ", original: "omw" });
        expect(h.text).toBe("be right back on my way ");
        expect(h.mark).toMatchObject({ from: 14, to: 23, restore: "omw " });
        h.backspace();
        expect(h.text).toBe("be right back omw ");
    });

    it("a rejected second mark also drops the first (stale window)", () => {
        const h = brb();
        markExpansion(h, { from: 0, insert: "b", original: "q", separator: "Z" });
        expect(h.mark).toBeNull();
    });
});

describe("expansion-mark: multiple cursors (B-176 round 2)", () => {
    it("never creates a mark while there are several carets", () => {
        const h = new Harness("brb  x", 4);
        h.dispatch({
            changes: { from: 0, to: 3, insert: "be right back" },
            selection: EditorSelection.create([
                EditorSelection.cursor(14),
                EditorSelection.cursor(16),
            ]),
        });
        markExpansion(h, { from: 0, insert: "be right back", original: "brb", separator: " " });
        expect(h.mark).toBeNull();
    });

    it("adding a second caret closes the window and Backspace stays native", () => {
        const h = brb();
        h.dispatch({
            selection: EditorSelection.create([
                EditorSelection.cursor(14),
                EditorSelection.cursor(5),
            ]),
        });
        expect(h.mark).toBeNull();
        expect(h.backspace()).toBe(false);
    });

    it("the command itself refuses with several carets even if a mark exists", () => {
        const h = brb();
        const mark = h.mark!;
        const multi = h.state.update({
            selection: EditorSelection.create([
                EditorSelection.cursor(14),
                EditorSelection.cursor(2),
            ]),
        }).state;
        // The field would already have dropped the mark, so a live mark with
        // several carets is unreachable; hand the command one directly to pin
        // its own guard.
        const view = {
            state: { field: () => mark, selection: multi.selection, doc: multi.doc, readOnly: false },
            composing: false,
            dispatch: vi.fn(),
        };
        expect(undoExpansion(view as unknown as MarkCommandView, () => true)).toBe(false);
        expect(view.dispatch).not.toHaveBeenCalled();
    });
});

describe("expansion-mark: inserted text is verified (B-176 round 2)", () => {
    it("does not mark when the doc holds different text than reported", () => {
        const h = new Harness("brb ", 4);
        h.dispatch({ changes: { from: 0, to: 3, insert: "be right back" } });
        markExpansion(h, { from: 0, insert: "be right bacX", original: "brb", separator: " " });
        expect(h.mark).toBeNull();
    });

    it("a reported insert one char short does not mark even if the next char equals the separator", () => {
        // doc "a  b": insert "a" + sep " " is a prefix match only by luck
        const h = new Harness("ab  ", 4);
        h.dispatch({ selection: { anchor: 3 } });
        markExpansion(h, { from: 0, insert: "a", original: "q", separator: " " });
        expect(h.mark).toBeNull();
    });

    it("an insert one char too long does not mark", () => {
        const h = new Harness("brb ", 4);
        h.dispatch({ changes: { from: 0, to: 3, insert: "ok" } });
        markExpansion(h, { from: 0, insert: "ok ", original: "brb", separator: " " });
        expect(h.mark).toBeNull();
    });

    it("CRLF in a replacement is normalised like CM6: the mark is correct", () => {
        const h = new Harness("c ", 2);
        h.expand({ from: 0, to: 1, insert: "a\r\nb", separator: " ", original: "c" });
        expect(h.text).toBe("a\nb ");
        expect(h.mark).toMatchObject({ from: 0, to: 3, end: 4, expected: "a\nb " });
        h.backspace();
        expect(h.text).toBe("c ");
    });

    it("Backspace returns false when the text under the mark no longer matches", () => {
        const h = brb();
        // Unreachable by construction (the field clears the mark on any
        // overlapping edit); this only pins the defensive guard.
        const stale = h.state.update({
            effects: markExpansionEffect.of({ from: 0, insert: "be right back", original: "brb", separator: " " }),
        }).state;
        expect(stale.field(expansionMarkField)).not.toBeNull();
        const field = stale.field(expansionMarkField)!;
        const lying = { ...h, state: stale, dispatch: vi.fn() };
        Object.defineProperty(field, "expected", { value: "something else ", writable: true });
        expect(undoExpansion(lying, () => true)).toBe(false);
        expect(lying.dispatch).not.toHaveBeenCalled();
    });
});

describe("expansion-mark: extension wiring", () => {
    it("binds Backspace and Shift-Backspace, delegating to the command", () => {
        const h = brb();
        const bindings = h.state.facet(keymap).flat();
        const keys = bindings.map((b) => b.key);
        expect(keys).toEqual(expect.arrayContaining(["Backspace", "Shift-Backspace"]));
        const run = bindings.find((b) => b.key === "Backspace")!.run!;
        expect(run(h as unknown as EditorView)).toBe(true);
        expect(h.text).toBe("brb ");
        expect(run(h as unknown as EditorView)).toBe(false);
    });

    it("the markExpansion helper dispatches exactly one effect-only transaction", () => {
        const dispatch = vi.fn();
        const info: ExpansionMarkInfo = { from: 0, insert: "b", original: "a", separator: " " };
        markExpansion({ dispatch }, info);
        expect(dispatch).toHaveBeenCalledTimes(1);
        const spec = dispatch.mock.calls[0]![0] as TransactionSpec;
        expect(spec.changes).toBeUndefined();
        const effect = spec.effects as StateEffect<ExpansionMarkInfo>;
        expect(effect.is(markExpansionEffect)).toBe(true);
        expect(effect.value).toEqual(info);
    });

    it("the mark class has theme-variable styling and a reduced-motion opt-out (B-089)", () => {
        const css = readFileSync(resolve(__dirname, "../styles/main.css"), "utf8");
        expect(css).toMatch(/\.snipsy-expanded\s*\{[^}]*var\(--interactive-accent\)/);
        expect(css).toMatch(/--text-highlight-bg/);
        expect(css).toMatch(
            /prefers-reduced-motion:\s*reduce\)\s*\{[^@]*\.snipsy-expanded\s*\{\s*animation:\s*none/,
        );
    });
});
