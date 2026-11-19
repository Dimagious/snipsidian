import type { PatternRule } from "../engine/types";
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

/**
 * ADR-0008: the Espanso import writes snippets and pattern rules together. Both lists are replaced, ONE save
 * persists them, and a rejected save puts both back (each only while it is still the list this call set), so the
 * import is never half on disk or half live in memory.
 *
 * Callers must have run `validatePackageForInstall` (S-009) on `nextSnippets` and `planPatternImport` (the S-015 gate
 * and the rule cap) on `nextPatterns`; this helper does not validate.
 */
export async function commitSnippetsAndPatterns(
    settings: Pick<SnipSidianSettings, "snippets" | "patterns">,
    nextSnippets: Record<string, string>,
    nextPatterns: PatternRule[],
    save: () => Promise<void>,
): Promise<void> {
    const previousSnippets = settings.snippets;
    const previousPatterns = settings.patterns;
    settings.snippets = nextSnippets;
    settings.patterns = nextPatterns;
    try {
        await save();
    } catch (err) {
        if (settings.snippets === nextSnippets) settings.snippets = previousSnippets;
        if (settings.patterns === nextPatterns) settings.patterns = previousPatterns;
        throw err;
    }
}
