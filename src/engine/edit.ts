import type { AppliedReplacement, EditPlan, ExpandInput, TriggerMatch } from "./types";

/** Build a plan for replacement and cursor positioning */
export function buildEdit(
    input: ExpandInput,
    m: TriggerMatch,
    applied: AppliedReplacement
): EditPlan {
    const insert = applied.text;
    const fromCh = m.fromCh;
    const toCh = m.toCh;
    const newCursorCh = applied.cursorDelta !== undefined ? fromCh + applied.cursorDelta : fromCh + insert.length;
    return { fromCh, toCh, insert, newCursorCh };
}
