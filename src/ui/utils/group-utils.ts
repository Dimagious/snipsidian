import { splitKey, joinKey, displayGroupTitle } from "../../services/utils";

export type SnippetMap = Record<string, string>;
export type GroupKey = string; // '' means Ungrouped

export class GroupManager {
    constructor(private snippets: SnippetMap) {}

    allGroupsFrom(map: SnippetMap): GroupKey[] {
        const s = new Set<string>();
        for (const k of Object.keys(map)) {
            const g = k.includes("/") ? k.split("/", 1)[0] ?? "Ungrouped" : "Ungrouped";
            s.add(g);
        }
        return Array.from(s).sort((a, b) => a.localeCompare(b));
    }

    safeRenameKey(map: SnippetMap, oldKey: string, newKey: string): { ok: boolean; reason?: string } {
        if (oldKey === newKey) return { ok: true };
        if (newKey in map) return { ok: false, reason: `Trigger "${newKey}" already exists` };
        const val = map[oldKey];
        if (val === undefined) return { ok: false, reason: "Original key missing" };
        delete map[oldKey];
        map[newKey] = val;
        return { ok: true };
    }

    bulkMoveKeys(targetGroup: GroupKey, keys: string[]): { moved: number; skipped: number } {
        const map = this.snippets;
        const ops: { oldKey: string; newKey: string }[] = [];
        let skipped = 0;

        for (const k of keys) {
            const { name } = splitKey(k);
            const newKey = joinKey(targetGroup, name);
            if (newKey in map && !keys.includes(newKey)) {
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

    promptNewGroup(initial = ""): GroupKey | null {
        const label = prompt("New group name:", initial);
        if (label === null) return null; // cancelled
        return label.trim() || "";
    }

    displayGroupTitle(groupKey: string): string {
        return displayGroupTitle(groupKey);
    }
}
