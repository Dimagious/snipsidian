/**
 * Pure diff between the current snippet library and a parsed import
 * file. Used by `ImportPreviewModal` so the user can see what will
 * change before committing — replaces the silent
 * `settings.snippets = parsed; saveSettings()` that previously
 * wiped people's libraries (B-038).
 *
 * Kept pure (no Obsidian, no DOM) so it can be unit-tested at the
 * contract level per ADR-0005. The modal is responsible for
 * rendering; the caller is responsible for the write.
 */

export interface ImportDiff {
    /** Keys present in `incoming` but not in `current`. */
    added: Array<{ key: string; value: string }>;
    /** Keys in both, with different values. */
    conflicts: Array<{ key: string; current: string; incoming: string }>;
    /** Keys present in `current` but not in `incoming`. Only matters
     *  for replace mode — in merge mode these are kept. */
    removed: Array<{ key: string; value: string }>;
    /** Keys in both, identical value. Counted, not enumerated. */
    unchangedCount: number;
}

export function computeImportDiff(
    current: Record<string, string>,
    incoming: Record<string, string>,
): ImportDiff {
    const added: Array<{ key: string; value: string }> = [];
    const conflicts: Array<{ key: string; current: string; incoming: string }> = [];
    const removed: Array<{ key: string; value: string }> = [];
    let unchangedCount = 0;

    for (const [key, value] of Object.entries(incoming)) {
        if (!(key in current)) {
            added.push({ key, value });
        } else if (current[key] !== value) {
            conflicts.push({ key, current: current[key] ?? "", incoming: value });
        } else {
            unchangedCount++;
        }
    }

    for (const [key, value] of Object.entries(current)) {
        if (!(key in incoming)) {
            removed.push({ key, value });
        }
    }

    // Deterministic ordering so the modal list is stable across renders
    // and snapshot tests are reliable.
    added.sort((a, b) => a.key.localeCompare(b.key));
    conflicts.sort((a, b) => a.key.localeCompare(b.key));
    removed.sort((a, b) => a.key.localeCompare(b.key));

    return { added, conflicts, removed, unchangedCount };
}
