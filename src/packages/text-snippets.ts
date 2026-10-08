// Converter from the "Text Snippets" plugin's data.json (plugin id
// `text-snippets-obsidian`) to { trigger: replacement } (B-174).
//
// Pure: no Obsidian imports, no I/O. The caller reads the file; this
// module only turns its text into snippets plus honest skip/warning
// reports, mirroring `espanso.ts` (B-139).
import {
    SINGLE_STRUCTURAL_TRIGGER_MESSAGE,
    SINGLE_STRUCTURAL_TRIGGER_RE,
    TRIGGER_CHARSET_DESCRIPTION,
    TRIGGER_CHARSET_RE,
    isBadTrigger,
    normalizeTrigger,
} from "../engine/triggers";
import { INSTALL_MAX_REPLACEMENT_LEN } from "../services/package-validator";

/** One record that couldn't be imported, and why. */
export interface TextSnippetsSkip {
    /** Best-effort label: the trimmed trigger, or the start of the
     *  record when it has no ` : ` separator. Untrusted: sanitize
     *  before showing it in a Notice. */
    trigger: string;
    reason: string;
}

/** A snippet that was imported, but not byte-for-byte as written. */
export interface TextSnippetsWarning {
    trigger: string;
    message: string;
}

export interface TextSnippetsImportResult {
    snippets: Record<string, string>;
    skipped: TextSnippetsSkip[];
    warnings: TextSnippetsWarning[];
}

/** Defaults of the source plugin (`main.ts` v0.1.2). */
const DEFAULT_END = "$end$";
const DEFAULT_NEWLINE = "$nl$";
const DEFAULT_STOP = "$tb$";
const DEFAULT_PASTE = "$pst$";

/** Separator between trigger and replacement in one record. */
const PAIR_SEPARATOR = " : ";

/** Same cap as `validatePackageForInstall` (trigger length). */
const MAX_TRIGGER_LEN = 50;

/** The sample record the source plugin ships as its default
 *  `snippets_file`; importing it would just add a junk `snippets` snippet. */
const SAMPLE_TRIGGER = "snippets";
const SAMPLE_REPLACEMENT = "It is an obsidian plugin, that replaces your selected text.";

/** Longest record preview kept as a skip label. */
const LABEL_MAX = 40;

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function markerOrDefault(value: unknown, fallback: string): string {
    return typeof value === "string" && value.length > 0 ? value : fallback;
}

/**
 * Splits the raw textarea into records on `\n` NOT preceded by the
 * newline marker (their `(?<!\$nl\$)\n`). Done by hand instead of a
 * lookbehind regex: lookbehind is missing on older iOS WebViews and
 * this runs on mobile. Empty (or whitespace-only) records are dropped.
 */
function splitRecords(text: string, newlineMarker: string): string[] {
    const records: string[] = [];
    let acc: string | null = null;
    for (const chunk of text.replace(/\r\n?/g, "\n").split("\n")) {
        acc = acc === null ? chunk : `${acc}\n${chunk}`;
        if (!acc.endsWith(newlineMarker)) {
            records.push(acc);
            acc = null;
        }
    }
    if (acc !== null) records.push(acc);
    return records.filter((r) => r.trim().length > 0);
}

interface Markers {
    end: string;
    newline: string;
    stop: string;
    paste: string;
}

/**
 * Translates one replacement's escapes in a SINGLE pass, so the order
 * of substitutions can't interfere (a produced `\n` is never re-stripped,
 * a produced `$clipboard` never re-scanned):
 *   - raw newline          -> removed (the source plugin deletes them)
 *   - <newline marker>     -> "\n"
 *   - first <end marker>   -> "$|"; later ones removed (warning)
 *   - <paste marker>       -> "$clipboard"
 *   - <stop marker>        -> removed (warning: no Snipsy tab stops),
 *     except that with no end marker the FIRST one becomes "$|" (the
 *     source plugin puts the cursor at the first tab stop)
 */
function translateReplacement(
    raw: string,
    markers: Markers,
): { text: string; warnings: string[] } {
    const alternation = [markers.newline, markers.end, markers.paste, markers.stop]
        .sort((a, b) => b.length - a.length)
        .map(escapeRegExp)
        .concat("\\n")
        .join("|");
    // Without an end marker the first stop marker carries the cursor.
    const hasEnd = raw.includes(markers.end);
    let endSeen = false;
    let extraEnd = false;
    let stopSeen = false;
    let stopAsCursor = false;
    const text = raw.replace(new RegExp(alternation, "g"), (token) => {
        if (token === "\n") return "";
        if (token === markers.newline) return "\n";
        if (token === markers.end) {
            if (endSeen) {
                extraEnd = true;
                return "";
            }
            endSeen = true;
            return "$|";
        }
        if (token === markers.paste) return "$clipboard";
        if (!hasEnd && !stopAsCursor) {
            stopAsCursor = true;
            stopSeen = true;
            return "$|";
        }
        stopSeen = true;
        return "";
    });
    const warnings: string[] = [];
    if (stopSeen) warnings.push("tab stops removed");
    if (extraEnd) warnings.push("extra cursor markers removed, only the first is kept");
    return { text, warnings };
}

/** Returns a skip reason when Snipsy can't take this trigger, else null.
 *  Mirrors what `validatePackageForInstall` rejects per trigger, so one
 *  bad trigger is reported here instead of failing the whole import. */
