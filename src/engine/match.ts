import { DEFAULT_DELIMITERS, isSeparator } from "../shared/delimiters";
import type { Dict, ExpandInput, TriggerMatch } from "./types";

/**
 * Finds a trigger immediately before a delimiter, considering word boundaries.
 * Returns the range [fromCh, toCh) (toCh usually matches sepCh).
 */
export function findTrigger(
    input: ExpandInput,
    dict: Dict,
    delimiters: string[] = DEFAULT_DELIMITERS
): TriggerMatch | null {
    const { textBefore, sepCh, lastTyped } = input;
    if (!delimiters.includes(lastTyped)) return null;

    // Simple model: a word consists of [A-Za-z0-9_]
    const isWord = (c: string) => /[A-Za-z0-9_]/.test(c);

    const lastWordEnd = sepCh - 1;
    if (lastWordEnd < 0) return null;

    const line = textBefore + lastTyped; // convenient to look at characters before the delimiter
    if (!isWord(line[lastWordEnd])) return null;

    // Step back to the start of the word
    let i = lastWordEnd;
    while (i - 1 >= 0 && isWord(line[i - 1])) i--;
    const fromCh = i;
    const toCh = sepCh; // delimiter is not included

    const trigger = line.slice(fromCh, toCh);
    if (!trigger) return null;

    // Word boundary on the right is already guaranteed by the delimiter
    const leftNeighbor = fromCh - 1 >= 0 ? line[fromCh - 1] : "";
    if (leftNeighbor && !isSeparator(leftNeighbor)) {
        // If the left neighbor is not a delimiter, we are inside a word
        return null;
    }

    if (dict[trigger] === undefined) return null;
    return { trigger, fromCh, toCh };
}
