import type { SnipSidianSettings, SnippetItem } from "../types";
import { isRecordOfString } from "./schema";
import { splitKey } from "../services/utils";

export function getDict(settings: SnipSidianSettings): Record<string, string> {
    const src = settings.snippets || {};
    const out: Record<string, string> = {};
    // Stable order keeps behavior deterministic when grouped keys share the same trigger name.
    for (const [fullKey, val] of Object.entries(src).sort(([a], [b]) => a.localeCompare(b))) {
        const { name } = splitKey(fullKey);
        if (out[name] === undefined) {
            out[name] = val;
        }
    }
    return out;
}

export function hasTriggerCollision(
    settings: SnipSidianSettings,
    triggerName: string,
    excludeFullKey?: string
): boolean {
    for (const [fullKey] of Object.entries(settings.snippets || {})) {
        if (excludeFullKey && fullKey === excludeFullKey) continue;
        const { name } = splitKey(fullKey);
        if (name === triggerName) return true;
    }
    return false;
}

export function hasReplacementCollision(
    settings: SnipSidianSettings,
    triggerName: string,
    incomingReplacement: string,
    excludeFullKey?: string
): boolean {
    for (const [fullKey, replacement] of Object.entries(settings.snippets || {})) {
        if (excludeFullKey && fullKey === excludeFullKey) continue;
        const { name } = splitKey(fullKey);
        if (name !== triggerName) continue;
        if (replacement !== incomingReplacement) return true;
    }
    return false;
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

/**
 * Returns a flat list of all snippets from user settings
 */
export function getAllSnippetsFlat(settings: SnipSidianSettings): SnippetItem[] {
    const snippets: SnippetItem[] = [];

    // User snippets
    const userSnippets = settings.snippets || {};
    for (const [fullKey, replacement] of Object.entries(userSnippets)) {
        const { group, name } = splitKey(fullKey);
        snippets.push({
            id: `user:${fullKey}`,
            folder: group || "user",
            trigger: name,
            replacement
        });
    }

    return snippets;
}
