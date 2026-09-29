/**
 * B-034: sanitizes untrusted error text before it reaches a `Notice`.
 *
 * `Notice` renders its message as-is — Obsidian doesn't escape or
 * clamp it. Parser error messages (the `yaml` package's
 * `YAMLParseError`, `JSON.parse`'s `SyntaxError`) routinely embed a
 * slice of the OFFENDING SOURCE TEXT itself (a pretty-printed context
 * excerpt with a `^` pointer, for `yaml`; the raw bad character run,
 * for some `JSON.parse` implementations) — and that source is
 * whatever the user pasted or picked as a file, i.e. untrusted. A
 * paste containing control characters (stray bytes from a bad
 * clipboard capture, a deliberately hostile package a user is asked
 * to paste) could carry them straight into the Notice's DOM text node
 * unmodified, and an adversarial or just very large paste can make
 * the message enormous. Neither is a settings-write path (B-009's
 * `validatePackageForInstall` gate is untouched and still runs before
 * any write), but a message this is still worth capping before it
 * reaches the DOM.
 *
 * Call sites (all parse/validate error text on an untrusted-input
 * path, before it's interpolated into a `new Notice(...)` string):
 * `EspansoSection.ts` (YAML parse errors from `espansoYamlToSnippets`),
 * `PackageBrowser.ts` (install-time validation errors, which can echo
 * back untrusted trigger/replacement text), `BasicTab.ts` (JSON parse
 * errors from the Import snippets flow).
 */

/** C0 controls (`\x00`-`\x1F`) except plain space, plus DEL (`\x7F`)
 *  and the C1 control block (`\x80`-`\x9F`). Newlines/tabs are
 *  stripped too — a Notice is meant to read as one line of text, and
 *  a multi-line "helpful" YAML context excerpt is exactly the kind of
 *  noisy payload this function exists to cut down. */
// eslint-disable-next-line no-control-regex -- deliberately matching control characters to strip them
const CONTROL_CHARS = /[\x00-\x1F\x7F-\x9F]/g;

const DEFAULT_MAX_LENGTH = 300;

/**
 * Strips control characters and collapses runs of whitespace left
 * behind, then truncates to `maxLength` with a trailing ellipsis
 * marker so the user can tell the message was cut short. Pure — safe
 * to call on any string, including one that's already clean (a no-op
 * in that case beyond whitespace collapsing).
 */
export function sanitizeForNotice(text: string, maxLength: number = DEFAULT_MAX_LENGTH): string {
    const stripped = text.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
    if (stripped.length <= maxLength) return stripped;
    return `${stripped.slice(0, maxLength).trimEnd()}…`;
}

const DEFAULT_MAX_SHOWN = 5;
const PER_ITEM_MAX_LENGTH = 60;

/**
 * B-034 (finding #7): a caller-supplied list of untrusted names —
 * e.g. Espanso's `plan.collisions` (bare trigger names parsed straight
 * out of pasted YAML, `EspansoSection.ts`) — joined into a Notice
 * unbounded. Every install/import path already sanitizes its
 * VALIDATION ERROR text before the Notice (`sanitizeForNotice`
 * above); this covers the sibling case of listing several individual
 * untrusted names inline, where neither the per-item length nor the
 * list length was previously capped — a package with hundreds of
 * colliding triggers (or one absurdly long trigger) could otherwise
 * still produce an oversized/garbled Notice even with each string
 * technically "sanitized" on its own.
 *
 * Sanitizes each shown name individually (control chars stripped,
 * capped at `PER_ITEM_MAX_LENGTH`) and caps the list itself at
 * `maxShown` entries, appending `(and N more)` for the rest —
 * mirrors the "first 5, and N more" pattern
 * `PackageBrowser.uninstallPackage` already uses for its own (trusted,
 * already-installed) trigger list.
 */
export function formatTriggerList(names: string[], maxShown: number = DEFAULT_MAX_SHOWN): string {
    const shown = names.slice(0, maxShown).map((name) => sanitizeForNotice(name, PER_ITEM_MAX_LENGTH));
    const remaining = names.length - shown.length;
    const joined = shown.join(", ");
    return remaining > 0 ? `${joined} (and ${remaining} more)` : joined;
}
