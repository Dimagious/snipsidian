/**
 * Trigger-key normalisation and validation.
 *
 * Triggers are the user-typed strings that the expander watches for
 * between separators (see `src/shared/delimiters.ts`). Normalising
 * and validating them is an `engine/` concern — these helpers live
 * here so all the install paths (community packages, Espanso import,
 * Settings Add-snippet) call the same shape-check.
 *
 * Moved from `services/utils.ts` in 1.1.6 (B-026); regex literals
 * lifted out of `isBadTrigger`'s function body in the same change
 * (B-072) since the function runs on the per-keystroke hot path.
 */

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
 * both community packages and Espanso imports call before writing
 * to `settings.snippets`.
 */
export function normalizeTrigger(raw: string): string {
    return raw.trim().replace(/^:+/, "").replace(/:+$/, "");
}

/**
 * Characters that disqualify a string from being a trigger key.
 * Whitespace, punctuation, brackets, quotes, slashes, backslash, hyphen
 * — anything that would break the separator-walking expander or the
 * `<group>/<trigger>` key shape downstream.
 */
// eslint-disable-next-line no-useless-escape -- \[ and \] are REQUIRED inside [] to match literal brackets
const FORBIDDEN_CHARS_RE = /[\s.,!?;()\[\]{}"'/\\-]/;

/** Matches keys with a colon NOT at index 0, i.e. one in the middle. */
const COLON_IN_MIDDLE_RE = /^[^:]*:.*:/;

export function isBadTrigger(key: string): boolean {
    // Allow colons at the beginning (like :plot, :scene) but not in the middle
    // Allow underscores
    if (key.length === 0) return true;

    if (FORBIDDEN_CHARS_RE.test(key)) return true;

    // Reject `a:b:c`-style middle-colon keys (allowed: leading colon only).
    if (COLON_IN_MIDDLE_RE.test(key)) return true;

    // Also reject `a:b` where the colon is not at position 0.
    if (key.includes(":") && !key.startsWith(":")) return true;

    return false;
}
