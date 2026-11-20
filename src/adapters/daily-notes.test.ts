import { afterEach, describe, expect, it, vi } from "vitest";
import type { Plugin } from "obsidian";
import {
    DEFAULT_DAILY_NOTES_FORMAT,
    dailyNoteNameFormat,
    formatNoteDate,
    getDailyNotesFormat,
    parseDailyNotesFormat,
    refreshDailyNotesFormat,
    resetDailyNotesFormat,
    watchDailyNotesFormat,
} from "./daily-notes";

function fakeAdapter(files: Record<string, string>) {
    return {
        exists: (path: string): Promise<boolean> => Promise.resolve(Object.prototype.hasOwnProperty.call(files, path)),
        read: (path: string): Promise<string> => Promise.resolve(files[path] ?? ""),
    };
}

afterEach(() => {
    resetDailyNotesFormat();
    vi.restoreAllMocks();
});

describe("B-218 formatNoteDate", () => {
    it("ISO week across the year edge: 2026-12-31 and 2027-01-01 are both 2026-W53", () => {
        expect(formatNoteDate("2026-12-31", "GGGG-[W]WW", "YYYY-MM-DD")).toBe("2026-W53");
        expect(formatNoteDate("2027-01-01", "GGGG-[W]WW", "YYYY-MM-DD")).toBe("2026-W53");
        expect(formatNoteDate("2027-01-04", "GGGG-[W]WW", "YYYY-MM-DD")).toBe("2027-W01");
    });

    it("a name that is not a date in the format is an empty string", () => {
        expect(formatNoteDate("Meeting notes", "YYYY", "YYYY-MM-DD")).toBe("");
        expect(formatNoteDate("2026-13-40", "YYYY", "YYYY-MM-DD")).toBe("");
    });

    it("the parse is strict: extra text around the date is not a date", () => {
        expect(formatNoteDate("2026-11-20 standup", "YYYY", "YYYY-MM-DD")).toBe("");
        expect(formatNoteDate("2026-1-5", "YYYY", "YYYY-MM-DD")).toBe("");
    });

    it("a custom Daily notes format (DD.MM.YYYY) parses the name", () => {
        expect(formatNoteDate("20.11.2026", "YYYY-MM-DD", "DD.MM.YYYY")).toBe("2026-11-20");
        expect(formatNoteDate("2026-11-20", "YYYY-MM-DD", "DD.MM.YYYY")).toBe("");
    });

    it("a nested Daily notes format parses the basename against its file-name part", () => {
        expect(formatNoteDate("2026-Nov-20", "YYYY-MM-DD", "YYYY/MMMM/YYYY-MMM-DD")).toBe("2026-11-20");
        expect(formatNoteDate("20", "DD", "YYYY/MM/DD")).toBe("20");
        expect(formatNoteDate("2026/11/20", "DD", "YYYY/MM/DD")).toBe("");
    });

    it("a format whose last segment is the whole date, and one with no slash, still work", () => {
        expect(formatNoteDate("2026-11-20", "DD.MM", "Journal/YYYY-MM-DD")).toBe("20.11");
        expect(formatNoteDate("2026-11-20", "DD.MM", "YYYY-MM-DD")).toBe("20.11");
    });

    it("a `/` outside a moment literal after a literal is the separator", () => {
        expect(formatNoteDate("2026-11-20", "MM", "[x/y]/YYYY-MM-DD")).toBe("11");
    });

    it("a `/` inside a moment literal is a folder separator too (Obsidian builds the path from the string)", () => {
        expect(formatNoteDate("2026-11-20", "MM", "[Journal/]YYYY-MM-DD")).toBe("11");
        expect(formatNoteDate("Notes 2026-11-20", "MM", "[Daily/Notes ]YYYY-MM-DD")).toBe("11");
    });

    it("a format ending in a slash has no file-name part: empty", () => {
        expect(formatNoteDate("2026-11-20", "YYYY", "YYYY-MM-DD/")).toBe("");
    });

    it("no note (undefined or empty basename) is an empty string", () => {
        expect(formatNoteDate(undefined, "YYYY")).toBe("");
        expect(formatNoteDate("", "YYYY")).toBe("");
    });

    it("uses the cached Daily notes format by default", async () => {
        expect(formatNoteDate("20.11.2026", "YYYY-MM-DD")).toBe("");
        await refreshDailyNotesFormat(fakeAdapter({ ".obsidian/daily-notes.json": '{"format":"DD.MM.YYYY"}' }), ".obsidian");
        expect(formatNoteDate("20.11.2026", "YYYY-MM-DD")).toBe("2026-11-20");
    });
});

