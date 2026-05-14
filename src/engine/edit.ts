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
    const offset = applied.cursorDelta !== undefined ? applied.cursorDelta : insert.length;
    return { fromCh, toCh, insert, newCursor: offsetToLineCol(insert, offset, fromCh) };
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
