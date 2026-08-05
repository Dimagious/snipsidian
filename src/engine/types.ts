export type Dict = Record<string, string>;

export type ExpandContext = {
    isInCode: boolean;
    isInMath: boolean;          
    isInFrontmatter: boolean;
    filename?: string;
    now: Date;
    readClipboard?: () => Promise<string>;
};

export type ExpandInput = {
    /** Text before the separator */
    textBefore: string;
    /** Text after the separator (usually empty — but left for future use) */
    textAfter: string;
    /** Last typed separator character (space, punctuation, Enter, etc.) */
    lastTyped: string;
    /** ch-index of the separator on the current line */
    sepCh: number;
    /**
     * B-137: opt-in trigger-prefix mode. `undefined`/empty = off
     * (current behavior, byte-identical). When set to a single
     * character (e.g. `:` or `;`), `findTrigger` additionally
     * requires that exact character to sit immediately before the
     * candidate trigger, and consumes it as part of the match (the
     * returned `fromCh` extends one char left so the replacement
     * swallows the prefix). Stored trigger keys stay bare either way
     * — this only changes what the user has to type to fire them.
     */
    prefix?: string;
};

export type TriggerMatch = {
    trigger: string;
    fromCh: number; // including
    toCh: number;   // excluding (usually matches sepCh)
}

export type AppliedReplacement = {
    text: string;
    cursorDelta?: number; // cursor position change after replacement
};

export type EditPlan = {
    fromCh: number;
    toCh: number;
    insert: string;
    /** Cursor position after replacement, expressed relative to the original
     *  `(cur.line, fromCh)` position. `lineDelta` counts newlines crossed
     *  inside `insert`; `ch` is the absolute column on the final line
     *  (when `lineDelta` > 0, `ch` is the column from the start of that line;
     *  when `lineDelta` === 0, `ch` is `fromCh + offset`). */
    newCursor?: { lineDelta: number; ch: number };
};
