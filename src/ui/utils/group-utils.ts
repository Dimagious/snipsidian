import { splitKey, joinKey, displayGroupTitle } from "../../services/utils";

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
