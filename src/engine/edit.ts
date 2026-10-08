import type { AppliedReplacement, EditPlan, ExpandInput, TriggerMatch } from "./types";

/** Build a plan for replacement and cursor positioning */
export function buildEdit(
    _input: ExpandInput,
    m: TriggerMatch,
    applied: AppliedReplacement
): EditPlan {
    const insert = applied.text;
    const fromCh = m.fromCh;
    const toCh = m.toCh;
    // B-182: no explicit `$|` -> no `newCursor`. The user's live cursor sits
    // AFTER the typed separator, outside the replaced range, so the editor
    // maps it through `replaceRange` onto the right spot on its own. The old
    // "end of insert" position landed BEFORE the separator.
    if (applied.cursorDelta === undefined) return { fromCh, toCh, insert };
    return { fromCh, toCh, insert, newCursor: offsetToLineCol(insert, applied.cursorDelta, fromCh) };
}

/** Convert a character offset inside `insert` to a (lineDelta, ch) position
 *  relative to the insert's starting line and column. Walks `insert` once,
 *  counts newlines, and returns the column on the resulting line. */
function offsetToLineCol(
    insert: string,
    offset: number,
    fromCh: number
): { lineDelta: number; ch: number } {
    let lineDelta = 0;
    let lastNewline = -1;
    const end = Math.min(offset, insert.length);
    for (let i = 0; i < end; i++) {
        if (insert.charCodeAt(i) === 0x0a /* '\n' */) {
            lineDelta++;
            lastNewline = i;
        }
    }
    if (lineDelta === 0) {
        return { lineDelta: 0, ch: fromCh + offset };
    }
    return { lineDelta, ch: offset - lastNewline - 1 };
}