function triggerProblem(trigger: string): string | null {
    if (trigger.length === 0) return "empty trigger";
    if (trigger.length > MAX_TRIGGER_LEN) return `trigger is longer than ${MAX_TRIGGER_LEN} characters`;
    if (SINGLE_STRUCTURAL_TRIGGER_RE.test(trigger)) return `trigger not allowed: ${SINGLE_STRUCTURAL_TRIGGER_MESSAGE}`;
    if (isBadTrigger(trigger)) return "trigger contains spaces, separators or characters Snipsy can't use";
    if (!TRIGGER_CHARSET_RE.test(trigger)) return `trigger can only contain ${TRIGGER_CHARSET_DESCRIPTION}`;
    return null;
}

function preview(record: string): string {
    const flat = record.replace(/\s+/g, " ").trim();
    return flat.length > LABEL_MAX ? `${flat.slice(0, LABEL_MAX)}…` : flat;
}

/**
 * Parses the text of `<configDir>/plugins/text-snippets-obsidian/data.json`.
 *
 * `snippets_file` (the raw textarea) is the source of truth; `snippets`
 * (their derived cache, possibly stale) is used only when
 * `snippets_file` is absent. The four markers are user-configurable and
 * read from the file, falling back to the defaults when missing, empty
 * or not a string. Other fields are ignored.
 *
 * Throws an `Error` with a readable message on malformed JSON or on a
 * wrong-typed `snippets_file` / `snippets`; the UI surfaces it.
 *
 * Decision: replacements that already contain Snipsy placeholder syntax
 * (`$date`, `$|`, `$1`) are left untouched. The source plugin has no
 * such syntax, so a literal occurrence is far more likely intended
 * (the user may already have switched to Snipsy placeholders) than an
 * accident, and rewriting user text is the worse failure.
 */
export function textSnippetsDataToSnippets(jsonText: string): TextSnippetsImportResult {
    let data: unknown;
    try {
        data = JSON.parse(jsonText);
    } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        throw new Error(`Text Snippets data.json is not valid JSON: ${detail}`);
    }
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
        throw new Error("Text Snippets data.json must contain a JSON object");
    }
    const obj = data as Record<string, unknown>;

    const markers: Markers = {
        end: markerOrDefault(obj.endSymbol, DEFAULT_END),
        newline: markerOrDefault(obj.newlineSymbol, DEFAULT_NEWLINE),
        stop: markerOrDefault(obj.stopSymbol, DEFAULT_STOP),
        paste: markerOrDefault(obj.pasteSymbol, DEFAULT_PASTE),
    };

    let records: string[];
    if (obj.snippets_file !== undefined && obj.snippets_file !== null) {
        if (typeof obj.snippets_file !== "string") {
            throw new Error("Text Snippets data.json: 'snippets_file' must be a string");
        }
        records = splitRecords(obj.snippets_file, markers.newline);
    } else if (obj.snippets !== undefined && obj.snippets !== null) {
        const cache = obj.snippets;
        if (!Array.isArray(cache) || !cache.every((s): s is string => typeof s === "string")) {
            throw new Error("Text Snippets data.json: 'snippets' must be a list of strings");
        }
        records = cache.filter((r) => r.trim().length > 0);
    } else {
        records = [];
    }

    // A Map, not a plain object: attacker-controlled triggers such as
    // `__proto__` / `constructor` must never hit object-prototype
    // semantics while deduplicating (S-004/S-008 family).
    const found = new Map<string, { replace: string; warnings: string[] }>();
    const skipped: TextSnippetsSkip[] = [];

    for (const record of records) {
        const idx = record.indexOf(PAIR_SEPARATOR);
        if (idx < 0) {
            skipped.push({ trigger: preview(record), reason: "no ' : ' separator" });
            continue;
        }
        const trigger = normalizeTrigger(record.slice(0, idx));
        const problem = triggerProblem(trigger);
        if (problem) {
            // An empty trigger has nothing to show: label by the replacement
            // so the line never starts with the bare separator.
            const label = trigger || `(no trigger) ${preview(record.slice(idx + PAIR_SEPARATOR.length))}`.trim();
            skipped.push({ trigger: label, reason: problem });
            continue;
        }
        // Everything after the FIRST separator, ` : ` inside the text
        // preserved (their own importer truncates there, issue #51).
        const { text, warnings } = translateReplacement(record.slice(idx + PAIR_SEPARATOR.length), markers);
        if (trigger === SAMPLE_TRIGGER && text === SAMPLE_REPLACEMENT) {
            skipped.push({ trigger, reason: "sample snippet from the Text Snippets plugin" });
            continue;
        }
        // A lone cursor marker inserts nothing, same as an empty record.
        if (text.length === 0 || text === "$|") {
            skipped.push({ trigger, reason: "empty replacement" });
            continue;
        }
        if (text.length > INSTALL_MAX_REPLACEMENT_LEN) {
            skipped.push({ trigger, reason: `replacement is longer than ${INSTALL_MAX_REPLACEMENT_LEN} characters` });
            continue;
        }
        if (found.has(trigger)) {
            skipped.push({ trigger, reason: "duplicate trigger, later one kept" });
        }
        found.set(trigger, { replace: text, warnings });
    }

    const warningList: TextSnippetsWarning[] = [];
    for (const [trigger, { warnings }] of found) {
        for (const message of warnings) warningList.push({ trigger, message });
    }
    // fromEntries defines own properties, so a `__proto__` key stays data.
    const snippets = Object.fromEntries(
        Array.from(found, ([trigger, { replace }]): [string, string] => [trigger, replace]),
    );
    return { snippets, skipped, warnings: warningList };
}
