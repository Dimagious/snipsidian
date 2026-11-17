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
 * Characters that disqualify a string from being a trigger key:
 * whitespace and every separator (`src/shared/delimiters.ts` — they
 * would split the trigger before the expander sees it), `/` and `\`
 * (the store key is `<group>/<trigger>`, S-006), and `$` (placeholder
 * syntax). Hyphen is NOT forbidden: word-bound matching handles `--`
 * and `a-b` fine (B-171). Symbols `- < > = + ~ * ^ | &` are allowed.
 */
// eslint-disable-next-line no-useless-escape -- \[ and \] are REQUIRED inside [] to match literal brackets
const FORBIDDEN_CHARS_RE = /[\s.,!?;()\[\]{}"'/\\$]/;

/**
 * Strict ASCII allowlist for triggers arriving from untrusted sources
 * (community submission + install gate): letters, digits, `:` `_` and the
 * symbols `- < > = + ~ * ^ | &`. Excludes `/` `\` `$` and all separators.
 * Shared by `package-validator.ts` so both gates stay in sync (B-171).
 */
export const TRIGGER_CHARSET_RE = /^[a-zA-Z0-9:_<>=+~*^|&-]+$/;

/**
 * Wider allowlist for the Text Snippets import only (opt-in, never used by
 * community packs): the ASCII set plus Unicode letters, combining marks
 * (nonspacing and spacing, not enclosing) and numbers, so `прив`, `δ`, `café`,
 * `日付` survive. Still excludes whitespace, `/` `\\` `$`, separators, symbols
 * and emoji (`\p{S}`), format characters (zero-width joiner/space, bidi
 * overrides `\p{Cf}`), controls and private-use. Pair it with
 * {@link TRIGGER_INVISIBLE_RE} and {@link TRIGGER_LEADING_MARK_RE}: some
 * letters and marks draw nothing.
 */
export const TRIGGER_CHARSET_UNICODE_RE = /^[\p{L}\p{Mn}\p{Mc}\p{N}:_<>=+~*^|&-]+$/u;

/** Code points that render as nothing yet pass the letter/mark classes:
 *  combining grapheme joiner, Hangul fillers (U+115F, U+1160, U+3164, U+FFA0),
 *  Khmer inherent vowels (U+17B4, U+17B5), Mongolian free variation selectors,
 *  variation selectors (BMP and supplement), Khitan filler (U+16FE4), Brahmi
 *  number joiner (U+1107F), Duployan thick letter selector (U+1BC9D), Egyptian
 *  hieroglyph mirror (U+13440). */
export const TRIGGER_INVISIBLE_RE =
    // eslint-disable-next-line no-misleading-character-class -- code points to REJECT, matched one by one
    /[\u034F\u115F\u1160\u17B4\u17B5\u180B-\u180F\u3164\uFE00-\uFE0F\uFFA0\u{16FE4}\u{1107F}\u{1BC9D}\u{13440}\u{E0100}-\u{E01EF}]/u;

/** A trigger that opens with a combining mark has nothing to attach to. */
export const TRIGGER_LEADING_MARK_RE = /^\p{M}/u;

/** Joiners that are legitimate in some scripts (Persian, Indic) but invisible;
 *  triggers with them are skipped and the skip reason names the character. */
const TRIGGER_JOINER_RE = /[\u200C\u200D]/;

/** Any other format character (soft hyphen, ZWSP, U+2060, bidi marks and overrides). */
const TRIGGER_FORMAT_RE = /\p{Cf}/u;

/** The first invisible code point in `trigger` as `U+XXXX`, or null. Covers
 *  {@link TRIGGER_INVISIBLE_RE}, the ZWNJ/ZWJ joiners and any `\p{Cf}` code point. */
export function findInvisibleTriggerChar(trigger: string): string | null {
    const m = TRIGGER_INVISIBLE_RE.exec(trigger) ??
        TRIGGER_JOINER_RE.exec(trigger) ??
        TRIGGER_FORMAT_RE.exec(trigger);
    if (!m) return null;
    const cp = m[0].codePointAt(0) ?? 0;
    return `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
}

/** True when `trigger` passes the charset: ASCII only by default, the
 *  wider Unicode set when `allowUnicodeLetters` is on (Text Snippets import). */
export function matchesTriggerCharset(trigger: string, allowUnicodeLetters = false): boolean {
    if (!allowUnicodeLetters) return TRIGGER_CHARSET_RE.test(trigger);
    return (
        TRIGGER_CHARSET_UNICODE_RE.test(trigger) &&
        !TRIGGER_INVISIBLE_RE.test(trigger) &&
        !TRIGGER_LEADING_MARK_RE.test(trigger)
    );
}

/**
 * A lone `-`, `+`, `*`, `>` or `|` would fire on every Markdown list bullet,
 * blockquote marker or table pipe. Multi-char forms (`--`, `->`, `>=`) are fine.
 */
export const SINGLE_STRUCTURAL_TRIGGER_RE = /^[-+*>|]$/;

export const SINGLE_STRUCTURAL_TRIGGER_MESSAGE =
    "a single -, +, *, > or | would rewrite Markdown lists, quotes and tables";

/** Human-readable form of `TRIGGER_CHARSET_RE` for error messages / hints. */
export const TRIGGER_CHARSET_DESCRIPTION =
    "letters, numbers, colons, underscores, and the symbols - < > = + ~ * ^ | &";

/** Human-readable form of `TRIGGER_CHARSET_UNICODE_RE`. */
export const TRIGGER_CHARSET_UNICODE_DESCRIPTION =
    "letters of any language, numbers, colons, underscores, and the symbols - < > = + ~ * ^ | &";

/** Matches keys with a colon NOT at index 0, i.e. one in the middle. */
const COLON_IN_MIDDLE_RE = /^[^:]*:.*:/;

export function isBadTrigger(key: string): boolean {
    // Allow colons at the beginning (like :plot, :scene) but not in the middle
    // Allow underscores
    if (key.length === 0) return true;

    if (FORBIDDEN_CHARS_RE.test(key)) return true;

    if (SINGLE_STRUCTURAL_TRIGGER_RE.test(key)) return true;

    // Reject `a:b:c`-style middle-colon keys (allowed: leading colon only).
    if (COLON_IN_MIDDLE_RE.test(key)) return true;

    // Also reject `a:b` where the colon is not at position 0.
    if (key.includes(":") && !key.startsWith(":")) return true;

    return false;
}
