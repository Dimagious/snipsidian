import { describe, it, expect } from "vitest";
import {
    isDeferredByComposition,
    isSingleCharTyping,
    type ChangeInfo,
    isTypingUserEvent,
    listContinuationTail,
    shouldAttemptExpansion,
    shouldRunDeferredExpansion,
} from "./change-source-gate";

/**
 * Boundary tests for the B-149 change-source gate. Per ADR-0005: the
 * question each case answers is "would this test fail if the
 * contract broke?" — not "is this line executed?".
 */

describe("isTypingUserEvent", () => {
    it("accepts \"input.type\" — real character typing", () => {
        expect(isTypingUserEvent("input.type")).toBe(true);
    });

    it("accepts bare \"input\" — Enter/newline insertion via the default keymap", () => {
        // @codemirror/commands' insertNewline/insertNewlineAndIndent
        // dispatch with userEvent "input", not "input.type". Losing
        // this case would silently kill B-148/B-109 Enter-separator
        // expansion.
        expect(isTypingUserEvent("input")).toBe(true);
    });

    it("accepts \"input.type.compose\" — a completed IME composition commit", () => {
        // The `composing` flag (checked separately) is what blocks
        // mid-composition dispatch; once composition has ended, the
        // committed text is genuine typing and should be eligible.
        expect(isTypingUserEvent("input.type.compose")).toBe(true);
    });

    it("rejects \"input.complete\" — allowlist follow-up: an unknown input.* sub-event (autocomplete/completion accept) must fail closed, not be silently let through", () => {
        expect(isTypingUserEvent("input.complete")).toBe(false);
    });

    it("rejects \"input.paste\"", () => {
        expect(isTypingUserEvent("input.paste")).toBe(false);
    });

    it("rejects a hypothetical sub-event of paste (\"input.paste.foo\")", () => {
        expect(isTypingUserEvent("input.paste.foo")).toBe(false);
    });

    it("rejects \"input.drop\"", () => {
        expect(isTypingUserEvent("input.drop")).toBe(false);
    });

    it("rejects \"undo\"", () => {
        expect(isTypingUserEvent("undo")).toBe(false);
    });

    it("rejects \"redo\"", () => {
        expect(isTypingUserEvent("redo")).toBe(false);
    });

    it("rejects delete events (\"delete.backward\", \"delete.forward\", \"delete.cut\")", () => {
        expect(isTypingUserEvent("delete.backward")).toBe(false);
        expect(isTypingUserEvent("delete.forward")).toBe(false);
        expect(isTypingUserEvent("delete.cut")).toBe(false);
    });

    it("rejects \"move.drop\" (drag-move, distinct from drag-copy's input.drop)", () => {
        expect(isTypingUserEvent("move.drop")).toBe(false);
    });

    it("rejects an untagged programmatic edit (undefined userEvent)", () => {
        // This is exactly the old bug shape: Snipsy's own
        // `editor.replaceRange` call (and any other plugin's
        // programmatic edit) dispatches without a userEvent
        // annotation. Must never be treated as typing.
        expect(isTypingUserEvent(undefined)).toBe(false);
    });

    it("rejects an empty string", () => {
        expect(isTypingUserEvent("")).toBe(false);
    });

    it("rejects an unrelated custom annotation", () => {
        expect(isTypingUserEvent("some-other-plugins-tag")).toBe(false);
    });
});

describe("shouldAttemptExpansion", () => {
    it("fires when the only transaction is a typing event", () => {
        expect(shouldAttemptExpansion(["input.type"], false)).toBe(true);
    });

    it("fires when at least one of several transactions is typing", () => {
        expect(shouldAttemptExpansion(["select", "input.type"], false)).toBe(true);
    });

    it("does not fire when no transaction is a typing event", () => {
        expect(shouldAttemptExpansion(["select.pointer"], false)).toBe(false);
    });

    it("does not fire on an empty transaction list", () => {
        expect(shouldAttemptExpansion([], false)).toBe(false);
    });

    it("does not fire for undo, even though the resulting document looks like fresh typing", () => {
        expect(shouldAttemptExpansion(["undo"], false)).toBe(false);
    });

    it("does not fire for redo", () => {
        expect(shouldAttemptExpansion(["redo"], false)).toBe(false);
    });

    it("does not fire for paste, even alongside an unrelated typing-looking tag", () => {
        expect(shouldAttemptExpansion(["input.paste"], false)).toBe(false);
    });

    it("[B-141] never fires while composing, even for a typing event", () => {
        expect(shouldAttemptExpansion(["input.type"], true)).toBe(false);
    });

    it("[B-141] composing blocks even when every transaction looks like typing", () => {
        expect(shouldAttemptExpansion(["input", "input.type"], true)).toBe(false);
    });

    it("does not fire for a drop", () => {
        expect(shouldAttemptExpansion(["input.drop"], false)).toBe(false);
    });
});

describe("isDeferredByComposition [B-191]", () => {
    it("is true for a typing event while composing", () => {
        expect(isDeferredByComposition(["input.type"], true)).toBe(true);
        expect(isDeferredByComposition(["input.type.compose"], true)).toBe(true);
    });

    it("is false when not composing (the normal path handles it)", () => {
        expect(isDeferredByComposition(["input.type"], false)).toBe(false);
    });

    it("is false for non-typing events while composing (paste/undo/drop/untagged)", () => {
        for (const ev of ["input.paste", "input.drop", "undo", "redo", undefined]) {
            expect(isDeferredByComposition([ev], true)).toBe(false);
        }
    });

    it("is true if any one transaction is typing", () => {
        expect(isDeferredByComposition(["undo", "input.type"], true)).toBe(true);
    });

    it("is false for an empty transaction list", () => {
        expect(isDeferredByComposition([], true)).toBe(false);
    });
});

