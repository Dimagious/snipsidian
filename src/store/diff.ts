/**
 * Diff helpers for snippet maps.
 *
 * Given an `incoming` set of `<key, replacement>` pairs and the
 * `current` settings.snippets, classify each incoming pair as either
 * "added" (key didn't exist before) or "conflict" (key existed with a
 * different replacement). Equal-value re-imports are dropped silently
 * — they wouldn't change anything anyway.
 *
 * Used by:
 *   - the Espanso import flow (`ui/components/community/EspansoSection`)
 *   - `PackagePreviewModal` (consumes the resulting `DiffResult`)
 *
 * The community-packages install path (`PackageBrowser.buildPackageDiff`,
 * coming to `core/install-plan` in PR 2 of 1.1.6) builds on top of
 * this by prefixing each incoming trigger with `joinKey(packageGroup, …)`
 * before diffing.
 *
 * Moved from `services/utils.ts` in 1.1.6 (B-026).
 */

export type DiffResult = {
    added: Array<{ key: string; value: string }>;
    conflicts: Array<{ key: string; incoming: string; current: string }>;
};

export function diffIncoming(
    incoming: Record<string, string>,
    current: Record<string, string>,
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
