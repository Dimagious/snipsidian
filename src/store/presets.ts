import { DEFAULT_SNIPPETS } from "../presets";
import { joinKey, splitKey } from "./keys";

export { DEFAULT_SNIPPETS } from "../presets";

/** Group slug the built-in defaults are seeded and restored under.
 *  Rendered in the Snippets tab as "Defaults" via `displayGroupTitle`. */
export const DEFAULT_SNIPPETS_GROUP = "defaults";

/** `DEFAULT_SNIPPETS` re-keyed under the Defaults group
 *  (`defaults/<trigger>`). This is what first-install seeding writes
 *  (B-131) — grouped, so the shipped set shows up as one deletable
 *  unit in the Snippets tab instead of loose ungrouped entries. */
export function defaultSnippetsAsGroup(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [trigger, replacement] of Object.entries(DEFAULT_SNIPPETS)) {
        out[joinKey(DEFAULT_SNIPPETS_GROUP, trigger)] = replacement;
    }
    return out;
}

/**
 * Plan a "Restore default snippets" action: the bare
 * `{ trigger: replacement }` map of every shipped default whose
 * trigger name is absent from the current store.
 *
 * Presence is checked by trigger *name* across all groups, not by
 * full key — a user who kept a bare pre-1.2.0 `todo`, or moved
 * `todo` into their own group, must not receive a `defaults/todo`
 * duplicate (which would land in `getDict`'s collision resolution).
 * Existing entries are never overwritten; restoring a modified
 * default means deleting it first.
 *
 * Pure planning only — the caller gates the result through
 * `validatePackageForInstall` and does the `joinKey`-prefixed write.
 */
export function planRestoreDefaults(current: Record<string, string>): Record<string, string> {
    const existing = new Set(Object.keys(current).map((k) => splitKey(k).name));
    const out: Record<string, string> = {};
    for (const [trigger, replacement] of Object.entries(DEFAULT_SNIPPETS)) {
        if (!existing.has(trigger)) out[trigger] = replacement;
    }
    return out;
}
