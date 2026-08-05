import type { SnipSidianSettings, SnippetItem } from "../types";
import { splitKey } from "./keys";

/**
 * Build a flat trigger → replacement dictionary from settings.
 *
 * **Collision policy (first-wins, alphabetical full-key sort):**
 * when the same trigger name lives in multiple groups (e.g. both
 * `work/sig` and `personal/sig`), the dictionary keeps the value
 * from the entry whose **full key** sorts first via
 * `String.localeCompare`. So `alpha/sig` wins over `zeta/sig`, and
 * `sig` (ungrouped, no prefix) wins over `work/sig` (since "" < "w").
 *
 * This is deterministic but non-obvious — every install/add/edit
 * path also runs `hasTriggerCollision` as a gate so users never
 * unintentionally land in this resolution. The gate sits in
 * `core/snippet-ops.ts` (planAddSnippet / planEditSnippet),
 * `core/install-plan.ts` (community-pack install), and
 * `ui/components/community/EspansoSection.ts` (Espanso import).
 * Tests in `snippets.test.ts` pin the alphabetical-sort tiebreaker.
 *
 * **B-138 per-group disable:** entries whose group is listed in
 * `settings.disabledGroups` are skipped entirely — they neither
 * expand (this is the hot-path trigger map) nor win the first-wins
 * collision resolution above. A disabled group's winning entry
 * simply falls through to the next candidate group with the same
 * trigger name, if any. Ungrouped entries (`group === ""`) can never
 * be disabled — the UI has no affordance for it, and this function
 * doesn't special-case it either (an empty string would never appear
 * in `disabledGroups` in practice).
 */
export function getDict(settings: SnipSidianSettings): Record<string, string> {
    const src = settings.snippets || {};
    const disabled = new Set(settings.disabledGroups ?? []);
    const out: Record<string, string> = {};
    for (const [fullKey, val] of Object.entries(src).sort(([a], [b]) => a.localeCompare(b))) {
        const { group, name } = splitKey(fullKey);
        if (disabled.has(group)) continue;
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

// `replaceAllSnippets` removed in 1.0.9 — was unused; the JSON import flow in
// `BasicTab.ts` calls `isRecordOfString` from `shared/guards` directly.

/**
 * Returns a flat list of all snippets from user settings.
 *
 * B-138: entries whose group is in `settings.disabledGroups` are
 * excluded — this feeds the snippet picker (`core/snippet-picker.ts`),
 * so a disabled group is hidden there too, matching the pinned
 * semantics: disabled = doesn't expand AND hidden from the picker.
 * `SnippetsTab.ts` (the settings UI) does NOT use this function — it
 * reads `settings.snippets` directly so disabled groups stay visible
 * (dimmed) and editable there; only the two use-facing surfaces
 * (expansion + picker) hide them.
 */
export function getAllSnippetsFlat(settings: SnipSidianSettings): SnippetItem[] {
    const snippets: SnippetItem[] = [];
    const disabled = new Set(settings.disabledGroups ?? []);

    // User snippets
    const userSnippets = settings.snippets || {};
    for (const [fullKey, replacement] of Object.entries(userSnippets)) {
        const { group, name } = splitKey(fullKey);
        if (disabled.has(group)) continue;
        snippets.push({
            id: `user:${fullKey}`,
            folder: group || "user",
            trigger: name,
            replacement
        });
    }

    return snippets;
}
