import type { SnipSidianSettings } from "../types";
import { isRecordOfString } from "./schema";
import { splitKey } from "../services/utils";

export function getDict(settings: SnipSidianSettings): Record<string, string> {
    const src = settings.snippets || {};
    const out: Record<string, string> = {};
    for (const [fullKey, val] of Object.entries(src)) {
        const { name } = splitKey(fullKey);
        out[name] = val;
    }
    return out;
}

export function mergeDefaults(
    current: Record<string, string>,
    defaults: Record<string, string>
): Record<string, string> {
    return { ...defaults, ...current };
}

export function replaceAllSnippets(
    settings: SnipSidianSettings,
    incoming: unknown
): SnipSidianSettings | null {
    if (!isRecordOfString(incoming)) return null;
    return { snippets: incoming };
}
