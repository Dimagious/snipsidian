export type DiffResult = {
    added: Array<{ key: string; value: string }>;
    conflicts: Array<{ key: string; incoming: string; current: string }>;
};

export function diffIncoming(
    incoming: Record<string, string>,
    current: Record<string, string>
): DiffResult {
    const added: DiffResult["added"] = [];
    const conflicts: DiffResult["conflicts"] = [];
    for (const [k, v] of Object.entries(incoming)) {
        if (current[k] === undefined) {
            added.push({ key: k, value: v });
            continue;
        }
        if (current[k] !== v) {
            conflicts.push({ key: k, incoming: v, current: current[k] });
        }
    }
    return { added, conflicts };
}

// `isRecordOfString` moved to `src/shared/guards.ts` in 1.0.9.
// Trigger helpers (`normalizeTrigger`, `isBadTrigger`) moved to
// `src/engine/triggers.ts` in 1.1.6 (B-026 + B-072 regex lift).

// Key helpers (`splitKey`, `joinKey`, `slugifyGroup`, `displayGroupTitle`)
// moved to `src/store/keys.ts` in 1.1.6 (B-026).
