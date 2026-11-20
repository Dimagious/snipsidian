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
export function codeRanges(text: string): Array<[number, number]> {
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
            // Backtick runs of the line, each opened by the next run of exactly the same length (linear).
            const runs: Array<{ start: number; len: number }> = [];
            for (let i = 0; i < line.length;) {
                if (line[i] !== "`") { i++; continue; }
                let j = i;
                while (line[j] === "`") j++;
                runs.push({ start: i, len: j - i });
                i = j;
            }
            const nextSame: number[] = new Array<number>(runs.length).fill(-1);
            const lastOfLen = new Map<number, number>();
            for (let idx = runs.length - 1; idx >= 0; idx--) {
                const len = runs[idx]?.len ?? 0;
                nextSame[idx] = lastOfLen.get(len) ?? -1;
                lastOfLen.set(len, idx);
            }
            for (let idx = 0; idx < runs.length;) {
                const open = runs[idx];
                const close = runs[nextSame[idx] ?? -1];
                if (open && close) {
                    ranges.push([offset + open.start, offset + close.start + close.len]);
                    idx = (nextSame[idx] ?? idx) + 1;
                } else {
                    idx++;
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
 * Turns every literal tabstop of `text` (`$5` outside code, not yet escaped)
 * into the escape `\$5`, so it stays text when other tabstops are added to
 * the same text (the Text Snippets import does that). Idempotent.
 */
export function escapeLiteralTabstops(text: string): string {
    if (!text.includes("$")) return text;
    const ranges = codeRanges(text);
    let r = 0;
    return text.replace(TABSTOP_RE, (whole: string, esc: string | undefined, n: string, index: number) => {
        while (r < ranges.length && (ranges[r]?.[1] ?? 0) <= index) r++;
        const range = ranges[r];
        if ((range && index >= range[0] && index < range[1]) || esc) return whole;
        return `\\$${n}`;
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

/**
 * B-243: field markers. With two or more tabstops each `$N` becomes
 * `FIELD_OPEN N FIELD_CLOSE` (private-use characters) so it survives variable
 * substitution and is located against the FINAL text, exactly like `$|`.
 */
const FIELD_OPEN = "\uE002";
const FIELD_CLOSE = "\uE003";
const MARKER_SCAN_SOURCE = "\\uE002(?<field>[1-9])\\uE003|\\$\\|";
const CURSOR_SCAN_SOURCE = "\\$\\|";
/**
 * B-204 / B-218: `{{title}}` and `{{notedate}}` values are held back as `VERBATIM_MARK i VERBATIM_MARK` while the
 * `$` passes and the marker scan run, then written in by `scanMarkers`, so a note named `Budget $date`, `pw $clipboard`
 * or `a $| b` is inserted as written (never read as a placeholder or a caret). A snippet that itself contains this
 * private-use character next to digits would be read as such a marker: not a case worth guarding.
 */
const VERBATIM_MARK = "\uE005";
const VERBATIM_SCAN_SOURCE = "\\uE005(?<verb>\\d+)\\uE005";

/** Number of real tabstops in `text` (escapes and code excluded). */
export function countTabstops(text: string): number {
    let count = 0;
    mapTabstops(text, (n) => {
        count++;
        return `$${n}`;
    });
    return count;
}

/** The marker text standing for field `$n` (see `scanMarkers`). */
export function fieldMarker(n: number): string {
    return `${FIELD_OPEN}${n}${FIELD_CLOSE}`;
}

/**
 * B-243: decides what the tabstops of a RAW replacement become. Two or more
 * tabstops are fields (markers, `fields: true`); a single one keeps the B-192
 * behaviour (`resolveTabstops`: it is the caret, no session).
 */
export function prepareTabstops(replacement: string): { text: string; fields: boolean } {
    if (countTabstops(replacement) < 2) return { text: resolveTabstops(replacement), fields: false };
    return { text: mapTabstops(replacement, fieldMarker), fields: true };
}

/** A field found by `scanMarkers`: its number and offset in the cleaned text. */
export type FieldHit = { n: number; offset: number };

/**
 * Removes the first `$|` and (when `withFields`) every field marker from
 * `text`, reporting where they were. `dropExtraCursors` removes later `$|` as
 * well (picker paths); otherwise they stay literal (trigger path, as before).
 * `verbatim` are the values `substituteVariables` held back: each marker is
 * replaced by its value, which is never scanned. Single linear pass, so every
 * offset is relative to the returned text.
 */
export function scanMarkers(
    text: string,
    withFields: boolean,
    dropExtraCursors = false,
    verbatim: readonly string[] = [],
): { text: string; cursor?: number; fields: FieldHit[] } {
    const source = (withFields ? MARKER_SCAN_SOURCE : CURSOR_SCAN_SOURCE) + (verbatim.length > 0 ? `|${VERBATIM_SCAN_SOURCE}` : "");
    const re = new RegExp(source, "g");
    let out = "";
    let last = 0;
    let cursor: number | undefined;
    const fields: FieldHit[] = [];
    for (let m = re.exec(text); m; m = re.exec(text)) {
        out += text.slice(last, m.index);
        last = m.index + m[0].length;
        const field = m.groups?.["field"];
        const verb = m.groups?.["verb"];
        if (verb !== undefined) {
            out += verbatim[Number(verb)] ?? m[0];
        } else if (field !== undefined) {
            fields.push({ n: Number(field), offset: out.length });
        } else if (cursor === undefined) {
            cursor = out.length;
        } else if (!dropExtraCursors) {
            out += m[0];
        }
    }
    return { text: out + text.slice(last), cursor, fields };
}

/**
 * Visit order of fields: ascending number, ties by position (stable).
 * `docOrder[k]` is the document index of the k-th visited field: fields at
 * one offset (`$2$1`) can only be told apart by it.
 */
export function orderFieldHits(fields: FieldHit[]): { offsets: number[]; docOrder: number[] } {
    const sorted = fields.map((f, i) => ({ ...f, i })).sort((a, b) => a.n - b.n || a.i - b.i);
    return { offsets: sorted.map((f) => f.offset), docOrder: sorted.map((f) => f.i) };
}

/** Offsets of the fields in visit order (see `orderFieldHits`). */
export function orderFields(fields: FieldHit[]): number[] {
    return orderFieldHits(fields).offsets;
}

/** Private-use characters Snipsy uses as markers; a substituted value must not carry them. */
const MARKER_CHARS_RE = /[\uE002-\uE005]/g;
const VERBATIM_MARK_RE = /\uE005/g;

/**
 * B-166: `{{date}}`, `{{time}}`, `{{date:FMT}}`, `{{time:FMT}}` (core Templates syntax). B-218: `{{notedate}}` /
 * `{{notedate:FMT}}`. B-204: `{{title}}` (no format: `{{title:x}}` is not a placeholder).
 */
const FORMATTED_RE = /\{\{(?:(date|time|notedate)(?::([^{}]*))?|(title))\}\}/g;

/**
 * B-266: the placeholders `substituteVariables` would replace in `text`, for an importer that must not let foreign
 * text be read as one: `$date`, `$time`, `$filename`, `$clipboard` (word boundary after, as in the engine) and the
 * `{{date}}` / `{{time}}` / `{{date:FMT}}` / `{{time:FMT}}` / `{{notedate[:FMT]}}` / `{{title}}` forms. Keep in step with `substituteVariables`.
 */
export function findVariableTokens(text: string): string[] {
    return Array.from(text.matchAll(/\$(?:date|time|filename|clipboard)\b/g), (m) => m[0]);
}

export function findFormattedTokens(text: string): string[] {
    return Array.from(text.matchAll(new RegExp(FORMATTED_RE.source, "g")), (m) => m[0]);
}

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
 * `{{date}}` / `{{time}}` / `{{title}}` / `{{notedate}}` forms. Does NOT touch `$|` or tabstops. Shared by
 * trigger expansion and the picker insert/wrap paths (B-197).
 */
export async function substituteVariables(
    text: string,
    ctx: ExpandContext,
    /** B-243: the text carries field markers, so a substituted VALUE (clipboard,
     *  file name, a date format) must not be able to forge one. Off = values are
     *  inserted verbatim, exactly as before fields existed. */
    stripMarkers = false,
    /** B-204 / B-218: when given, `{{title}}` / `{{notedate}}` values are pushed here and a marker stands for each in
     *  the result; the caller hands the array to `scanMarkers`, which writes them in untouched. Without it they are
     *  inserted in place and the later passes read them (the old behaviour). */
    verbatim?: string[],
): Promise<string> {
    // `verbatim` in use: the held-back markers must not be forgeable by any value, fields or not.
    const clean = (value: string): string =>
        stripMarkers ? value.replace(MARKER_CHARS_RE, "") : verbatim ? value.replace(VERBATIM_MARK_RE, "") : value;
    const hold = (value: string): string => {
        if (!verbatim) return value;
        verbatim.push(value);
        return `${VERBATIM_MARK}${verbatim.length - 1}${VERBATIM_MARK}`;
    };
    // B-166: `{{date:FMT}}` / `{{time:FMT}}`. Empty/missing FMT = core Templates
    // defaults. Custom formats need the injected formatter (moment lives in the
    // adapter layer); without one the token is left untouched.
    text = text.replace(FORMATTED_RE, (whole, kind: string | undefined, fmt: string | undefined, title: string | undefined) => {
        // B-204: the note's name without its extension; no active file = empty.
        if (title !== undefined) return hold(clean(ctx.basename ?? ""));
        // B-218: the date in the note's NAME, re-formatted (empty FMT = `YYYY-MM-DD`). Not a date = empty, like
        // `{{title}}` without a file. Needs the injected formatter (the Daily notes format lives in the adapter).
        if (kind === "notedate") {
            return ctx.formatNoteDate ? hold(clean(ctx.formatNoteDate(fmt && fmt.length > 0 ? fmt : DEFAULT_DATE_FORMAT))) : whole;
        }
        const isDate = kind === "date";
        const format = fmt && fmt.length > 0 ? fmt : isDate ? DEFAULT_DATE_FORMAT : DEFAULT_TIME_FORMAT;
        if (ctx.formatDate) return clean(ctx.formatDate(ctx.now, format));
        if (format === DEFAULT_DATE_FORMAT) return formatDate(ctx.now);
        if (format === DEFAULT_TIME_FORMAT) return formatTime(ctx.now);
        return whole;
    });
    text = text.replace(/\$date\b/g, () => formatDate(ctx.now));
    text = text.replace(/\$time\b/g, () => formatTime(ctx.now));
    text = text.replace(/\$filename\b/g, () => clean(ctx.filename ?? ""));

    if (/\$clipboard\b/.test(text) && ctx.readClipboard) {
        const clip = await ctx.readClipboard().catch(() => "");
        text = text.replace(/\$clipboard\b/g, () => clean(clip ?? ""));
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
    // expanded date). B-243 fields are located the same way.
    const prepared = prepareTabstops(replacement);
    const verbatim: string[] = [];
    const substituted = await substituteVariables(prepared.text, ctx, prepared.fields, verbatim);

    // Locate `$|` in the substituted text (first occurrence wins, matching
    // pre-existing behaviour). If a substituted variable happens to contain a
    // literal `$|` (unlikely outside contrived clipboard payloads), the marker
    // there will be honoured.
    const scan = scanMarkers(substituted, prepared.fields, false, verbatim);
    const { offsets: fields, docOrder } = orderFieldHits(scan.fields);
    if (fields.length === 0) return { text: scan.text, cursorDelta: scan.cursor };

    // B-243: `cursorDelta` stays meaningful when no field session can start
    // (`$|` if present, else the first field). `finalDelta` is set only for
    // an explicit `$|`: the default final stop depends on the typed separator
    // (see `buildEdit`).
    return {
        text: scan.text,
        cursorDelta: scan.cursor ?? fields[0],
        fields,
        docOrder,
        finalDelta: scan.cursor,
    };
}
