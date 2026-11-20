/**
 * B-149: decide whether a CM6 document change came from genuine user
 * typing — as opposed to paste, undo/redo, drag-drop, or a
 * programmatic edit (including Snipsy's own expansion writes).
 *
 * Extracted as a pure function (no `@codemirror/*` imports) so the
 * decision logic is unit-testable without spinning up a real CM6
 * `EditorView`. The CM6-touching caller (`cm6-bridge.ts`) reads each
 * transaction's `Transaction.userEvent` annotation and the view's
 * `composing` flag, then hands the plain strings/booleans here.
 *
 * ## Allowlist, not blocklist (checker follow-up)
 *
 * An earlier version of this gate accepted the whole "input" family
 * and explicitly excluded the two sub-events known to be non-typing
 * (`input.paste`, `input.drop`). That fails OPEN: any *other*
 * `input.*` sub-event CM6 introduces — e.g. `input.complete`, the tag
 * used for autocomplete/completion acceptance — would sail through
 * unrecognized and be treated as typing. This gate exists specifically
 * to keep Snipsy's expander off non-typing writes, so an unknown event
 * must default to rejected, not accepted.
 *
 * The predicate is now a fail-closed allowlist of exactly the three
 * shapes known to be genuine typing:
 *
 *   - `"input"` (bare) — Enter/newline insertion. Enter goes through a
 *     *keymap command* (`insertNewline`/`insertNewlineAndIndent` in
 *     `@codemirror/commands`, which Obsidian's editor uses in its
 *     default keymap), and those commands dispatch with the bare
 *     `userEvent: "input"` — NOT `"input.type"`. Verified against the
 *     `@codemirror/commands` source:
 *
 *       insertNewline:           dispatch(state.update(..., {userEvent: "input"}))
 *       insertNewlineAndIndent:  dispatch(state.update(..., {userEvent: "input"}))
 *
 *     Losing this case would silence Enter-terminated triggers
 *     (B-148/B-109) — a real typing action, not a paste/undo.
 *
 *   - `"input.type"` — CM6's own DOM-input handler (`@codemirror/view`,
 *     the code path that turns native `beforeinput`/`input` events
 *     from actual keystrokes into a transaction) tags those
 *     transactions `"input.type"` — see `@codemirror/view`'s
 *     `applyDOMChange`. Covers regular character typing.
 *
 *   - `"input.type."`-prefixed sub-events (e.g. `"input.type.compose"`)
 *     — IME composition commits. The separate `composing` check
 *     already guards mid-composition dispatch; once composition has
 *     ended, the committed text is genuine typing.
 *
 * Every other tag — `input.paste`, `input.drop`, `input.complete`, any
 * future `input.*` sub-event, `undo`, `redo`, `delete.*`, `move.drop`,
 * an unrelated plugin's custom annotation, or an untagged programmatic
 * edit (`undefined`) — is rejected by default.
 */

/**
 * True when a single transaction's `userEvent` annotation represents
 * genuine user typing (character input or Enter/newline insertion),
 * as opposed to paste, drop, undo, redo, autocomplete acceptance, or
 * an untagged programmatic edit (`undefined`).
 */
export function isTypingUserEvent(userEvent: string | undefined): boolean {
    if (!userEvent) return false;
    return (
        userEvent === "input" ||
        userEvent === "input.type" ||
        userEvent.startsWith("input.type.")
    );
}

/**
 * The gate predicate: given the `userEvent` annotations of every
 * transaction in a CM6 `ViewUpdate` and whether the view is currently
 * composing (IME), decide whether an expansion attempt should run.
 *
 *   - `composing: true` always blocks (B-141 — never dispatch an edit
 *     mid-composition, a known way to corrupt CJK/IME input).
 *   - Otherwise, fires if ANY transaction in the update is a typing
 *     event (multiple transactions can land in one update; one
 *     genuine keystroke among them is enough).
 */
