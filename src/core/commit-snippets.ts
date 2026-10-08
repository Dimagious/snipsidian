import type { SnipSidianSettings } from "../types";

/**
 * B-181: replace `settings.snippets` with `next`, persist, and roll the
 * in-memory map back if persisting fails.
 *
 * The three import/install paths used to assign the new map and then
 * `await saveSettings()`; when the save rejected, the Notice said "failed"
 * but the import stayed live in memory and the next unrelated save wrote it
 * to disk. Here the previous map object is restored (same reference) before
 * the error is rethrown, so callers keep their own error reporting.
 *
 * Callers must have already run `validatePackageForInstall` (S-009) on what
 * `next` contains — this helper does not validate.
 */
export async function commitSnippets(
    settings: Pick<SnipSidianSettings, "snippets">,
    next: Record<string, string>,
    save: () => Promise<void>,
): Promise<void> {
    const previous = settings.snippets;
    settings.snippets = next;
    try {
        await save();
    } catch (err) {
        settings.snippets = previous;
        throw err;
    }
}
