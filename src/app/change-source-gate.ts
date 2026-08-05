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
