import { checkPattern, compileRule } from "../engine/patterns";
import type { PatternMode } from "../engine/types";
import { describePatternRefusal } from "./pattern-reasons";

/**
 * ADR-0008, Imports: turns the `regex:` of an Espanso match into a pattern rule source (`/body$/i`) and a mode.
 * Pure: no I/O, no settings. Every result went through the S-015 gate (`checkPattern`, then `compileRule` for the
 * replacement), so a rule built here is one the engine accepts; `planPatternImport` runs the gate again at write time.
 *
 * What differs between the two dialects, and what this does about it:
 *   - `(?P<name>` is Espanso's (Rust) spelling of a named group: written as `(?<name>`.
 *   - Espanso fires a regex as soon as it matches the end of the typed text; a pattern must end with `$`: appended
 *     when the body does not end with an unescaped one (`\$` at the end is a dollar sign, not an anchor).
 *   - A leading `(?i)` is the one inline flag with a plain equivalent: it becomes the flag `i`. Any other inline
 *     flag (`(?s)`, `(?x)`, `(?i)` in the middle, `(?i:...)`) is refused by the gate as an unsupported group.
 *   - Rust class syntax that JS reads differently (`[[:alpha:]]`, nested classes, `&&` `--` `~~` set operations, a
 *     `]` first in a class) is refused here: the JS regex would compile and quietly match something else.
 *   - Not translated, only accepted: `\w`, `\d`, `\s` and `\b` (and their negations) are Unicode-aware in Rust and
 *     ASCII-based in a pattern (without the `u` flag, which is refused). Such a rule can match differently on
 *     non-ASCII text: no claim is made that it matches less or more.
 *   - Espanso exposes named groups only: `{{name}}` in the replacement maps 1:1 to the capture `{{name}}`. A
 *     reference to anything else (`{{1}}`, a name that is no group, `{{ name }}` with spaces, `{{name.sub}}`) is
 *     refused, because in Snipsy it would mean a numbered capture or stay literal text.
 */

/** A regex match of an Espanso file, converted and gated, not yet checked against the rules the person has. */
export type EspansoPatternCandidate = {
    /** `regex:<pattern as written>`, for the skip report and the preview. */
    label: string;
    /** `/body$/flags`. */
    source: string;
    replacement: string;
    mode: PatternMode;
    /** Set when the rule was not imported the way Espanso behaves, e.g. "Imported as After a separator: ...". */
    note?: string;
};

export type RegexConversion =
    | { ok: true; source: string; mode: PatternMode; note?: string }
    | { ok: false; reason: string };

/**
 * Espanso's own shape of a variable in the replacement: `{{`, optional whitespace, a word (Unicode letters and digits,
 * `_`), an optional `.subname`, optional whitespace, `}}`. Anything of this shape is a variable to Espanso, so
 * anything of this shape that is not exactly `{{name}}` of a known group is refused.
 */
const REPLACEMENT_REF_RE = /\{\{\s*[\p{L}\p{N}_]+(?:\.[\p{L}\p{N}_]+)?\s*\}\}/gu;
const EXACT_REF_RE = /^\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}$/;
const GROUP_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*/;

type Scan = { ok: true; text: string; names: Set<string> } | { ok: false; reason: string };

/** `(?i)`, `(?s)`, `(?-i:`, `(?ix)`: Rust inline flags, which a pattern has no way to say except a leading `(?i)`. */
const INLINE_FLAGS_AT_RE = /^\(\?[imsUuxR-]+[):]/;
const INLINE_FLAG_REASON = "uses an inline flag that Snipsy's patterns can't read. Only a leading (?i) is supported.";
const CLASS_REASON = "uses a character class form (a nested class, [:alpha:], &&, -- or ~~) that Snipsy's patterns can't read.";

