import type { AppliedReplacement, ExpandContext } from "./types";

const CURSOR = "$|";

/**
 * B-192: `$1`..`$9` tabstops. `$N` (N = 1-9) is a tabstop unless it is
 * followed by a Unicode letter, number or `_` (`$10`, `$1x`, `$1é`) or by
 * `.`/`,` + digit (`$1.50`, `$1,000`). `\$N` is an escape: the backslash is
 * dropped and `$N` stays literal. Use `\$5` for a literal "$5 each".
 */
const TABSTOP_RE = /(\\)?\$([1-9])(?![\p{L}\p{N}_]|[.,][0-9])/gu;

/**
 * Ranges of `text` that are Markdown code (fenced blocks and single-line
 * inline spans); `$N` inside them is literal. Linear scan.
 */
function codeRanges(text: string): Array<[number, number]> {
    const ranges: Array<[number, number]> = [];
    let offset = 0;
    let fence: { start: number; marker: string } | null = null;
    for (const line of text.split("\n")) {
        const lineEnd = offset + line.length;
        const m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
        if (fence) {
            if (m && m[1]?.[0] === fence.marker[0] && (m[1]?.length ?? 0) >= fence.marker.length) {
                ranges.push([fence.start, lineEnd]);
                fence = null;
            }
        } else if (m && m[1]) {
            fence = { start: offset, marker: m[1] };
        } else if (line.includes("`")) {
            let i = 0;
            while (i < line.length) {
                if (line[i] !== "`") { i++; continue; }
                let j = i;
                while (line[j] === "`") j++;
                const run = line.slice(i, j);
                const close = line.indexOf(run, j);
                // The closing run must be exactly as long as the opening one.
                let k = close;
                while (k >= 0 && (line[k + run.length] === "`" || line[k - 1] === "`")) {
                    k = line.indexOf(run, k + 1);
                }
                if (k >= 0) {
                    ranges.push([offset + i, offset + k + run.length]);
                    i = k + run.length;
                } else {
                    i = j;
                }
            }
        }
        offset = lineEnd + 1;
    }
    if (fence) ranges.push([fence.start, text.length]);
    return ranges;
}

/**
 * Walks the tabstops of `text` (skipping code and honouring `\$N` escapes)
 * and rewrites each through `onStop(n)`. Escaped `\$N` becomes a literal `$N`.
 */
export function mapTabstops(text: string, onStop: (n: number) => string): string {
    if (!text.includes("$")) return text;
    const ranges = codeRanges(text);
    let r = 0;
    return text.replace(TABSTOP_RE, (whole: string, esc: string | undefined, n: string, index: number) => {
        while (r < ranges.length && (ranges[r]?.[1] ?? 0) <= index) r++;
        const range = ranges[r];
        if (range && index >= range[0] && index < range[1]) return whole;
        if (esc) return `$${n}`;
        return onStop(Number(n));
    });
}

/**
 * B-192: outside the wrap path there is no selection to substitute, so a
 * tabstop must not leak into the note. If the replacement has no `$|`, the
 * first `$N` becomes the cursor marker; every other tabstop is stripped.
 * With `$|` present it wins and all tabstops are stripped. Runs on the RAW
 * replacement (before variable substitution) so a `$1` inside a clipboard
 * payload is never touched. The wrap path resolves `$1` itself (selection).
 */
export function resolveTabstops(replacement: string): string {
    let seenCursor = replacement.includes(CURSOR);
    return mapTabstops(replacement, () => {
        if (seenCursor) return "";
        seenCursor = true;
        return CURSOR;
    });
}

/** B-166: `{{date}}`, `{{time}}`, `{{date:FMT}}`, `{{time:FMT}}` (core Templates syntax). */
const FORMATTED_RE = /\{\{(date|time)(?::([^{}]*))?\}\}/g;
const DEFAULT_DATE_FORMAT = "YYYY-MM-DD";
const DEFAULT_TIME_FORMAT = "HH:mm";

function pad2(n: number) { return n < 10 ? `0${n}` : `${n}`; }

function formatDate(d: Date): string {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function formatTime(d: Date): string {
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * Substitutes `$date` / `$time` / `$filename` / `$clipboard` and the
 * `{{date}}` / `{{time}}` forms. Does NOT touch `$|` or tabstops. Shared by
 * trigger expansion and the picker insert/wrap paths (B-197).
 */
export async function substituteVariables(text: string, ctx: ExpandContext): Promise<string> {
    // B-166: `{{date:FMT}}` / `{{time:FMT}}`. Empty/missing FMT = core Templates
    // defaults. Custom formats need the injected formatter (moment lives in the
    // adapter layer); without one the token is left untouched.
    text = text.replace(FORMATTED_RE, (whole, kind: string, fmt: string | undefined) => {
        const isDate = kind === "date";
        const format = fmt && fmt.length > 0 ? fmt : isDate ? DEFAULT_DATE_FORMAT : DEFAULT_TIME_FORMAT;
        if (ctx.formatDate) return ctx.formatDate(ctx.now, format);
        if (format === DEFAULT_DATE_FORMAT) return formatDate(ctx.now);
        if (format === DEFAULT_TIME_FORMAT) return formatTime(ctx.now);
        return whole;
    });
    text = text.replace(/\$date\b/g, () => formatDate(ctx.now));
    text = text.replace(/\$time\b/g, () => formatTime(ctx.now));
    text = text.replace(/\$filename\b/g, () => ctx.filename ?? "");

    if (/\$clipboard\b/.test(text) && ctx.readClipboard) {
        const clip = await ctx.readClipboard().catch(() => "");
        text = text.replace(/\$clipboard\b/g, () => clip ?? "");
    } else {
        text = text.replace(/\$clipboard\b/g, "");
    }
    return text;
}

export async function applyPlaceholders(
    replacement: string,
    ctx: ExpandContext
): Promise<AppliedReplacement> {
    // Substitute variables FIRST so the `$|` cursor marker is located against
    // the final string. If we resolved `$|` first, any length change in
    // `$date` / `$time` / `$filename` / `$clipboard` to the left of `$|`
    // would silently desync the caret (e.g. `"$date $|"` would place the
    // cursor at index 6 of the *raw* string rather than at the end of the
    // expanded date).
    let text = await substituteVariables(resolveTabstops(replacement), ctx);

    // Locate `$|` in the substituted text (first occurrence wins, matching
    // pre-existing behaviour). If a substituted variable happens to contain a
    // literal `$|` (unlikely outside contrived clipboard payloads), the marker
    // there will be honoured.
    let cursorDelta: number | undefined;
    const markerIndex = text.indexOf(CURSOR);
    if (markerIndex >= 0) {
        text = text.slice(0, markerIndex) + text.slice(markerIndex + CURSOR.length);
        cursorDelta = markerIndex;
    }

    return { text, cursorDelta };
}
