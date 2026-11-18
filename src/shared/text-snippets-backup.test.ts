import { describe, it, expect } from "vitest";
import type { DataAdapter } from "obsidian";
import { findLatestTextSnippetsBackup, textSnippetsBackupPath } from "./text-snippets-backup";

const DIR = ".cfg/plugins/text-snippets-obsidian";

function adapterWith(files: string[]): DataAdapter {
    return { list: async () => ({ files, folders: [] }) } as unknown as DataAdapter;
}

describe("shared/text-snippets-backup", () => {
    it("builds attempt 1 without a number and later attempts with one", () => {
        expect(textSnippetsBackupPath(DIR, 1)).toBe(`${DIR}/text-snippets-backup.json`);
        expect(textSnippetsBackupPath(DIR, 3)).toBe(`${DIR}/text-snippets-backup-3.json`);
    });

    it("returns null when there is no backup, whatever else lives in the folder", async () => {
        const a = adapterWith([`${DIR}/data.json`, `${DIR}/main.js`, `${DIR}/text-snippets-backup.json.bak`, `${DIR}/text-snippets-backup-.json`]);
        expect(await findLatestTextSnippetsBackup(a, DIR)).toBeNull();
    });

    it("picks the highest number numerically (10 beats 9) and ranks the unnumbered file first", async () => {
        const a = adapterWith([`${DIR}/text-snippets-backup-9.json`, `${DIR}/text-snippets-backup-10.json`, `${DIR}/text-snippets-backup.json`]);
        expect(await findLatestTextSnippetsBackup(a, DIR)).toBe(`${DIR}/text-snippets-backup-10.json`);
        expect(await findLatestTextSnippetsBackup(adapterWith([`${DIR}/text-snippets-backup.json`]), DIR)).toBe(`${DIR}/text-snippets-backup.json`);
    });

    it("propagates a failing list", async () => {
        const a = { list: () => Promise.reject(new Error("nope")) } as unknown as DataAdapter;
        await expect(findLatestTextSnippetsBackup(a, DIR)).rejects.toThrow("nope");
    });
});
