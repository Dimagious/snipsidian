import { DEFAULT_DELIMITERS, isSeparator } from "../shared/delimiters";
import type { Dict, ExpandInput, TriggerMatch } from "./types";

/**
 * Maximum number of characters to walk back from a separator while
 * looking for the trigger candidate. Real triggers are short (≤ 20
 * chars typically — `markdown-essentials`/`obsidian-callouts` etc.).
 * Beyond `MAX_LOOKBACK` we know there's no trigger here, and walking
 * further is a per-separator-keystroke pathological cost:
 *
 *   - Paste a 50k-char base64 blob → without the cap, every
 *     subsequent space in the same line scans 50k chars before
 *     concluding "nope, no trigger".
 *   - Long URLs in markdown source: same story.
 *
 * 64 is well clear of any legitimate trigger length. Increase if a
 * trigger needs >64 chars (unlikely — engine would rebel before
 * users want this).
 *
 * Closes B-019 (1.1.7).
 */
const MAX_LOOKBACK = 64;

export function findTrigger(
  input: ExpandInput,
  dict: Dict,
  delimiters: string[] = DEFAULT_DELIMITERS
): TriggerMatch | null {
  const { textBefore, sepCh, lastTyped } = input;
  if (!delimiters.includes(lastTyped)) return null;

  const line = textBefore + lastTyped;
  let i = sepCh - 1;
  // Lookback limit can be negative when sepCh < MAX_LOOKBACK — in
  // that case the limit is effectively "off the start of the line",
  // which the existing `i >= 0` check already handles.
  const lookbackLimit = sepCh - 1 - MAX_LOOKBACK;

  // Walk backwards. Three exit conditions:
  //   1. `i < 0`        — reached the start of the line (valid, trigger starts at column 0)
  //   2. separator      — found the boundary, trigger lives between here and sepCh
  //   3. `i < lookbackLimit` — walked MAX_LOOKBACK chars without finding either (pathological run)
  while (i >= 0 && i >= lookbackLimit && !isSeparator(line[i] ?? "")) i--;

  // Case 3 only: we stopped INSIDE the line because of the lookback
  // cap, not because of a separator. No real trigger could be that long.
  if (i >= 0 && !isSeparator(line[i] ?? "")) return null;

  const fromCh = i + 1;
  const toCh = sepCh;
  if (fromCh >= toCh) return null;

  const trigger = line.slice(fromCh, toCh);
  if (!trigger) return null;

  // Use hasOwnProperty.call, NOT `dict[trigger] === undefined`: a bare
  // property access resolves inherited `Object.prototype` members, so
  // typing `constructor`, `toString`, `valueOf`, `hasOwnProperty`,
  // `__proto__` (etc.) before a separator would resolve to a function /
  // the prototype object — `findTrigger` would report a phantom match and
  // `expand` would then call `.replace` on a non-string and throw on the
  // per-keystroke hot path. This is the read-side counterpart to the
  // write-side defence in `ui/utils/group-utils.ts`. See security S-008.
  if (!Object.prototype.hasOwnProperty.call(dict, trigger)) return null;
  return { trigger, fromCh, toCh };
}
