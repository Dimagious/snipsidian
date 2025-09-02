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
    /** Absolute cursor position in ch on the same line (after replacement) */
    newCursorCh?: number;
};