/** Reads `body` once: `(?P<` to `(?<`, collects group names, and refuses the class syntax the dialects read differently. */
function translateBody(body: string): Scan {
    let text = "";
    const names = new Set<string>();
    let inClass = false;
    let i = 0;
    while (i < body.length) {
        const c = body.charAt(i);
        if (c === "\\") {
            text += c + body.charAt(i + 1);
            i += 2;
            continue;
        }
        if (inClass) {
            const next = body.charAt(i + 1);
            if (c === "[") return { ok: false, reason: CLASS_REASON };
            if ((c === "&" || c === "-" || c === "~") && next === c) return { ok: false, reason: CLASS_REASON };
            if (c === "]") inClass = false;
            text += c;
            i++;
            continue;
        }
        if (c === "[") {
            inClass = true;
            text += c;
            i++;
            if (body.charAt(i) === "^") {
                text += "^";
                i++;
            }
            // Rust takes a `]` first in a class as a member, JS closes the (empty) class.
            if (body.charAt(i) === "]") return { ok: false, reason: CLASS_REASON };
            continue;
        }
        if (c === "(") {
            if (INLINE_FLAGS_AT_RE.test(body.slice(i, i + 12))) return { ok: false, reason: INLINE_FLAG_REASON };
            if (body.startsWith("(?P<", i)) {
                text += "(?<";
                i += 4;
                const name = GROUP_NAME_RE.exec(body.slice(i))?.[0];
                if (name !== undefined) names.add(name);
                continue;
            }
            if (body.startsWith("(?<", i) && body.charAt(i + 3) !== "=" && body.charAt(i + 3) !== "!") {
                const name = GROUP_NAME_RE.exec(body.slice(i + 3))?.[0];
                if (name !== undefined) names.add(name);
            }
        }
        text += c;
        i++;
    }
    return { ok: true, text, names };
}

/** The body ends with an unescaped `$`: an even number of backslashes (including none) before it. */
function endsWithAnchor(text: string): boolean {
    if (!text.endsWith("$")) return false;
    let slashes = 0;
    for (let j = text.length - 2; j >= 0 && text.charAt(j) === "\\"; j--) slashes++;
    return slashes % 2 === 0;
}

/** First `{{...}}` of the replacement that is not exactly `{{name}}` of a named group of the regex, or `undefined`. */
function unknownReference(replacement: string, names: ReadonlySet<string>): string | undefined {
    for (const found of replacement.matchAll(REPLACEMENT_REF_RE)) {
        const key = EXACT_REF_RE.exec(found[0])?.[1];
        if (key === undefined || !names.has(key)) return found[0];
    }
    return undefined;
}

/** Why a rule that failed `checkPattern` as an instant rule would pass as a separator rule: one short sentence. */
function instantNote(params: { count?: number; limit?: number }): string {
    const limit = params.limit ?? 1;
    const count = params.count ?? 0;
    return `Imported as After a separator: an instant rule can have at most ${limit} open-ended repeat (*, + or {n,}), this pattern has ${count}.`;
}

/**
 * `regex` is the Espanso `regex:` as written (YAML already unescaped), `replacement` the replace text after the
 * importer's own mappings (`$|$`, `{{clipboard}}`).
 */
export function convertEspansoRegex(regex: string, replacement: string): RegexConversion {
    let body = regex;
    let flags = "";
    if (body.startsWith("(?i)")) {
        flags = "i";
        body = body.slice(4);
    }
    const scan = translateBody(body);
    if (!scan.ok) return scan;
    if (scan.names.has("clipboard")) {
        return { ok: false, reason: "has a group named clipboard, which is also the built-in {{clipboard}}." };
    }
    const unknown = unknownReference(replacement, scan.names);
    if (unknown !== undefined) {
        return { ok: false, reason: `uses ${unknown}, which is not written as {{name}} of a named group of the regex.` };
    }

    const source = `/${endsWithAnchor(scan.text) ? scan.text : `${scan.text}$`}/${flags}`;

    let mode: PatternMode = "instant";
    let note: string | undefined;
    const asInstant = checkPattern(source, "instant");
    if (!asInstant.ok) {
        const asSeparator = asInstant.code === "instant_unbounded" ? checkPattern(source, "separator") : undefined;
        if (!asSeparator) return { ok: false, reason: describePatternRefusal(asInstant) };
        if (!asSeparator.ok) return { ok: false, reason: describePatternRefusal(asSeparator) };
        mode = "separator";
        note = instantNote(asInstant.params);
    }

    // The replacement limits (length, half an emoji) live in `compileRule`: one gate for the whole rule.
    const compiled = compileRule({ id: "import", source, replacement, mode });
    if (!compiled.ok) return { ok: false, reason: compiled.reason };
    return note === undefined ? { ok: true, source, mode } : { ok: true, source, mode, note };
}
