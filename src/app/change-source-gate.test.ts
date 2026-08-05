import { describe, it, expect } from "vitest";
import { isTypingUserEvent, shouldAttemptExpansion } from "./change-source-gate";

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
