import type { Dict, EditPlan, ExpandContext, ExpandInput } from "./types";
import { shouldExpandHere } from "./guards";
import { findTrigger } from "./match";
import { applyPlaceholders } from "./placeholders";
import { buildEdit } from "./edit";
import { DEFAULT_DELIMITERS } from "../shared/delimiters";

export async function expand(
    input: ExpandInput,
    dict: Dict,
    ctx: ExpandContext,
    delimiters = DEFAULT_DELIMITERS
): Promise<EditPlan | null> {
    if (!shouldExpandHere(ctx)) return null;

    const m = findTrigger(input, dict, delimiters);
    if (!m) return null;

    const raw = dict[m.trigger] ?? "";
    const applied = await applyPlaceholders(raw, ctx);
    return buildEdit(input, m, applied);
}
