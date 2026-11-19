export type Dict = Record<string, string>;

export type ExpandContext = {
    isInCode: boolean;
    isInMath: boolean;          
    isInFrontmatter: boolean;
    filename?: string;
    now: Date;
    /** B-166: formats `now` with a moment-style format string for `{{date:FMT}}`
     *  / `{{time:FMT}}`. Injected by the adapter (engine stays Obsidian-free). */
    formatDate?: (date: Date, format: string) => string;
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
    /** B-243: offsets in `text` of the fields, in visit order (ascending
     *  number, ties by position). Absent unless the snippet has 2+ tabstops. */
    fields?: number[];
    /** B-243: document index of each field in `fields` (breaks ties between
     *  fields at one offset: `$2$1`). */
    docOrder?: number[];
    /** B-243: offset in `text` of the final stop. Present only when the
     *  replacement has `$|`; absent = the end of the insert (plus the typed
     *  separator on the trigger path). */
    finalDelta?: number;
};

/** B-243: where a field session starts, as document offsets. */
export type FieldStops = {
    /** Field positions in visit order. */
    fields: number[];
    /** Document index of each field in `fields` (tie-break for equal offsets). */
    docOrder?: number[];
    /** Where the last Tab lands. */
    final: number;
};

/** ADR-0008: when a pattern rule fires. */
export type PatternMode = "instant" | "separator";

/** ADR-0008: a regex trigger, as stored in `settings.patterns`. */
export type PatternRule = {
    /** Stable, generated. */
    id: string;
    /** `/body$/flags` as typed (Substitutions-style). */
    source: string;
    replacement: string;
    enabled: boolean;
    mode: PatternMode;
    /** Shown in the list; `disabledGroups` applies. */
    group?: string;
};

export type EditPlan = {
    /** ADR-0008: set for pattern expansions, so the adapter writes them as
     *  their own undo step. Absent for literal triggers. */
    kind?: "pattern";
    /** ADR-0008: an instant rule that fired on a typed separator replaced it too: nothing of the typed text
     *  follows the insert. Absent for plans that keep the separator after the insert. */
    consumesSeparator?: true;
    fromCh: number;
    toCh: number;
    insert: string;
    /** Cursor position after replacement, expressed relative to the original
     *  `(cur.line, fromCh)` position. `lineDelta` counts newlines crossed
     *  inside `insert`; `ch` is the absolute column on the final line
     *  (when `lineDelta` > 0, `ch` is the column from the start of that line;
     *  when `lineDelta` === 0, `ch` is `fromCh + offset`). */
    newCursor?: { lineDelta: number; ch: number };
    /** B-243: offsets inside `insert` (visit order) and of the final stop. */
    fields?: number[];
    docOrder?: number[];
    /** Offset inside `insert` of the final stop (`$|`); absent = the end of
     *  the insert plus the typed separator. */
    final?: number;
};
