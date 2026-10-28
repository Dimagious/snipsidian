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

import {
    SINGLE_STRUCTURAL_TRIGGER_MESSAGE,
    SINGLE_STRUCTURAL_TRIGGER_RE,
    isBadTrigger,
    normalizeTrigger,
} from "../engine/triggers";
import { splitKey } from "../store/keys";
import { INSTALL_MAX_REPLACEMENT_LEN, INSTALL_MAX_TRIGGER_LEN } from "./package-validator";

/** An incoming key the import refuses to write, with the reason shown in the preview. */
export interface RejectedImportKey {
    key: string;
    reason: string;
}

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
    /** Incoming keys refused by the trigger / replacement checks (B-177). */
    rejected: RejectedImportKey[];
}

function hasOwn(map: Record<string, string>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(map, key);
}

/**
 * Why an incoming key must not be written, or `null` if it is fine.
 *
 * B-177: JSON import used to write whatever the file held, so a
 * hand-edited file could install a bare `-` (fires on every list
 * bullet) or a trigger with a `$`. The key is `<group>/<trigger>`, so
 * the checks run on the trigger part only. Leading and trailing colons are
 * ignored for the check: a trigger such as `:smile:` can never fire (B-183),
 * but it is imported as-is so the "Fix triggers" flow can offer the rename.
 * A colon in the middle (`a:b`) cannot be repaired, so it is rejected.
 * Deliberately NO count cap and NO total-bytes cap here (S-010):
 * libraries over 500 are legit.
 *
 * S-014: JSON import was a write path into `settings.snippets` without the
 * per-entry rules of `validatePackageForInstall` (S-009 sibling); this is
 * the parity gate for them (trigger charset/length, replacement length).
 */
export function importKeyRejection(key: string, value: string): string | null {
    const rawName = splitKey(key).name;
    const name = normalizeTrigger(rawName);
    if (name.length === 0) return "empty trigger";
    if (rawName.length > INSTALL_MAX_TRIGGER_LEN) {
        return `trigger is longer than ${INSTALL_MAX_TRIGGER_LEN} characters`;
    }
    if (SINGLE_STRUCTURAL_TRIGGER_RE.test(name)) return SINGLE_STRUCTURAL_TRIGGER_MESSAGE;
    if (isBadTrigger(name)) {
        return "trigger contains spaces, separators or characters Snipsy can't use";
    }
    // S-013: same per-replacement cap as install, Espanso and Settings add/edit.
    if (value.length > INSTALL_MAX_REPLACEMENT_LEN) {
        return `replacement is ${value.length.toLocaleString("en-US")} characters; the limit is ${INSTALL_MAX_REPLACEMENT_LEN.toLocaleString("en-US")}`;
    }
    return null;
}

/**
 * Splits an incoming import into keys that may be written and keys that
 * are refused. `accepted` is built with `Object.fromEntries` (own data
 * properties), so a `__proto__` key stays a plain key and never touches
 * the prototype (S-004).
 */
export function filterImportKeys(incoming: Record<string, string>): {
    accepted: Record<string, string>;
    rejected: RejectedImportKey[];
} {
    const ok: Array<[string, string]> = [];
    const rejected: RejectedImportKey[] = [];
    for (const [key, value] of Object.entries(incoming)) {
        const reason = importKeyRejection(key, value);
        if (reason === null) ok.push([key, value]);
        else rejected.push({ key, reason });
    }
    rejected.sort((a, b) => a.key.localeCompare(b.key));
    return { accepted: Object.fromEntries(ok), rejected };
}

/**
 * Replace mode: current entries whose key the file also holds but that are
 * rejected there (legacy `work/todo.`, an oversize replacement). They keep
 * their CURRENT value instead of being deleted, so Replace all never loses
 * an entry only because the import refuses to rewrite it.
 */
export function currentValuesForRejected(
    current: Record<string, string>,
    rejected: readonly RejectedImportKey[],
): Record<string, string> {
    return Object.fromEntries(
        rejected.filter((r) => hasOwn(current, r.key)).map((r) => [r.key, current[r.key] ?? ""]),
    );
}

export function computeImportDiff(
    current: Record<string, string>,
    rawIncoming: Record<string, string>,
): ImportDiff {
    const { accepted: incoming, rejected } = filterImportKeys(rawIncoming);
    const added: Array<{ key: string; value: string }> = [];
    const conflicts: Array<{ key: string; current: string; incoming: string }> = [];
    const removed: Array<{ key: string; value: string }> = [];
    let unchangedCount = 0;

    for (const [key, value] of Object.entries(incoming)) {
        // S-004/S-008: untrusted keys, so own-property lookups only.
        if (!hasOwn(current, key)) {
            added.push({ key, value });
        } else if (current[key] !== value) {
            conflicts.push({ key, current: current[key] ?? "", incoming: value });
        } else {
            unchangedCount++;
        }
    }

    for (const [key, value] of Object.entries(current)) {
        // A key the file holds but the import rejects is kept, not removed.
        if (!hasOwn(incoming, key) && !hasOwn(rawIncoming, key)) {
            removed.push({ key, value });
        }
    }

    // Deterministic ordering so the modal list is stable across renders
    // and snapshot tests are reliable.
    added.sort((a, b) => a.key.localeCompare(b.key));
    conflicts.sort((a, b) => a.key.localeCompare(b.key));
    removed.sort((a, b) => a.key.localeCompare(b.key));

    return { added, conflicts, removed, unchangedCount, rejected };
}