export function shouldAttemptExpansion(
    transactionUserEvents: ReadonlyArray<string | undefined>,
    composing: boolean,
): boolean {
    if (composing) return false;
    return transactionUserEvents.some(isTypingUserEvent);
}

/**
 * B-191: true when an update's only obstacle to expansion was IME
 * composition — i.e. it carried a genuine typing event but the view
 * was still composing. Some input methods (e.g. Linux Wayland
 * text-input-v3) deliver every character, including the separator,
 * as its own composition whose commit adds no further document
 * change. The gate above correctly blocks that update (B-141), but
 * nothing would ever re-run it, so the expansion would be lost. The
 * caller remembers this as "pending" and retries once composition has
 * ended. Non-typing events (paste/undo/drop) never qualify.
 */
export function isDeferredByComposition(
    transactionUserEvents: ReadonlyArray<string | undefined>,
    composing: boolean,
): boolean {
    return composing && transactionUserEvents.some(isTypingUserEvent);
}

/**
 * B-191: gate for the retry that runs after `compositionend`. Runs
 * only when an attempt is pending, the view is no longer composing
 * (never dispatch mid-composition, B-141) and it still has focus.
 */
export function shouldRunDeferredExpansion(
    pending: boolean,
    composing: boolean,
    hasFocus: boolean,
): boolean {
    return pending && !composing && hasFocus;
}

/** What `isSingleCharTyping` needs to know about one change of an update. */
export type ChangeInfo = {
    /** Characters removed. */
    deleted: number;
    /** Characters inserted. */
    inserted: number;
    /** Lines of the inserted text (1 = no line break). */
    lines: number;
    /** Where the inserted text ends, in the new document. */
    end: number;
    /** The inserted text. Read only for two-character insertions (an auto-paired bracket), else left out. */
    text?: string;
};

/**
 * ADR-0008: instant patterns run only after ONE typed character: a single
 * pure insertion of one character, no line break, ending exactly at the caret,
 * with a single empty selection range (multiple cursors never expand). Whether
 * the update is typing at all, and not composing, is `shouldAttemptExpansion`.
 */
export function isSingleCharTyping(
    changes: ReadonlyArray<ChangeInfo>,
    selection: { ranges: number; empty: boolean; head: number },
): boolean {
    if (changes.length !== 1 || selection.ranges !== 1 || !selection.empty) return false;
    const change = changes[0];
    return (
        change !== undefined &&
        change.deleted === 0 &&
        change.inserted === 1 &&
        change.lines === 1 &&
        change.end === selection.head
    );
}

const LIST_MARKER = "(?:[-*+]|\\d{1,9}[.)])[ \\t]+(?:\\[.\\][ \\t]*)?";

/** A line break, the indentation, then a quote prefix (`> `, nested `> > `, also a callout body) and/or a list marker
 *  (`-`, `*`, `+`, `1.`, `1)`, optionally a task box), then the caret. A bare indent is not one. */
const LIST_CONTINUATION = new RegExp(`^\\n[ \\t]*(?:(?:>[ \\t]*)+(?:${LIST_MARKER})?|${LIST_MARKER})$`);

/**
 * B-246: Enter in a list item. Obsidian continues the list in the same change as the line break, so the update does
 * not read as "a line break at column 0" but as the last typed characters replaced by themselves plus
 * `"\n" + indentation + marker` (real Obsidian 1.14.5: `g` becomes `g\n- `, `g` becomes `g\n2. `, `g` becomes
 * `g\n- [ ] `; in a quote `g\n> `, `g\n> - `). Returns that inserted tail when `inserted` is exactly `replaced`
 * followed by one, else `undefined`. A plain Enter, a paste, a marker-less indent, or Enter on an empty item (the editor removes the marker: a
 * deletion, nothing inserted) never match. Pure: the CM6 caller reads the text and the caret.
 */
export function listContinuationTail(inserted: string, replaced: string): string | undefined {
    if (!inserted.startsWith(replaced)) return undefined;
    const tail = inserted.slice(replaced.length);
    return LIST_CONTINUATION.test(tail) ? tail : undefined;
}
