import { DEFAULT_DELIMITERS, isSeparator } from "../shared/delimiters";
import type { Dict, ExpandInput, TriggerMatch } from "./types";

export function findTrigger(
  input: ExpandInput,
  dict: Dict,
  delimiters: string[] = DEFAULT_DELIMITERS
): TriggerMatch | null {
  const { textBefore, sepCh, lastTyped } = input;
  if (!delimiters.includes(lastTyped)) return null;

  const line = textBefore + lastTyped;
  let i = sepCh - 1;                  

  while (i >= 0 && !isSeparator(line[i])) i--;

  const fromCh = i + 1;
  const toCh = sepCh;
  if (fromCh >= toCh) return null;

  const trigger = line.slice(fromCh, toCh);
  if (!trigger) return null;

  if (dict[trigger] === undefined) return null;
  return { trigger, fromCh, toCh };
}
