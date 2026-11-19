import { isTypingUserEvent, type ChangeInfo } from "./change-source-gate";

/**
 * ADR-0008, instant patterns next to Obsidian's "Auto pair brackets" (default
 * on). Pure decisions, no `@codemirror/*` imports: the CM6 plumbing is in
 * `cm6-bridge.ts`.
 *
 * With auto-pairing, typing `x (c)` is not five single-character insertions.
 * `(` inserts the pair `()` with the caret between (a two-character change),
 * and the final `)` only steps the caret over the closer the editor inserted:
 * a selection-only update with no `userEvent` at all. Both shapes are dropped
 * by the single-character gate, so an instant rule ending in `)` (`/\(c\)$/i`
 * to a copyright sign) never ran. These two helpers recognise the shapes,
 * fail closed, and the tracker remembers which closer the editor inserted so a
 * caret move that is NOT typing is never read as one.
 */

/** Opener to closer, for what the editor inserts as a pair: brackets and quotes ("Auto pair brackets") and the
 *  Markdown pairs ("Auto pair Markdown syntax", on by default). Quotes, backtick, `*` and `_` pair with themselves.
 *  One named place to extend if Obsidian pairs more. */
const AUTO_PAIRS: ReadonlyMap<string, string> = new Map([
    ["(", ")"],
    ["[", "]"],
    ["{", "}"],
    ['"', '"'],
    ["'", "'"],
    ["`", "`"],
    ["*", "*"],
    ["_", "_"],
]);

/** The characters a caret can step over after an auto-pair: the closers of `AUTO_PAIRS`. */
export const PAIR_CLOSERS: ReadonlySet<string> = new Set(AUTO_PAIRS.values());

/** True for a `delete` / `delete.*` transaction (Backspace, Delete, cut...). Not typing, but it moves the closer
 *  like any edit, so the tracker follows it instead of dropping the closer (a typo fixed inside the pair). */
export function isDeleteUserEvent(userEvent: string | undefined): boolean {
    return userEvent === "delete" || (userEvent !== undefined && userEvent.startsWith("delete."));
}

/** The closer of an inserted text that is exactly one auto-pair (`"()"` gives `")"`), else `undefined`. */
export function pairedCloser(inserted: string): string | undefined {
    if (inserted.length !== 2) return undefined;
    const closer = AUTO_PAIRS.get(inserted.charAt(0));
    return closer !== undefined && closer === inserted.charAt(1) ? closer : undefined;
}

/**
 * Shape 2: the change is ONE pure insertion of an auto-pair (`()`, `[]`, ...) with a single empty caret between
 * the two characters. Returns the closer (now sitting right after the caret), else `undefined`. Whether it is
 * typing at all is `shouldAttemptExpansion`'s job.
 */
export function pairInsertCloser(
    changes: ReadonlyArray<ChangeInfo>,
    selection: { ranges: number; empty: boolean; head: number },
): string | undefined {
    if (changes.length !== 1 || selection.ranges !== 1 || !selection.empty) return undefined;
    const change = changes[0];
    if (
        change === undefined ||
        change.deleted !== 0 ||
        change.inserted !== 2 ||
        change.lines !== 1 ||
        change.end - 1 !== selection.head ||
        change.text === undefined
    ) {
        return undefined;
    }
    return pairedCloser(change.text);
}

/** The closer the editor auto-inserted most recently in one editor view, and where it is now. */
export class PairedCloserTracker {
    private pos: number | undefined;
    private char = "";

    get tracked(): boolean {
        return this.pos !== undefined;
    }

    /** The closer `char` sits at document offset `pos` (the caret is right before it). Replaces an earlier one. */
    track(pos: number, char: string): void {
        this.pos = pos;
        this.char = char;
    }

    clear(): void {
        this.pos = undefined;
        this.char = "";
    }

    /** Carries the position through a document change. `mapPos` gives the new offset, `null` when the
     *  closer itself was deleted (CM6 `MapMode.TrackAfter`: the tracked offset is the start of the closer, so it
     *  is the character AFTER the position that must not be deleted): then nothing is tracked any more. */
    map(mapPos: (pos: number) => number | null): void {
        if (this.pos === undefined) return;
        const next = mapPos(this.pos);
        if (next === null) this.clear();
        else this.pos = next;
    }

    /** True when the tracked closer is `char`, starting at `pos`. */
    isAt(pos: number, char: string): boolean {
        return this.pos !== undefined && this.pos === pos && this.char === char;
    }
}

/** What `isCloserStepOver` needs to know about a selection-only update. */
export type CaretMove = {
    /** The `userEvent` of every transaction (`undefined` = untagged). */
    userEvents: ReadonlyArray<string | undefined>;
    before: { ranges: number; empty: boolean; head: number };
    after: { ranges: number; empty: boolean; head: number };
    /** The document text between the two heads (`""` unless the caret moved exactly one character forward). */
    passed: string;
};

/**
 * Shape 1: the caret stepped over a closer the editor auto-inserted, which is what typing the closer does.
 * Fail closed, all of: every transaction untagged or typing (a `select` arrow-key or mouse move is neither), one
 * empty caret before and after, the head moved exactly +1, the character passed is an auto-pair closer, AND it is
 * the closer the tracker saw being inserted, at exactly that offset (a programmatic `setCursor` onto some other
 * `)` is not typing).
 */
export function isCloserStepOver(move: CaretMove, tracker: PairedCloserTracker): boolean {
    const { before, after } = move;
    if (move.userEvents.length === 0) return false;
    if (!move.userEvents.every((event) => event === undefined || isTypingUserEvent(event))) return false;
    if (before.ranges !== 1 || !before.empty || after.ranges !== 1 || !after.empty) return false;
    if (after.head !== before.head + 1) return false;
    if (!PAIR_CLOSERS.has(move.passed)) return false;
    return tracker.isAt(before.head, move.passed);
}
