import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DataAdapter } from "obsidian";

const notices = vi.hoisted(() => [] as string[]);
vi.mock("obsidian", async () => {
    const actual = await vi.importActual("../test/stubs/obsidian");
    return {
        ...actual,
        Notice: vi.fn().mockImplementation(function (msg: string) {
            notices.push(msg);
        }),
    };
});

import { backupOriginalData, migrateTextSnippetsData, protectUnknownData } from "./text-snippets-migration";

const DIR = ".obsidian/plugins/text-snippets-obsidian";

/** In-memory vault adapter. `failWrite` makes every write reject. */
class FakeAdapter {
    files = new Map<string, string>();
    failWrite = false;
    failRead = false;
    writes: string[] = [];
    exists = (path: string): Promise<boolean> => Promise.resolve(this.files.has(path));
    read = (path: string): Promise<string> => {
        const text = this.files.get(path);
        if (this.failRead || text === undefined) return Promise.reject(new Error("read failed"));
        return Promise.resolve(text);
    };
    write = (path: string, data: string): Promise<void> => {
        if (this.failWrite) return Promise.reject(new Error("disk full"));
        this.writes.push(path);
        this.files.set(path, data);
        return Promise.resolve();
    };
}

function asAdapter(a: FakeAdapter): DataAdapter {
    return a as unknown as DataAdapter;
}

const ORIGINAL = '{\n  "snippets_file": "brb : be right back",\n  "useTab": true\n}';

function setup(original = ORIGINAL): { adapter: FakeAdapter; saved: Record<string, unknown> } {
    const adapter = new FakeAdapter();
    adapter.files.set(`${DIR}/data.json`, original);
    return { adapter, saved: JSON.parse(original) as Record<string, unknown> };
}