describe("B-218 parseDailyNotesFormat", () => {
    it("reads `format`", () => {
        expect(parseDailyNotesFormat('{"folder":"d","format":"YYYY/MM/DD"}')).toBe("YYYY/MM/DD");
    });

    it.each([
        ["not json", "{oops"],
        ["no format", '{"folder":"d"}'],
        ["empty format", '{"format":""}'],
        ["blank format", '{"format":"   "}'],
        ["non-string format", '{"format":5}'],
        ["a JSON array", "[1]"],
        ["null", "null"],
        ["an absurdly long format", JSON.stringify({ format: "Y".repeat(101) })],
    ])("%s: the default", (_name, raw) => {
        expect(parseDailyNotesFormat(raw)).toBe(DEFAULT_DAILY_NOTES_FORMAT);
    });
});

describe("B-218 refreshDailyNotesFormat", () => {
    it("Daily notes format missing (no file): the default", async () => {
        await refreshDailyNotesFormat(fakeAdapter({ ".obsidian/daily-notes.json": '{"format":"DD.MM.YYYY"}' }), ".obsidian");
        await refreshDailyNotesFormat(fakeAdapter({}), ".obsidian");
        expect(getDailyNotesFormat()).toBe(DEFAULT_DAILY_NOTES_FORMAT);
    });

    it("a read error is logged and means the default; it never throws", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const adapter = { exists: () => Promise.resolve(true), read: () => Promise.reject(new Error("boom")) };
        await expect(refreshDailyNotesFormat(adapter, ".obsidian")).resolves.toBeUndefined();
        expect(getDailyNotesFormat()).toBe(DEFAULT_DAILY_NOTES_FORMAT);
        expect(warn).toHaveBeenCalled();
    });

    it("reads from the given config dir", async () => {
        await refreshDailyNotesFormat(fakeAdapter({ "cfg/daily-notes.json": '{"format":"YYYYMMDD"}' }), "cfg");
        expect(getDailyNotesFormat()).toBe("YYYYMMDD");
    });
});

describe("B-218 watchDailyNotesFormat", () => {
    it("refreshes on layout ready and on file-open, never on its own at call time", async () => {
        const files = { ".obsidian/daily-notes.json": '{"format":"YYYYMMDD"}' };
        let layoutReady: () => void = () => undefined;
        let fileOpen: () => void = () => undefined;
        const registered: unknown[] = [];
        const plugin = {
            app: {
                vault: { adapter: fakeAdapter(files), configDir: ".obsidian" },
                workspace: {
                    onLayoutReady: (cb: () => void) => { layoutReady = cb; },
                    on: (name: string, cb: () => void) => { if (name === "file-open") fileOpen = cb; return { name }; },
                },
            },
            registerEvent: (ref: unknown) => { registered.push(ref); },
        } as unknown as Plugin;

        watchDailyNotesFormat(plugin);
        expect(getDailyNotesFormat()).toBe(DEFAULT_DAILY_NOTES_FORMAT);
        expect(registered).toHaveLength(1);

        layoutReady();
        await vi.waitFor(() => expect(getDailyNotesFormat()).toBe("YYYYMMDD"));

        files[".obsidian/daily-notes.json"] = '{"format":"DD.MM.YYYY"}';
        fileOpen();
        await vi.waitFor(() => expect(getDailyNotesFormat()).toBe("DD.MM.YYYY"));
    });
});

describe("B-218 dailyNoteNameFormat", () => {
    it.each([
        ["YYYY-MM-DD", "YYYY-MM-DD"],
        ["YYYY/MM/DD", "DD"],
        ["YYYY/MMMM/YYYY-MMM-DD", "YYYY-MMM-DD"],
        ["[Journal/]YYYY-MM-DD", "YYYY-MM-DD"],
        ["[Daily/Notes ]YYYY-MM-DD", "[Notes ]YYYY-MM-DD"],
        ["[x/y]/YYYY-MM-DD", "YYYY-MM-DD"],
        ["[a/b/c]YYYY", "[c]YYYY"],
        ["YYYY/[x", "[x"],
        ["[a/b", "b"],
        ["YYYY [no slash] MM", "YYYY [no slash] MM"],
        ["YYYY/", ""],
    ])("%s gives %s", (format, expected) => {
        expect(dailyNoteNameFormat(format)).toBe(expected);
    });
});
