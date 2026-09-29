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
/**
 * Counts for the declarative Snippets page entry's `desc`/`displayValue`
 * ("N snippets in M groups", B-151/ADR-0007). `groups` counts only
 * real (non-empty) group slugs — "Ungrouped" (`group === ""`) isn't a
 * group from the user's perspective (`SnippetsTab` titles it
 * specially and it has no rename/delete/mute affordances), so it's
 * excluded here too.
 */
export function countSnippetsAndGroups(settings: SnipSidianSettings): { snippets: number; groups: number } {
    const keys = Object.keys(settings.snippets || {});
    const groupSlugs = new Set<string>();
    for (const key of keys) {
        const { group } = splitKey(key);
        if (group) groupSlugs.add(group);
    }
    return { snippets: keys.length, groups: groupSlugs.size };
}

/** How many of the store's real (non-empty, non-"Ungrouped") groups
 *  are currently muted (`settings.disabledGroups`). Only counts a
 *  disabled group slug that actually has at least one snippet under
 *  it right now — a stale `disabledGroups` entry left over from a
 *  deleted/renamed group shouldn't inflate the "(k muted)" hint. */
function countMutedGroups(settings: SnipSidianSettings): number {
    const disabled = settings.disabledGroups ?? [];
    if (disabled.length === 0) return 0;
    const present = new Set<string>();
    for (const key of Object.keys(settings.snippets || {})) {
        const { group } = splitKey(key);
        if (group) present.add(group);
    }
    let count = 0;
    for (const group of disabled) {
        if (present.has(group)) count++;
    }
    return count;
}

/**
 * Human-readable summary for the declarative Snippets page entry's
 * `desc`/`displayValue` (B-151/ADR-0007, finding #6): correct
 * singular/plural at every boundary, and doesn't claim "in M groups"
 * when there are none — this is the same "Ungrouped" exclusion
 * `countSnippetsAndGroups` already applies (consistent with what the
 * Snippets page itself shows: "Ungrouped" has no rename/mute/delete
 * affordance and isn't a group from the user's perspective).
 *
 * Boundaries pinned by `snippets.test.ts`:
 *   0 snippets            → "No snippets"
 *   1 snippet, no groups  → "1 snippet"
 *   N snippets, no groups → "N snippets"
 *   N snippets, M groups  → "N snippets in M groups"
 *   any muted groups      → "... (K muted)" appended
 */
export function formatSnippetsSummary(settings: SnipSidianSettings): string {
    const { snippets, groups } = countSnippetsAndGroups(settings);
    const base =
        snippets === 0
            ? "No snippets"
            : groups === 0
              ? `${snippets} snippet${snippets === 1 ? "" : "s"}`
              : `${snippets} snippet${snippets === 1 ? "" : "s"} in ${groups} group${groups === 1 ? "" : "s"}`;
    const muted = countMutedGroups(settings);
    return muted > 0 ? `${base} (${muted} muted)` : base;
}

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