beforeEach(() => {
    notices.length = 0;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("app/text-snippets-migration: backupOriginalData", () => {
    it("writes the text next to data.json", async () => {
        const a = new FakeAdapter();
        const path = await backupOriginalData(asAdapter(a), DIR, "raw");
        expect(path).toBe(`${DIR}/text-snippets-backup.json`);
        expect(a.files.get(path)).toBe("raw");
    });

    it("never overwrites an existing backup: picks the next free name", async () => {
        const a = new FakeAdapter();
        a.files.set(`${DIR}/text-snippets-backup.json`, "older");
        a.files.set(`${DIR}/text-snippets-backup-2.json`, "older too");
        const path = await backupOriginalData(asAdapter(a), DIR, "raw");
        expect(path).toBe(`${DIR}/text-snippets-backup-3.json`);
        expect(a.files.get(`${DIR}/text-snippets-backup.json`)).toBe("older");
        expect(a.files.get(`${DIR}/text-snippets-backup-2.json`)).toBe("older too");
    });

    it("gives up (throws) when every name is taken", async () => {
        const a = new FakeAdapter();
        a.files.set(`${DIR}/text-snippets-backup.json`, "x");
        for (let n = 2; n <= 50; n++) a.files.set(`${DIR}/text-snippets-backup-${n}.json`, "x");
        await expect(backupOriginalData(asAdapter(a), DIR, "raw")).rejects.toThrow(/backup files already exist/);
    });

    it("propagates a write failure", async () => {
        const a = new FakeAdapter();
        a.failWrite = true;
        await expect(backupOriginalData(asAdapter(a), DIR, "raw")).rejects.toThrow("disk full");
    });
});

describe("app/text-snippets-migration: migrateTextSnippetsData", () => {
    it("backs up the file as it is on disk, then allows the save", async () => {
        const { adapter, saved } = setup();
        const outcome = await migrateTextSnippetsData({ adapter: asAdapter(adapter), dir: DIR, saved });
        expect(adapter.files.get(`${DIR}/text-snippets-backup.json`)).toBe(ORIGINAL);
        expect(outcome.save).toBe(true);
        expect(outcome.unsavedOriginal).toBeNull();
        expect(outcome.settings.snippets).toEqual({ "text-snippets/brb": "be right back" });
        expect(outcome.settings.expansion).toEqual({ onType: false, onTab: true });
    });

    it("tells the user the counts and where the backup is; the full report goes to the console", async () => {
        const { adapter, saved } = setup('{"snippets_file":"a : b\\nno separator"}');
        await migrateTextSnippetsData({ adapter: asAdapter(adapter), dir: DIR, saved });
        expect(notices).toHaveLength(1);
        expect(notices[0]).toContain("1 imported, 1 skipped");
        expect(notices[0]).toContain(`${DIR}/text-snippets-backup.json`);
        expect(console.warn).toHaveBeenCalledWith(
            "[snipsy] Text Snippets migration",
            expect.objectContaining({ imported: 1, skipped: [expect.objectContaining({ trigger: "no separator" })] }),
        );
    });

    it("an existing backup is kept and a suffixed one is written", async () => {
        const { adapter, saved } = setup();
        adapter.files.set(`${DIR}/text-snippets-backup.json`, "earlier");
        const outcome = await migrateTextSnippetsData({ adapter: asAdapter(adapter), dir: DIR, saved });
        expect(adapter.files.get(`${DIR}/text-snippets-backup.json`)).toBe("earlier");
        expect(adapter.files.get(`${DIR}/text-snippets-backup-2.json`)).toBe(ORIGINAL);
        expect(outcome.save).toBe(true);
    });

    it("backup failure: no save, settings stay in memory, the user is told the original is untouched", async () => {
        const { adapter, saved } = setup();
        adapter.failWrite = true;
        const outcome = await migrateTextSnippetsData({ adapter: asAdapter(adapter), dir: DIR, saved });
        expect(outcome.save).toBe(false);
        expect(outcome.unsavedOriginal).toBe(ORIGINAL);
        expect(outcome.settings.snippets).toEqual({ "text-snippets/brb": "be right back" });
        expect(notices[0]).toContain("left untouched");
        expect(notices[0]).toContain("disk full");
        expect(adapter.files.get(`${DIR}/data.json`)).toBe(ORIGINAL);
    });

    it("conversion failure: nothing written now, and the guard is armed for every later save", async () => {
        const { adapter, saved } = setup('{"snippets":[1,2]}');
        const outcome = await migrateTextSnippetsData({ adapter: asAdapter(adapter), dir: DIR, saved });
        expect(outcome.save).toBe(false);
        expect(outcome.unsavedOriginal).toBe('{"snippets":[1,2]}');
        expect(adapter.writes).toEqual([]);
        expect(notices[0]).toContain("left untouched");
    });

    it("an unreadable file falls back to the parsed data for conversion and backup", async () => {
        const { adapter, saved } = setup();
        adapter.failRead = true;
        const outcome = await migrateTextSnippetsData({ adapter: asAdapter(adapter), dir: DIR, saved });
        expect(outcome.save).toBe(true);
        expect(JSON.parse(adapter.files.get(`${DIR}/text-snippets-backup.json`) ?? "null")).toEqual(saved);
    });

    it("sanitizes error text before it reaches a Notice", async () => {
        const { adapter, saved } = setup();
        adapter.failWrite = true;
        adapter.write = (): Promise<void> => Promise.reject(new Error("bad\u0007\nname"));
        await migrateTextSnippetsData({ adapter: asAdapter(adapter), dir: DIR, saved });
        expect(notices[0]?.includes("\u0007")).toBe(false);
        expect(notices[0]?.includes("\n")).toBe(false);
    });

    it("an empty snippets_file still migrates (empty library, no defaults)", async () => {
        const { adapter, saved } = setup('{"snippets_file":""}');
        const outcome = await migrateTextSnippetsData({ adapter: asAdapter(adapter), dir: DIR, saved });
        expect(outcome.save).toBe(true);
        expect(outcome.settings.snippets).toEqual({});
        expect(notices[0]).toContain("0 imported");
    });
});

describe("app/text-snippets-migration: 501 records (the data-loss probe)", () => {
    it("migrates every record and backs up, instead of refusing and leaving the file exposed", async () => {
        const file = Array.from({ length: 501 }, (_, i) => `t${i} : v`).join("\n");
        const { adapter, saved } = setup(JSON.stringify({ snippets_file: file }));
        const outcome = await migrateTextSnippetsData({ adapter: asAdapter(adapter), dir: DIR, saved });
        expect(outcome.save).toBe(true);
        expect(outcome.unsavedOriginal).toBeNull();
        expect(Object.keys(outcome.settings.snippets)).toHaveLength(501);
        expect(adapter.files.has(`${DIR}/text-snippets-backup.json`)).toBe(true);
    });
});

describe("app/text-snippets-migration: protectUnknownData", () => {
    const UNKNOWN = '{"something":"else"}';

    it("backs the file up (never overwriting) and allows the save", async () => {
        const { adapter, saved } = setup(UNKNOWN);
        adapter.files.set(`${DIR}/text-snippets-backup.json`, "older");
        const out = await protectUnknownData({ adapter: asAdapter(adapter), dir: DIR, loaded: saved });
        expect(out).toEqual({ save: true, unsavedOriginal: null });
        expect(adapter.files.get(`${DIR}/text-snippets-backup.json`)).toBe("older");
        expect(adapter.files.get(`${DIR}/text-snippets-backup-2.json`)).toBe(UNKNOWN);
        expect(notices[0]).toContain("text-snippets-backup-2.json");
    });

    it("a failed backup arms the guard and refuses the save", async () => {
        const { adapter, saved } = setup(UNKNOWN);
        adapter.failWrite = true;
        const out = await protectUnknownData({ adapter: asAdapter(adapter), dir: DIR, loaded: saved });
        expect(out).toEqual({ save: false, unsavedOriginal: UNKNOWN });
        expect(notices[0]).toContain("left untouched");
    });

    it("an unreadable file backs up the parsed value", async () => {
        const { adapter } = setup(UNKNOWN);
        adapter.failRead = true;
        await protectUnknownData({ adapter: asAdapter(adapter), dir: DIR, loaded: [1, 2] });
        expect(adapter.files.get(`${DIR}/text-snippets-backup.json`)).toBe("[1,2]");
    });
});

describe("app/text-snippets-migration: failure notice names the recovery path", () => {
    it("points at Settings, Packages, Text Snippets import", async () => {
        notices.length = 0;
        const a = new FakeAdapter();
        a.files.set(`${DIR}/data.json`, JSON.stringify({ snippets_file: 5 }));
        await migrateTextSnippetsData({ adapter: asAdapter(a), dir: DIR, saved: { snippets_file: 5 } });
        expect(notices.join("\n")).toContain("Settings, Packages, Text Snippets import");
    });
});
