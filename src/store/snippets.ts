import type { SnipSidianSettings, SnippetItem } from "../types";
import { isRecordOfString } from "./schema";
import { splitKey } from "../services/utils";
import { PACKAGE_CATALOG } from "../catalog";
import { espansoYamlToSnippets } from "../packages/espanso";

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

/**
 * Returns a flat list of all snippets from all sources
 * (user + presets + installed packages)
 */
export function getAllSnippetsFlat(settings: SnipSidianSettings): SnippetItem[] {
    const snippets: SnippetItem[] = [];

    // 1. User snippets
    const userSnippets = getDict(settings);
    for (const [trigger, replacement] of Object.entries(userSnippets)) {
        snippets.push({
            id: `user:${trigger}`,
            folder: "user",
            trigger,
            replacement
        });
    }

    // 2. Snippets from installed packages
    for (const pkg of PACKAGE_CATALOG) {
        const packageSnippets = espansoYamlToSnippets(pkg.yaml);
        for (const [trigger, replacement] of Object.entries(packageSnippets)) {
            snippets.push({
                id: `${pkg.id}:${trigger}`,
                folder: pkg.id,
                trigger,
                replacement
            });
        }
    }

    return snippets;
}
