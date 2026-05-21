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

/**
 * Normalise a trigger key for storage in Snipsy's settings.
 *
 * Espanso convention is `:foo` or `:foo:` (leading colon, sometimes
 * trailing too). Snipsy's engine treats `:` as a separator
 * (`src/shared/delimiters.ts`), so a stored key like `:foo:` is
 * unreachable — typing `:foo:<space>` produces an empty trigger
 * candidate, and typing `:foo<space>` produces candidate `foo`.
 *
 * Strip leading + trailing colons so the stored key is what the
 * engine will actually match. This is what the install paths for
 * both community packages and Espanso imports should call before
 * writing to `settings.snippets`.
 *
 * B-117 — pair this with `convertSnippetsToObject` in
 * `community-packages.ts` so any pack shipped with Espanso-style
 * trigger keys works on install instead of dying silently.
 */
export function normalizeTrigger(raw: string): string {
    return raw.trim().replace(/^:+/, "").replace(/:+$/, "");
}

export function isBadTrigger(key: string): boolean {
    // Allow colons at the beginning (like :plot, :scene) but not in the middle
    // Allow underscores and hyphens
    if (key.length === 0) return true;
    
    // Check for forbidden characters (but allow colon at the beginning)
    // eslint-disable-next-line no-useless-escape -- \[ and \] are REQUIRED inside [] to match literal brackets
    if (/[\s.,!?;()\[\]{}"'/\\-]/.test(key)) return true;
    
    // Check for colon in the middle (not at the beginning)
    // This regex matches: start of string, any non-colon chars, colon, any chars, colon
    if (/^[^:]*:.*:/.test(key)) return true;
    
    // Also check for colon not at the beginning (like "a:b")
    if (key.includes(':') && !key.startsWith(':')) return true;
    
    return false;
}

// Key helpers (`splitKey`, `joinKey`, `slugifyGroup`, `displayGroupTitle`)
// moved to `src/store/keys.ts` in 1.1.6 (B-026).