describe("shouldRunDeferredExpansion [B-191]", () => {
    it("runs only when pending, not composing and focused", () => {
        expect(shouldRunDeferredExpansion(true, false, true)).toBe(true);
    });

    it("never runs while still composing (B-141)", () => {
        expect(shouldRunDeferredExpansion(true, true, true)).toBe(false);
    });

    it("does not run when unfocused", () => {
        expect(shouldRunDeferredExpansion(true, false, false)).toBe(false);
    });

    it("does not run when nothing is pending", () => {
        expect(shouldRunDeferredExpansion(false, false, true)).toBe(false);
    });
});

describe("isSingleCharTyping (ADR-0008 instant mode)", () => {
    const typed: ChangeInfo = { deleted: 0, inserted: 1, lines: 1, end: 5 };
    const caret = { ranges: 1, empty: true, head: 5 };

    it("one character inserted right before a single caret qualifies", () => {
        expect(isSingleCharTyping([typed], caret)).toBe(true);
    });

    it("no change, or two changes in one update, does not", () => {
        expect(isSingleCharTyping([], caret)).toBe(false);
        expect(isSingleCharTyping([typed, { ...typed, end: 9 }], caret)).toBe(false);
    });

    it("a paste-sized or multi-char insertion does not (auto-paired brackets arrive as two chars)", () => {
        expect(isSingleCharTyping([{ ...typed, inserted: 2 }], caret)).toBe(false);
        expect(isSingleCharTyping([{ ...typed, inserted: 40 }], caret)).toBe(false);
        expect(isSingleCharTyping([{ ...typed, inserted: 0 }], caret)).toBe(false);
    });

    it("a line break does not (Enter is the separator path)", () => {
        expect(isSingleCharTyping([{ ...typed, lines: 2 }], caret)).toBe(false);
    });

    it("typing over a selection (a replacement) does not", () => {
        expect(isSingleCharTyping([{ ...typed, deleted: 3 }], caret)).toBe(false);
    });

    it("multiple cursors never expand, nor does a non-empty selection", () => {
        expect(isSingleCharTyping([typed], { ...caret, ranges: 2 })).toBe(false);
        expect(isSingleCharTyping([typed], { ...caret, empty: false })).toBe(false);
    });

    it("the caret must sit right after the typed character", () => {
        expect(isSingleCharTyping([typed], { ...caret, head: 4 })).toBe(false);
        expect(isSingleCharTyping([typed], { ...caret, head: 6 })).toBe(false);
    });
});

describe("listContinuationTail [B-246]", () => {
    it.each([
        ["bullet", "g\n- ", "g", "\n- "],
        ["star bullet", "g\n* ", "g", "\n* "],
        ["plus bullet", "g\n+ ", "g", "\n+ "],
        ["numbered", "g\n2. ", "g", "\n2. "],
        ["numbered with a parenthesis", "g\n10) ", "g", "\n10) "],
        ["task", "g\n- [ ] ", "g", "\n- [ ] "],
        ["nested (tab indent)", "g\n\t- ", "g", "\n\t- "],
        ["nested (space indent)", "g\n    1. ", "g", "\n    1. "],
        ["nothing replaced", "\n- ", "", "\n- "],
        ["blockquote", "g\n> ", "g", "\n> "],
        ["nested blockquote", "g\n> > ", "g", "\n> > "],
        ["list in a blockquote", "g\n> - ", "g", "\n> - "],
        ["task in a callout", "g\n> - [ ] ", "g", "\n> - [ ] "],
        ["numbered in a blockquote", "g\n> 2. ", "g", "\n> 2. "],
    ])("%s: returns the inserted tail", (_name, inserted, replaced, tail) => {
        expect(listContinuationTail(inserted, replaced)).toBe(tail);
    });

    it("a plain Enter (no marker) is not a continuation", () => {
        expect(listContinuationTail("g\n", "g")).toBeUndefined();
        expect(listContinuationTail("g\n   ", "g")).toBeUndefined();
    });

    it("a quote prefix followed by text, or a list marker without a space inside a quote, is not a continuation", () => {
        expect(listContinuationTail("g\n> text", "g")).toBeUndefined();
        expect(listContinuationTail("g\n> -", "g")).toBeUndefined();
        expect(listContinuationTail("g\n>- x", "g")).toBeUndefined();
    });

    it("a line break followed by text is not a continuation (a paste, not an Enter)", () => {
        expect(listContinuationTail("g\n- item", "g")).toBeUndefined();
        expect(listContinuationTail("g\n-x", "g")).toBeUndefined();
        expect(listContinuationTail("g\n2.x", "g")).toBeUndefined();
    });

    it("a marker-like line without the trailing space is not a continuation", () => {
        expect(listContinuationTail("g\n-", "g")).toBeUndefined();
    });

    it("the inserted text must start with what it replaced", () => {
        expect(listContinuationTail("x\n- ", "g")).toBeUndefined();
    });

    it("more than one line break is not a continuation", () => {
        expect(listContinuationTail("g\n\n- ", "g")).toBeUndefined();
    });

    it("a number with no marker punctuation, or a very long number, is not a marker", () => {
        expect(listContinuationTail("g\n2 ", "g")).toBeUndefined();
        expect(listContinuationTail("g\n1234567890. ", "g")).toBeUndefined();
    });

    it("Enter on an empty item (the marker is removed: nothing is inserted) is not a continuation", () => {
        expect(listContinuationTail("", "- ")).toBeUndefined();
        expect(listContinuationTail("\n", "- ")).toBeUndefined();
    });
});
