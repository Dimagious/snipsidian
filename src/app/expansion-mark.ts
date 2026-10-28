// src/app/expansion-mark.ts
import {
    StateEffect,
    StateField,
    Prec,
    type EditorState,
    type Extension,
    type Transaction,
    type TransactionSpec,
} from "@codemirror/state";
import { Decoration, EditorView, keymap } from "@codemirror/view";

/**
 * B-176: expansion highlight + Backspace undo window (opt-in).
 *
 * After a trigger expansion the bridge dispatches `markExpansion`; the
 * state field below remembers WHERE the expansion landed and WHAT the
 * user had typed (trigger + separator). While the mark is "live",
 * Backspace restores that text in ONE transaction instead of deleting a
 * single character. The mark is also drawn as a `Decoration.mark` so the
 * user can see that the undo window is open (the answer to "Backspace
 * fires when I only wanted to delete the last character").
 *
 * ## Pinned rules
 *
 * Layout after an expansion (`E` = inserted text, `S` = the separator
 * that was typed after the trigger, one character; Enter counts as `\n`):
 *
 *     ... [from E to) [to S end) ...        cursor = `cursor`
 *
 * - `cursor` is wherever the expansion left the caret: after `S` for a
 *   plain snippet, inside `E` for a snippet with `$|`. It is read from the
 *   selection of the transaction that carries the effect.
 * - The mark is created only if the carrying transaction has ONE empty
 *   selection range inside `[from, end]` and the document reads exactly
 *   `E + S` over `[from, end)` (a `$clipboard` expansion where the user
 *   moved away, or a stale view, creates nothing). Backspace re-checks
 *   that text before restoring.
 * - The mark stays live ONLY while the selection is a single caret exactly
 *   at its mapped `cursor`; multiple cursors never count as live. Any caret move, selection, click or arrow key
 *   clears it. No timeout: the window closes by user action, never by time.
 * - Edits elsewhere (above or below, e.g. sync or another plugin) are
 *   mapped through `tr.changes`; the mark moves with the text. A change
 *   that overlaps `[from, end)` clears it. Any user typing, deletion,
 *   undo, redo or drag (`input*`, `delete*`, `undo`, `redo`, `move*`)
 *   clears it. Another expansion replaces it.
 * - Backspace (and Shift-Backspace) while live restores `original +
 *   separator` over `[from, end)`, puts the caret after it, and clears
 *   the mark. The restored trigger is NOT re-expanded: the transaction
 *   carries `userEvent: "snipsy.undo"`, which the B-149 gate rejects
 *   (`isTypingUserEvent`). The name deliberately avoids the `delete.`
 *   prefix: CM6's history joins `delete*` events typed within
 *   `newGroupDelay` into the previous history event, which would make
 *   Cmd+Z swallow the expansion step as well. As its own history step,
 *   one Cmd+Z after a Backspace-undo re-applies the expansion.
 * - Backspace with the mark not live, with a selection, mid-composition
 *   or in a read-only editor is native (the command returns `false`).
 *
 * The field update is O(1) per transaction: it returns the same value
 * object unless the transaction has an effect, changes the document, or
 * moves the selection.
 */

/** What the bridge reports after an expansion landed. */
export interface ExpansionMarkInfo {
    /** Start of the inserted text. */
    from: number;
    /** The inserted text. Its end is derived from it (after the same
     *  line-break normalisation CM6 applies), never reported separately. */
    insert: string;
    /** The text the expansion replaced (prefix + trigger, as typed). */
    original: string;
    /** The separator typed after the trigger (`"\n"` for Enter). */
    separator: string;
}

export interface ExpansionMark {
    from: number;
    to: number;
    /** End of the guarded span: `to` plus the separator length. */
    end: number;
    cursor: number;
    /** `original + separator`: what Backspace puts back. */
    restore: string;
    /** `insert + separator` as it must still read in `[from, end)`. */
    expected: string;
}

export const markExpansionEffect = StateEffect.define<ExpansionMarkInfo>();
export const clearExpansionEffect = StateEffect.define<null>();

/** `userEvent` of the Backspace-undo transaction (see module doc). */
export const SNIPSY_UNDO_EVENT = "snipsy.undo";

const MARK_CLASS = "snipsy-expanded";
const expandedMark = Decoration.mark({ class: MARK_CLASS });

function buildMark(
    info: ExpansionMarkInfo,
    tr: Transaction,
): ExpansionMark | null {
    const { from, separator } = info;
    // CM6 turns `\r\n` / `\r` in inserted text into `\n`.
    const insert = info.insert.replace(/\r\n?/g, "\n");
    const to = from + insert.length;
    const end = to + separator.length;
    if (separator.length === 0 || from < 0) return null;
    const doc = tr.newDoc;
    if (end > doc.length) return null;
    const expected = insert + separator;
    if (doc.sliceString(from, end) !== expected) return null;
    const ranges = tr.newSelection.ranges;
    const sel = tr.newSelection.main;
    if (ranges.length > 1 || !sel.empty || sel.head < from || sel.head > end) {
        return null;
    }
    return {
        from,
        to,
        end,
        cursor: sel.head,
        restore: info.original + separator,
        expected,
    };
}

