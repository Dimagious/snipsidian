import { splitKey, joinKey, displayGroupTitle } from "../../store/keys";
import type { PatternRule } from "../../engine/types";

export type SnippetMap = Record<string, string>;
export type GroupKey = string; // '' means Ungrouped

export class GroupManager {
    allGroupsFrom(map: SnippetMap): GroupKey[] {
        const s = new Set<string>();
        for (const k of Object.keys(map)) {
            const { group: g } = splitKey(k);
            s.add(g);
        }
        return Array.from(s).sort((a, b) => a.localeCompare(b));
    }

    safeRenameKey(map: SnippetMap, oldKey: string, newKey: string): { ok: boolean; reason?: string } {
        if (oldKey === newKey) return { ok: true };
        // Use hasOwnProperty.call instead of `in` so we don't false-positive on
        // inherited prototype names (e.g. renaming to `toString` or
        // `constructor`). See security S-004.
        if (Object.prototype.hasOwnProperty.call(map, newKey)) return { ok: false, reason: `Trigger "${newKey}" already exists` };
        const val = map[oldKey];
        if (val === undefined) return { ok: false, reason: "Original key missing" };
        delete map[oldKey];
        map[newKey] = val;
        return { ok: true };
    }

    bulkMoveKeys(map: SnippetMap, targetGroup: GroupKey, keys: string[]): { moved: number; skipped: number } {
        const ops: { oldKey: string; newKey: string }[] = [];
        let skipped = 0;

        for (const k of keys) {
            const { name } = splitKey(k);
            const newKey = joinKey(targetGroup, name);
            // Same prototype-chain defence as in safeRenameKey above (S-004).
            if (Object.prototype.hasOwnProperty.call(map, newKey) && !keys.includes(newKey)) {
                skipped++;
                continue;
            }
            ops.push({ oldKey: k, newKey });
        }

        let moved = 0;
        for (const { oldKey, newKey } of ops) {
            if (oldKey === newKey) continue;
            const r = this.safeRenameKey(map, oldKey, newKey);
            if (r.ok) moved++;
        }
        return { moved, skipped };
    }

    displayGroupTitle(groupKey: string): string {
        return displayGroupTitle(groupKey);
    }
}

/** What the group helpers below read and write of the settings. */
export type GroupSettings = { patterns?: PatternRule[]; disabledGroups?: string[] };

/** The group slug of a stored pattern rule; the list comes from data.json, so an entry may be anything. */
function ruleGroup(rule: unknown): unknown {
    return typeof rule === "object" && rule !== null ? Reflect.get(rule, "group") : undefined;
}

/**
 * B-265: whether a pattern rule is still filed under `group`. Snippets and pattern rules share one group namespace
 * and one `disabledGroups` list, so a snippet-side delete or rename has to know about the rules too.
 */
export function hasPatternRulesIn(settings: GroupSettings, group: string): boolean {
    return group !== "" && (settings.patterns ?? []).some((rule) => ruleGroup(rule) === group);
}

/**
 * A snippet group was deleted. Its slug leaves `disabledGroups` (B-138: a future group of the same name must not
 * inherit a stale off state), unless pattern rules are still filed under it: the rules stay (deleting snippets never
 * deletes rules) and the group stays off, or they would go live again silently (B-265).
 */
export function forgetDeletedGroup(settings: GroupSettings, group: string): void {
    if (!settings.disabledGroups?.includes(group)) return;
    if (hasPatternRulesIn(settings, group)) return;
    settings.disabledGroups = settings.disabledGroups.filter((g) => g !== group);
}

/**
 * A snippet group was renamed from `group` to `newSlug` (the snippets already moved). A group is one thing in the
 * list and on the Patterns page, so the pattern rules filed under it follow, and the off state with them (B-138):
 * the rules keep the state they had instead of being left behind under a slug nothing else uses. The rules are
 * replaced, not edited in place, so whatever caches the array by entry identity sees the change.
 *
 * `newSlug` `""` (Ungrouped): a rule without a group is always on, so moving the rules there would turn an off
 * group's rules on. They stay under the old slug, with their off state, exactly as when the group is deleted. The
 * Rename dialog cannot reach this today (it refuses an empty name); it is guarded for a future caller.
 */
export function renameGroupInSettings(settings: GroupSettings, group: string, newSlug: string): void {
    if (newSlug === "") {
        forgetDeletedGroup(settings, group);
        return;
    }
    if (settings.disabledGroups?.includes(group)) {
        const rest = settings.disabledGroups.filter((g) => g !== group);
        settings.disabledGroups = rest.includes(newSlug) ? rest : rest.concat(newSlug);
    }
    if (!hasPatternRulesIn(settings, group) || settings.patterns === undefined) return;
    settings.patterns = settings.patterns.map((rule) => {
        if (ruleGroup(rule) !== group) return rule;
        const next: PatternRule = { ...rule };
        next.group = newSlug;
        return next;
    });
}
