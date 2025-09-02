import type { SnipSidianSettings } from "../types";
import { isRecordOfString } from "./schema";

export function getDict(settings: SnipSidianSettings): Record<string, string> {
    return settings.snippets || {};
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
