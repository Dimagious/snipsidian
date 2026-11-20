import { moment, type DataAdapter, type Plugin } from "obsidian";

/**
 * B-218: `{{notedate:FMT}}` parses the note's NAME with the core Daily notes format. The format lives in
 * `<configDir>/daily-notes.json` (`format`), which Obsidian keeps whether or not the plugin is switched on. It is
 * read through the vault adapter (public API, no internal plugin object) into a module-level cache: expansion runs
 * on the keystroke hot path and must not do file I/O, so `formatNoteDate` only reads the cached string.
 *
 * The cache is refreshed when the layout is ready and whenever a note is opened (cheap: one
 * small file, off the hot path), so a format changed in Daily notes settings is picked up the next time a note
 * opens. Any read or parse problem means the default format.
 */
export const DEFAULT_DAILY_NOTES_FORMAT = "YYYY-MM-DD";

/** A format longer than this is not a date format: ignore it. */
const MAX_FORMAT_LENGTH = 100;

let cachedFormat = DEFAULT_DAILY_NOTES_FORMAT;

/** The Daily notes format the cache holds (the default until a file has been read). */
export function getDailyNotesFormat(): string {
    return cachedFormat;
}

/** Test seam: back to the default. */
export function resetDailyNotesFormat(): void {
    cachedFormat = DEFAULT_DAILY_NOTES_FORMAT;
}

/** The `format` of the text of `daily-notes.json`, or the default for anything unusable. */
export function parseDailyNotesFormat(raw: string): string {
    try {
        const data: unknown = JSON.parse(raw);
        if (typeof data === "object" && data !== null && "format" in data) {
            const format: unknown = data.format;
            if (typeof format === "string") {
                const trimmed = format.trim();
                if (trimmed.length > 0 && trimmed.length <= MAX_FORMAT_LENGTH) return trimmed;
            }
        }
    } catch {
        // Not JSON: fall through to the default.
    }
    return DEFAULT_DAILY_NOTES_FORMAT;
}

/** Re-reads `<configDir>/daily-notes.json` into the cache. Never throws: a missing file is the default. */
export async function refreshDailyNotesFormat(
    adapter: Pick<DataAdapter, "exists" | "read">,
    configDir: string,
): Promise<void> {
    const path = `${configDir}/daily-notes.json`;
    try {
        cachedFormat = (await adapter.exists(path)) ? parseDailyNotesFormat(await adapter.read(path)) : DEFAULT_DAILY_NOTES_FORMAT;
    } catch (err) {
        console.warn("[snipsy] could not read the Daily notes format, using the default", err);
        cachedFormat = DEFAULT_DAILY_NOTES_FORMAT;
    }
}

/** Keeps the cache fresh for the life of `plugin` (see the file comment). */
export function watchDailyNotesFormat(plugin: Plugin): void {
    const { app } = plugin;
    const refresh = (): void => {
        void refreshDailyNotesFormat(app.vault.adapter, app.vault.configDir);
    };
    app.workspace.onLayoutReady(refresh);
    plugin.registerEvent(app.workspace.on("file-open", refresh));
}

/** The part of moment `formatNoteDate` uses. */
interface ParsedMoment {
    isValid(): boolean;
    format(pattern: string): string;
}

/**
 * The file-name part of a Daily notes format: the Daily notes setting may carry folders (`YYYY/MMMM/YYYY-MMM-DD`),
 * and the note's basename is only what follows the LAST `/`. Obsidian builds the path from the formatted string, so
 * a `/` inside a moment literal (`[Journal/]YYYY`) is a folder separator too: the split happens there and the literal
 * is reopened for the remainder (`[Journal/Day ]YYYY` gives `[Day ]YYYY`; an empty `[]` is dropped, strict parsing
 * rejects it). A `[` is a literal opener only when a `]` follows with no `[` in between (moment's rule), so the `[`
 * of `[a/b` (no closer) is plain text and its `/` splits.
 */
export function dailyNoteNameFormat(format: string): string {
    let slash = -1;
    let litOpen = -1;
    let litClose = -1; // bounds of the literal holding `slash`; -1 when the last `/` is outside a literal
    let i = 0;
    while (i < format.length) {
        const ch = format[i];
        if (ch === "[") {
            const nextOpen = format.indexOf("[", i + 1);
            const close = format.lastIndexOf("]", nextOpen === -1 ? format.length : nextOpen);
            if (close > i) {
                const inner = format.lastIndexOf("/", close);
                if (inner > i) {
                    slash = inner;
                    litOpen = i;
                    litClose = close;
                }
                i = close + 1;
                continue;
            }
        } else if (ch === "/") {
            slash = i;
            litOpen = -1;
            litClose = -1;
        }
        i++;
    }
    if (slash === -1) return format;
    if (litOpen === -1) return format.slice(slash + 1);
    const rest = format.slice(slash + 1, litClose);
    return (rest.length > 0 ? `[${rest}]` : "") + format.slice(litClose + 1);
}

/**
 * `{{notedate:FMT}}`: `basename` parsed STRICTLY with the file-name part of the Daily notes format
 * (`dailyNoteNameFormat`), re-formatted with `format`. Empty
 * string when there is no note or its name is not a date in that format. Typed by hand for the same reason as
 * `formatWithMoment` (`moment` is an `export =` namespace; K-058).
 */
export function formatNoteDate(basename: string | undefined, format: string, dailyFormat: string = cachedFormat): string {
    if (basename === undefined || basename.length === 0) return "";
    const nameFormat = dailyNoteNameFormat(dailyFormat);
    if (nameFormat.length === 0) return "";
    const parsed = (moment as unknown as (input: string, format: string, strict: boolean) => ParsedMoment)(
        basename,
        nameFormat,
        true,
    );
    return parsed.isValid() ? parsed.format(format) : "";
}