/** True when a change overlaps `[from, end)`. Insertions at either
 *  boundary do not: text inserted at `from` shifts the mark right, at
 *  `end` it stays outside. */
function touches(tr: Transaction, mark: ExpansionMark): boolean {
    let hit = false;
    tr.changes.iterChangedRanges((fromA, toA) => {
        if (fromA < mark.end && toA > mark.from) hit = true;
    });
    return hit;
}

function isUserEdit(tr: Transaction): boolean {
    return (
        tr.isUserEvent("input") ||
        tr.isUserEvent("delete") ||
        tr.isUserEvent("undo") ||
        tr.isUserEvent("redo") ||
        tr.isUserEvent("move")
    );
}

export const expansionMarkField = StateField.define<ExpansionMark | null>({
    create: () => null,
    update(value, tr) {
        // Effects first, last one wins: a new expansion replaces the old
        // mark, an explicit clear (Backspace-undo) drops it.
        let next = value;
        for (const effect of tr.effects) {
            if (effect.is(markExpansionEffect)) next = buildMark(effect.value, tr);
            else if (effect.is(clearExpansionEffect)) next = null;
        }
        if (next !== value) return next;
        if (!value) return value;

        let { from, to, end, cursor } = value;
        if (tr.docChanged) {
            if (isUserEdit(tr) || touches(tr, value)) return null;
            from = tr.changes.mapPos(from, 1);
            to = tr.changes.mapPos(to, -1);
            end = tr.changes.mapPos(end, -1);
            cursor = tr.changes.mapPos(cursor, -1);
        } else if (!tr.selection) {
            return value;
        }
        const sel = tr.newSelection.main;
        if (tr.newSelection.ranges.length > 1 || !sel.empty || sel.head !== cursor) {
            return null;
        }
        if (!tr.docChanged) return value;
        return { ...value, from, to, end, cursor };
    },
    provide: (field) =>
        EditorView.decorations.from(field, (mark) =>
            mark && mark.to > mark.from
                ? Decoration.set([expandedMark.range(mark.from, mark.to)])
                : Decoration.none,
        ),
});

/** The part of `EditorView` the Backspace command needs (testable with a
 *  plain object, no DOM). */
export interface MarkCommandView {
    readonly state: EditorState;
    readonly composing: boolean;
    dispatch(spec: TransactionSpec): void;
}

/**
 * Backspace command: restores `trigger + separator` when the mark is
 * live. Returns `false` (native Backspace) in every other case.
 */
export function undoExpansion(
    view: MarkCommandView,
    isEnabled: () => boolean,
): boolean {
    if (!isEnabled()) return false;
    const mark = view.state.field(expansionMarkField, false);
    if (!mark) return false;
    if (view.composing || view.state.readOnly) return false;
    const sel = view.state.selection.main;
    if (view.state.selection.ranges.length > 1) return false;
    if (!sel.empty || sel.head !== mark.cursor) return false;
    if (view.state.doc.sliceString(mark.from, mark.end) !== mark.expected) {
        return false;
    }
    view.dispatch({
        changes: { from: mark.from, to: mark.end, insert: mark.restore },
        selection: { anchor: mark.from + mark.restore.length },
        effects: clearExpansionEffect.of(null),
        userEvent: SNIPSY_UNDO_EVENT,
        scrollIntoView: true,
    });
    return true;
}

/** Called by the bridge once the expansion edit has landed. */
export function markExpansion(
    view: Pick<EditorView, "dispatch">,
    info: ExpansionMarkInfo,
): void {
    view.dispatch({ effects: markExpansionEffect.of(info) });
}

/**
 * The CM6 extension: state field + decoration + Backspace keymap.
 * `isEnabled` is read at use time, so the setting takes effect without a
 * reload. `Prec.highest`: the command returns `false` whenever the mark
 * is not live, so winning over other Backspace handlers (list handling,
 * bracket pairs) costs nothing outside the undo window and guarantees the
 * window is honoured inside it.
 */
export function buildExpansionMarkExtension(isEnabled: () => boolean): Extension {
    return [
        expansionMarkField,
        Prec.highest(
            keymap.of([
                { key: "Backspace", run: (view) => undoExpansion(view, isEnabled) },
                { key: "Shift-Backspace", run: (view) => undoExpansion(view, isEnabled) },
            ]),
        ),
    ];
}
