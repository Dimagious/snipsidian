import type { TryItResult, TryItStatus } from "../../core/pattern-tryit";

/**
 * ADR-0008, Patterns page: how a Try it result reads. Pure, so the sentences and the marks of the result box are
 * tested without a DOM.
 */

/** The one sentence under the result box. Empty for an empty line. */
export function describeTryItStatus(status: TryItStatus): string {
    switch (status.kind) {
        case "empty":
            return "";
        case "none":
            return "No match.";
        case "fires":
            return `Fires after ${status.at}.`;
        case "early":
            return `Fired at ${status.at}, before ${status.next}. To type ${status.at}${status.next}, choose After a separator.`;
        case "needs-separator":
            return "Fires when you type a separator next.";
        case "shadowed-rule":
            return `Rule ${status.position} fires first.`;
        case "shadowed-snippet":
            return `Snippet ${status.trigger} fires first.`;
    }
}

export type TryItPiece =
    | { kind: "text"; text: string }
    /** The inserted text: outlined as well as tinted, so colour is not the only cue. */
    | { kind: "replaced"; text: string }
    | { kind: "field"; number: number }
    | { kind: "caret" };

const CIRCLED = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨"];

/** `1` -> circled one; beyond nine, `(10)`. */
export function fieldMark(number: number): string {
    return CIRCLED[number - 1] ?? `(${number})`;
}

/** Splits the result text at the replaced span, the field offsets and the caret, in order. */
export function tryItPieces(result: TryItResult): TryItPiece[] {
    const { text, replaced, fields, caret } = result;
    const marks: Array<{ at: number; piece: TryItPiece }> = [];
    fields.forEach((at, i) => marks.push({ at, piece: { kind: "field", number: i + 1 } }));
    marks.push({ at: caret, piece: { kind: "caret" } });
    // At one offset a field goes before the caret (the caret is the last thing typed).
    marks.sort((a, b) => a.at - b.at || (a.piece.kind === "caret" ? 1 : 0) - (b.piece.kind === "caret" ? 1 : 0));

    const cuts = new Set<number>([0, text.length]);
    if (replaced) {
        cuts.add(replaced.from);
        cuts.add(replaced.to);
    }
    for (const m of marks) cuts.add(Math.min(Math.max(m.at, 0), text.length));
    const points = Array.from(cuts).sort((a, b) => a - b);

    const pieces: TryItPiece[] = [];
    const flushMarks = (at: number): void => {
        for (const m of marks) if (Math.min(Math.max(m.at, 0), text.length) === at) pieces.push(m.piece);
    };
    for (let i = 0; i < points.length; i++) {
        const from = points[i] ?? 0;
        flushMarks(from);
        const to = points[i + 1];
        if (to === undefined || to === from) continue;
        const inside = replaced !== null && from >= replaced.from && to <= replaced.to;
        pieces.push({ kind: inside ? "replaced" : "text", text: text.slice(from, to) });
    }
    return pieces;
}

/** The accessible name of the result box: what the text says and where the caret is, since marks are visual. */
export function tryItLabel(result: TryItResult): string {
    const caretAtEnd = result.caret >= result.text.length;
    const fields = result.fields.length > 0 ? `, ${result.fields.length} tab stop${result.fields.length === 1 ? "" : "s"}` : "";
    return `Result: ${result.text}${fields}${caretAtEnd ? ", caret at end" : ""}`;
}
