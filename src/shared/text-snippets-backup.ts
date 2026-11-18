import type { DataAdapter } from "obsidian";

/** Name of the copy of the original Text Snippets `data.json`. */
export const TEXT_SNIPPETS_BACKUP_BASE = "text-snippets-backup";

/** `text-snippets-backup.json` is attempt 1, `text-snippets-backup-N.json` attempt N. */
const BACKUP_FILE_RE = /^text-snippets-backup(?:-(\d+))?\.json$/;

/** Path of backup attempt `n` (1-based) inside `dir`. */
export function textSnippetsBackupPath(dir: string, n: number): string {
    return `${dir}/${TEXT_SNIPPETS_BACKUP_BASE}${n === 1 ? "" : `-${n}`}.json`;
}

/**
 * Path of the newest `text-snippets-backup*.json` in `dir` (the highest
 * attempt number: backups are never overwritten, so a later write always gets
 * a higher number), or `null` when there is none. A failing `list` rejects.
 */
export async function findLatestTextSnippetsBackup(adapter: DataAdapter, dir: string): Promise<string | null> {
    const listed = await adapter.list(dir);
    let best = 0;
    for (const file of listed.files) {
        const name = file.slice(file.lastIndexOf("/") + 1);
        const m = BACKUP_FILE_RE.exec(name);
        if (!m) continue;
        const n = m[1] === undefined ? 1 : Number(m[1]);
        if (n > best) best = n;
    }
    return best === 0 ? null : textSnippetsBackupPath(dir, best);
}
