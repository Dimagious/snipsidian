import { Notice } from "obsidian";
import type { DataAdapter } from "obsidian";
import { planTextSnippetsMigration } from "../core/text-snippets-migration";
import { sanitizeForNotice } from "../shared/notice-text";
import { textSnippetsBackupPath } from "../shared/text-snippets-backup";
import type { SnipSidianSettings } from "../types";

/** How many `-2`, `-3`... names are tried before giving up. */
const BACKUP_MAX_TRIES = 50;

/**
 * Writes `raw` next to `data.json` and returns the path. Never overwrites: an
 * existing backup (an earlier migration) pushes this one to the next free
 * name. Throws when no name is free or the write fails.
 */
export async function backupOriginalData(adapter: DataAdapter, dir: string, raw: string): Promise<string> {
    for (let n = 1; n <= BACKUP_MAX_TRIES; n++) {
        const path = textSnippetsBackupPath(dir, n);
        if (await adapter.exists(path)) continue;
        await adapter.write(path, raw);
        return path;
    }
    throw new Error(`${BACKUP_MAX_TRIES} backup files already exist in ${dir}`);
}

export interface TextSnippetsMigrationOutcome {
    settings: SnipSidianSettings;
    /** True when `settings` may be written over `data.json` (the original is
     *  backed up and the conversion succeeded). */
    save: boolean;
    /** The original file text while it is NOT backed up yet: every save must
     *  retry the backup first, or it would destroy the only copy. Set on
     *  EVERY branch that leaves the original unsaved over (failed conversion,
     *  failed backup). */
    unsavedOriginal: string | null;
}

/**
 * B-254: data.json that is neither Snipsy's nor Text Snippets' shape, found
 * under the compatibility id. The caller is about to treat the install as
 * fresh and save over it, so the file is backed up first (never overwriting
 * an existing backup). Same outcome contract as the migration: on a failed
 * backup `unsavedOriginal` is armed and `save` is `false`.
 */
export async function protectUnknownData(deps: {
    adapter: DataAdapter;
    dir: string;
    loaded: unknown;
}): Promise<{ save: boolean; unsavedOriginal: string | null }> {
    const { adapter, dir, loaded } = deps;
    let raw: string;
    try {
        raw = await adapter.read(`${dir}/data.json`);
    } catch {
        raw = JSON.stringify(loaded) ?? String(loaded);
    }
    try {
        const path = await backupOriginalData(adapter, dir, raw);
        new Notice(`Snipsy found a settings file it does not recognise and saved a copy as ${path}.`, 15000);
        return { save: true, unsavedOriginal: null };
    } catch (err) {
        const reason = sanitizeForNotice(err instanceof Error ? err.message : String(err));
        new Notice(
            `Snipsy could not back up an unrecognised settings file (${reason}). It was left untouched; settings are kept for this session only.`,
            15000,
        );
        console.error("[snipsy] backup of unrecognised data failed", { dir, error: err });
        return { save: false, unsavedOriginal: raw };
    }
}

/**
 * B-254: first-run migration of a Text Snippets `data.json`.
 *
 * Order matters: convert first (pure, nothing written), then back up the
 * original, and only then let the caller save over it. A conversion that
 * fails leaves the file untouched (and writes no backup, so a retry on every
 * start does not litter the folder); a backup that fails does the same and
 * the settings stay in memory only.
 */
export async function migrateTextSnippetsData(deps: {
    adapter: DataAdapter;
    dir: string;
    saved: Record<string, unknown>;
}): Promise<TextSnippetsMigrationOutcome> {
    const { adapter, dir, saved } = deps;
    const dataPath = `${dir}/data.json`;

    // The backup must be the file as it is on disk; `loadData` only hands
    // back parsed JSON. Re-serializing it is the fallback when the read fails.
    let raw: string;
    try {
        raw = await adapter.read(dataPath);
    } catch {
        raw = JSON.stringify(saved);
    }

    const plan = planTextSnippetsMigration(saved, raw);
    if (!plan.ok) {
        const reason = sanitizeForNotice(plan.error ?? "unknown error");
        new Notice(
            `Snipsy could not convert the Text Snippets data (${reason}). The original file was left untouched; a copy is saved before anything is written over it. Once that copy exists, import from it in Settings, Packages, Text Snippets import.`,
            15000,
        );
        console.error("[snipsy] Text Snippets migration failed", { error: plan.error });
        // Armed: the next save of any setting would otherwise overwrite the
        // unconverted file with an empty library and no backup at all.
        return { settings: plan.settings, save: false, unsavedOriginal: raw };
    }

    let backupPath: string;
    try {
        backupPath = await backupOriginalData(adapter, dir, raw);
    } catch (err) {
        const reason = sanitizeForNotice(err instanceof Error ? err.message : String(err));
        new Notice(
            `Snipsy could not back up the Text Snippets data (${reason}). The original file was left untouched; your snippets are loaded for this session only.`,
            15000,
        );
        console.error("[snipsy] Text Snippets backup failed", { dir, error: err });
        return { settings: plan.settings, save: false, unsavedOriginal: raw };
    }

    const parts = [`${plan.importedCount} imported`];
    if (plan.skipped.length > 0) parts.push(`${plan.skipped.length} skipped`);
    if (plan.warnings.length > 0) parts.push(`${plan.warnings.length} changed`);
    new Notice(
        `Snipsy imported your Text Snippets settings: ${parts.join(", ")}. Original saved as ${backupPath}. Details are in the developer console.`,
        15000,
    );
    // The full report: untrusted text goes to the console only, never the DOM.
    // `warn`, not `info`: the lint rule allows only error/warn/debug, and
    // debug is hidden by default in the developer console.
    console.warn("[snipsy] Text Snippets migration", {
        backupPath,
        imported: plan.importedCount,
        skipped: plan.skipped,
        warnings: plan.warnings,
        notes: plan.notes,
    });
    return { settings: plan.settings, save: true, unsavedOriginal: null };
}
