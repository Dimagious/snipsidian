// src/engine/match.ts
import { DEFAULT_DELIMITERS, isSeparator } from "../shared/delimiters";
import type { Dict, ExpandInput, TriggerMatch } from "./types";

/**
 * Find trigger right before a delimiter, respecting word boundaries.
 */
export function findTrigger(
    input: ExpandInput,
    dict: Dict,
    delimiters: string[] = DEFAULT_DELIMITERS
): TriggerMatch | null {
    const { textBefore, sepCh, lastTyped } = input;
    if (!delimiters.includes(lastTyped)) return null;

    // Unicode-aware "word" char: any letter or number, plus underscore.
    // \p{L} = any kind of letter; \p{N} = any kind of numeric character.
    const isWord = (c: string) => /[\p{L}\p{N}_]/u.test(c);
    // NOTE: no /u flag needed with separate alternatives
    // If you prefer a single class, you can also use: /[\p{L}\p{N}_]/u

    const lastWordEnd = sepCh - 1;
    if (lastWordEnd < 0) return null;

    const line = textBefore + lastTyped;
    if (!isWord(line[lastWordEnd])) return null;

    // walk back to the start of the word
    let i = lastWordEnd;
    while (i - 1 >= 0 && isWord(line[i - 1])) i--;
    const fromCh = i;
    const toCh = sepCh; // exclude the delimiter itself

    const trigger = line.slice(fromCh, toCh);
    if (!trigger) return null;

    // left boundary must be a separator or start-of-line (avoid mid-word expansions)
    const leftNeighbor = fromCh - 1 >= 0 ? line[fromCh - 1] : "";
    if (leftNeighbor && !isSeparator(leftNeighbor)) return null;

    if (dict[trigger] === undefined) return null;
    return { trigger, fromCh, toCh };
}
