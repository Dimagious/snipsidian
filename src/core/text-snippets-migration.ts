import { planGroupedImport } from "./install-plan";
import { validatePackageForInstall } from "../services/package-validator";
import { joinKey } from "../store/keys";
import { textSnippetsExpansion } from "../store/migrations";
import {
    TEXT_SNIPPETS_GROUP_SLUG,
    textSnippetsDataToSnippets,
    type TextSnippetsSkip,
    type TextSnippetsWarning,
} from "../packages/text-snippets";
import type { SnipSidianSettings } from "../types";

/**
 * B-254: pure plan for the first-run migration of a Text Snippets
 * `data.json` into Snipsy settings. No I/O: the caller reads the file text
 * and decides what to write.
 */
export interface TextSnippetsMigrationPlan {
    /** What `loadSettings` should keep. On failure: no snippets, the mapped
     *  expansion options only (and the caller must not persist it). */
    settings: SnipSidianSettings;
    /** `false` when the data could not be converted; `error` says why. */
    ok: boolean;
    error?: string;
    importedCount: number;
    skipped: TextSnippetsSkip[];
    warnings: TextSnippetsWarning[];
    notes: string[];
}

export function planTextSnippetsMigration(
    data: Record<string, unknown>,
    jsonText: string,
): TextSnippetsMigrationPlan {
    const expansion = textSnippetsExpansion(data);
    const failed = (error: string): TextSnippetsMigrationPlan => ({
        settings: { snippets: {}, expansion },
        ok: false,
        error,
        importedCount: 0,
        skipped: [],
        warnings: [],
        notes: [],
    });

    let parsed;
    try {
        parsed = textSnippetsDataToSnippets(jsonText);
    } catch (err) {
        return failed(err instanceof Error ? err.message : String(err));
    }

    // S-009: the same gate as the import UI, with ONE reasoned exception
    // (S-010 precedent): the 500-snippet COUNT cap is lifted. This is the
    // user's own library, converted once on load; refusing it would strand
    // the original file behind a limit meant for untrusted community packs.
    // Everything else stays: per-entry trigger length/charset and replacement
    // length (a failing entry is skipped and reported, the rest imports) and
    // the 2 MiB total-size cap (fails the whole migration, original untouched).
    const gate = { allowUnicodeLetters: true, maxSnippets: Infinity };
    const skipped = [...parsed.skipped];
    const acceptedEntries: Array<[string, string]> = [];
    for (const [trigger, replace] of Object.entries(parsed.snippets)) {
        const check = validatePackageForInstall(
            { label: TEXT_SNIPPETS_GROUP_SLUG, snippets: { [trigger]: replace } },
            gate,
        );
        if (check.isValid) acceptedEntries.push([trigger, replace]);
        else skipped.push({ trigger, reason: check.errors[0] ?? "Failed validation" });
    }
    // fromEntries defines own properties (S-008, write side).
    const accepted: Record<string, string> = Object.fromEntries(acceptedEntries);
    const warnings = parsed.warnings.filter((w) => Object.prototype.hasOwnProperty.call(accepted, w.trigger));

    // Nothing convertible (an empty file, or only skipped records): the
    // validator rejects an empty package, but this is a valid, empty library.
    if (acceptedEntries.length === 0) {
        return { settings: { snippets: {}, expansion }, ok: true, importedCount: 0, skipped, warnings, notes: parsed.notes };
    }

    // The store is empty here, so no cross-group collisions are possible.
    const plan = planGroupedImport(accepted, TEXT_SNIPPETS_GROUP_SLUG, { snippets: {} }, gate);
    if (!plan.validation.isValid) {
        const first = plan.validation.errors[0] ?? "Import failed validation";
        const more = plan.validation.errors.length > 1 ? ` (and ${plan.validation.errors.length - 1} more)` : "";
        return failed(`${first}${more}`);
    }

    // fromEntries defines own properties (S-008, write side).
    const snippets = Object.fromEntries(
        Object.entries(plan.importable).map(([trigger, replace]): [string, string] => [
            joinKey(TEXT_SNIPPETS_GROUP_SLUG, trigger),
            replace,
        ]),
    );
    return {
        settings: { snippets, expansion },
        ok: true,
        importedCount: Object.keys(snippets).length,
        skipped,
        warnings,
        notes: parsed.notes,
    };
}
