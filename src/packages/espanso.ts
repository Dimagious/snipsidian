// Lightweight converter from Espanso YAML to { trigger: replacement }
import * as YAML from "yaml";
import type { EspansoDocument, EspansoMatch } from "../services/package-types";
import { normalizeTrigger } from "../engine/triggers";
import { escapeLiteralTabstops, findFormattedTokens, findVariableTokens, mapTabstops } from "../engine/placeholders";
import { convertEspansoRegex, ESPANSO_NAME_RE, ESPANSO_REF_SOURCE, type EspansoPatternCandidate } from "../core/espanso-regex";

/** One match that couldn't be imported as-is, and why. Surfaced by
 *  the caller (`EspansoSection.ts`) so the user learns "N imported,
 *  M skipped — use forms/scripts Snipsy doesn't support" instead of
 *  silently getting corrupted literal-`{{var}}` text (B-139). */
export interface EspansoSkip {
    /** Best-effort label for the skipped match: its first trigger,
     *  `regex:<pattern>` for regex-only matches, or a generic
     *  placeholder when neither is present. */
    trigger: string;
    reason: string;
    /** `regex` when the label stands for a `regex:` match (it is listed under Pattern rules), else `literal`. */
    kind: "regex" | "literal";
}

export interface EspansoImportResult {
    snippets: Record<string, string>;
    /** ADR-0008: `regex:` matches that passed the pattern gate, ready for `planPatternImport`. */
    patterns: EspansoPatternCandidate[];
    skipped: EspansoSkip[];
}

/** At most this many `regex:` matches of one file are converted; the rest are skipped without being read. A
 *  pattern import can hold 100 rules, so a file with thousands of regexes is not a library, it is an attack on
 *  the importer (S-009: every import path has a limit). */
export const MAX_REGEX_MATCHES = 1000;

/** Var types Espanso supports that Snipsy's static replace-text model
 *  fundamentally can't: they require running code, prompting the
 *  user, or otherwise deciding the output at expansion time. */
const UNSUPPORTED_VAR_TYPES = new Set(["shell", "script", "choice", "form"]);

/**
 * Classifies a `date`-type var's format as mappable to Snipsy's
 * `$date`, mappable to `$time`, or "can't map without changing the
 * output" (`null`).
 *
 * B-139 (checker follow-up): Snipsy renders `$date` as exactly
 * `%Y-%m-%d` and `$time` as exactly `%H:%M` (see
 * `engine/placeholders.ts`'s `formatDate`/`formatTime`). Only those
 * two literal format strings render byte-identical output — anything
 * else (`%d/%m/%Y`, `%H:%M:%S`, locale tokens, ...) would silently
 * reorder or truncate the date/time, so it's a skip, not a guess.
 *
 * An absent `format` param is NOT treated as "date": Espanso's own
 * default for a bare `{type: date}` var is RFC 2822 output (see
 * `espanso-render/src/extension/date.rs`, `DateExtension::calculate`,
 * the `now.to_rfc2822()` fallback — e.g. "Thu, 04 Aug 2026 00:00:00
 * +0000"), which isn't identical to `%Y-%m-%d` either.
 */
function classifyDateFormat(format: unknown): "date" | "time" | null {
    if (typeof format !== "string") return null;
    if (format === "%Y-%m-%d") return "date";
    if (format === "%H:%M") return "time";
    return null;
}

type Verdict = { ok: true; replace: string } | { ok: false; reason: string };

/** The date parameters that change what is rendered and that Snipsy cannot reproduce. */
const DATE_RENDER_PARAMS = new Set(["offset", "locale", "tz"]);

/** What an Espanso variable becomes in Snipsy: the `$date` / `$time` / `$clipboard` placeholder. */
type VarKind = "date" | "time" | "clipboard";

/** The one variable a match declares, with the Snipsy placeholder it maps to. */
interface Declared {
    name: string;
    kind: VarKind;
}

/** `\{\{` and `\}\}`: Espanso turns them into plain braces, which this importer does not reproduce. */
const ESCAPED_BRACES_RE = /\\\{\\\{|\\\}\\\}/;

function clip(token: string): string {
    return token.length > 40 ? `${token.slice(0, 40)}...` : token;
}

/** A run of the plain text (`lit`) or one kept token of the replacement, with where it sits in the original text. */
interface Seg {
    p0: number;
    p1: number;
    o0: number;
    o1: number;
    lit: boolean;
}

/** The text the user wrote for the plain-text range `[s, e)`, so a reason quotes the original, not our rewrite. */
function quoteOriginal(text: string, segs: Seg[], s: number, e: number): string {
    const first = segs.find((g) => g.p0 <= s && s < g.p1);
    const last = segs.find((g) => g.p0 < e && e <= g.p1);
    if (!first || !last) return "";
    const from = first.lit ? first.o0 + (s - first.p0) : first.o0;
    const to = last.lit ? last.o0 + (e - last.p0) : last.o1;
    return text.slice(from, to);
}

/**
 * B-266: the replacement as Snipsy will read it, or the reason it cannot be. Principle: Snipsy must insert exactly
 * what Espanso inserts, or the match is skipped with a reason; text is never changed silently.
 *
 * Espanso knows three things in a replacement: the cursor `$|$`, `{{name}}` of a variable, and plain text. Snipsy
 * reads far more as syntax, so each of these is handled:
 *   - `$|$` becomes `$|`, once: Espanso removes every `$|$` and puts the cursor at the first, so the others are
 *     dropped. `{{name}}` (whitespace inside the braces allowed) of the declared date/time/clipboard variable
 *     becomes `$date` / `$time` / `$clipboard`. As a Snipsy convenience, not an Espanso built-in, an undeclared
 *     `{{clipboard}}` maps to `$clipboard` as well.
 *   - Any other `{{name}}` / `{{name.sub}}` is a variable to Espanso, never text (a missing one is an error there,
 *     a file-level `global_vars:` one is a value Snipsy does not read): the match is skipped. On a regex match such
 *     a reference is a capture group, which the pattern conversion checks.
 *   - `$1`..`$9` in plain text stay text through the engine's own escape `\$N`.
 *   - Plain `$|`, `$date`, `$time`, `$filename`, `$clipboard`, `{{date:FMT}}` and `{{time:FMT}}` are plain text in
 *     Espanso and the engine has no escape for them: the match is skipped.
 *   - The engine ends `$clipboard` and `$date` at a word boundary and fills `{{date}}` / `{{time}}` first, so a
 *     word character after the token, or the digits of a date or time that follows a clipboard token directly,
 *     would make it dead text (`{{d}}{{d}}` alone is fine: `$date$date` fills both). The delimitable `{{date}}` / `{{time}}` render locale digits in some locales, so: skipped.
 *   - A plain `\$1` already is the engine's escape (it would lose the backslash), and `\{\{` / `\}\}` is unescaped
 *     by Espanso: both are skipped.
 */
function translateReplacement(text: string, declared: Declared | undefined, isRegex: boolean): Verdict {
    if (ESCAPED_BRACES_RE.test(text)) {
        return { ok: false, reason: 'contains "\\{\\{" or "\\}\\}", which Espanso turns into plain braces and Snipsy would keep as written' };
    }
    const tokenRe = new RegExp(`(\\$\\|\\$)|${ESPANSO_REF_SOURCE}`, "gu");
    const form = (kind: "cursor" | VarKind): string => (kind === "cursor" ? "$|" : `$${kind}`);
    const literals: string[] = [];
    const kinds: Array<"cursor" | VarKind> = [];
    const segs: Seg[] = [];
    let plain = "";
    let cur = "";
    let last = 0;
    let cursorSeen = false;
    let usedDeclared = false;
    const addLit = (chunk: string, o0: number): void => {
        if (chunk === "") return;
        segs.push({ p0: plain.length, p1: plain.length + chunk.length, o0, o1: o0 + chunk.length, lit: true });
        plain += chunk;
        cur += chunk;
    };
    for (const hit of text.matchAll(tokenRe)) {
        const at = hit.index ?? 0;
        addLit(text.slice(last, at), last);
        last = at + hit[0].length;
        let kind: "cursor" | VarKind;
        if (hit[1] !== undefined) {
            if (cursorSeen) continue;
            cursorSeen = true;
            kind = "cursor";
        } else {
            const name = hit[2] ?? "";
            if (declared !== undefined && name === declared.name) {
                kind = declared.kind;
                usedDeclared = true;
            } else if (name === "clipboard") {
                kind = "clipboard";
            } else if (isRegex) {
                addLit(hit[0], at);
                continue;
            } else {
                return { ok: false, reason: `uses ${clip(hit[0])}, a variable this match does not declare (file-level global_vars are not read)` };
            }
        }
        literals.push(cur);
        cur = "";
        kinds.push(kind);
        segs.push({ p0: plain.length, p1: plain.length + form(kind).length, o0: at, o1: last, lit: false });
        plain += form(kind);
    }
    addLit(text.slice(last), last);
    literals.push(cur);

    if (declared !== undefined && !usedDeclared) {
        return { ok: false, reason: `uses a ${declared.kind === "clipboard" ? "clipboard" : "date"} variable Snipsy can't map` };
    }

    for (const lit of literals) {
        if (lit.includes("$|")) {
            return { ok: false, reason: 'contains "$|" as plain text, which Snipsy would read as its cursor marker' };
        }
        const token = findVariableTokens(lit)[0];
        if (token !== undefined) {
            return { ok: false, reason: `contains "${token}" as plain text, which Snipsy would fill in with a value` };
        }
    }

    let out = "";
    for (const [i, kind] of kinds.entries()) {
        const after = literals[i + 1] ?? "";
        const next = kinds[i + 1];
        const piece = form(kind);
        // `$date` / `$time` end where a word character starts, and the global fill of `$date$date` is fine. Date and
        // time are filled first, so only a clipboard token followed directly by one of them is glued like one before a letter.
        const glued = /^\w/.test(after) || (kind === "clipboard" && after === "" && (next === "date" || next === "time"));
        if (kind !== "cursor" && glued) {
            const why = after === "" ? "a date or time" : `"${clip(after.slice(0, 1))}"`;
            // `{{date}}` / `{{time}}` would end the token, but they render locale digits (ar, fa, hi, bn) where Espanso gives ASCII.
            return { ok: false, reason: `has ${why} right after the ${kind} variable, which Snipsy would read as part of the placeholder name` };
        }
        out += (literals[i] ?? "") + piece;
    }
    out += literals[kinds.length] ?? "";

    const formatted = findFormattedTokens(plain)[0];
    if (formatted !== undefined) {
        const s = plain.indexOf(formatted);
        const shown = quoteOriginal(text, segs, s, s + formatted.length) || formatted;
        return { ok: false, reason: `contains "${clip(shown)}" as plain text, which Snipsy would fill in with the date or time` };
    }

    const escaped = escapeLiteralTabstops(out);
    // Whatever the engine would still read as a field, or an escape it would eat, changes the text.
    if (mapTabstops(escaped, () => "\u0000") !== out) {
        return { ok: false, reason: 'contains a backslash before "$" and a digit, which Snipsy reads as an escape' };
    }
    return { ok: true, replace: escaped };
}

/**
 * Decide whether a single match can be imported, and if so compute
 * its final replacement text (after the free-win substitutions).
 * Returns a skip reason otherwise. Pure — no I/O, no mutation.
 */
function classifyMatch(m: EspansoMatch): Verdict {
    if (m.form !== undefined || m.form_fields !== undefined) {
        return { ok: false, reason: "uses a form" };
    }
    const isRegex = typeof m.regex === "string";
    if (isRegex && (m.trigger !== undefined || m.triggers !== undefined)) {
        return { ok: false, reason: "has both a trigger and a regex" };
    }
    // Espanso's `word`, `left_word` and `right_word` are boundary checks on the typed text before the trigger.
    // A pattern has no such option, and wrapping the regex in `\b` is only the same when it starts and ends with
    // a word character, which we cannot tell from here: so a regex that asks for one is skipped, not guessed.
    if (isRegex && (m.word || m.left_word || m.right_word)) {
        return { ok: false, reason: "uses word matching (word, left_word or right_word) that a pattern can't do" };
    }
    if (m.propagate_case || m.uppercase_style !== undefined) {
        return { ok: false, reason: "uses case propagation" };
    }
    if (m.image_path !== undefined) {
        return { ok: false, reason: "is an image match" };
    }

    const replace: string | undefined =
        typeof m.replace === "string" ? m.replace
            : typeof m.replace_text === "string" ? m.replace_text
                : typeof m.output === "string" ? m.output
                    : undefined;

    if (replace === undefined) {
        if (m.markdown !== undefined || m.html !== undefined) {
            return { ok: false, reason: "uses markdown/html content Snipsy can't map" };
        }
        return { ok: false, reason: "has no replacement text Snipsy can read" };
    }

    // Without a declared variable only the `{{clipboard}}` convenience maps.
    let declared: Declared | undefined;
    if (Array.isArray(m.vars) && m.vars.length > 0) {
        for (const v of m.vars) {
            if (v && typeof v.type === "string" && UNSUPPORTED_VAR_TYPES.has(v.type)) {
                return { ok: false, reason: `uses a "${v.type}" variable` };
            }
        }
        // A regex match imports as a pattern whose `{{name}}` are its capture groups: a variable of the same
        // name would be ambiguous, so any `vars:` on a regex match is a skip.
        if (isRegex) return { ok: false, reason: "uses variables Snipsy doesn't support" };

        // The only var shapes this importer maps automatically: exactly
        // one var, of type "date" with a trivial format or of type
        // "clipboard", actually referenced in the replacement text.
        // Anything else involving `vars:` (multiple vars, unrecognized
        // types, an unmapped format) is a skip: better an honest skip
        // than a guess that silently produces the wrong text.
        const single = m.vars.length === 1 ? m.vars[0] : undefined;
        const dateKind = single ? classifyDateFormat(single.params?.format) : null;
        const kind: VarKind | null = single?.type === "clipboard" ? "clipboard" : single?.type === "date" ? dateKind : null;
        // Only a name in Espanso's reference shape can be referenced at all; anything else (empty, `my-var`,
        // `a.b`) never matches a `{{...}}` there, so a "mapping" would turn literal text into a value.
        if (!single || !kind || typeof single.name !== "string" || !ESPANSO_NAME_RE.test(single.name)) {
            return { ok: false, reason: "uses variables Snipsy doesn't support" };
        }
        // `offset`, `tz` and `locale` change what a date renders.
        // Other keys are ignored by Espanso as well, so ignoring them is faithful.
        const extra = single.type === "date" ? Object.keys(single.params ?? {}).filter((k) => DATE_RENDER_PARAMS.has(k)) : [];
        if (extra.length > 0) {
            return { ok: false, reason: `uses a date variable with ${extra.slice(0, 3).map((k) => `"${clip(k)}"`).join(", ")}, which Snipsy can't map` };
        }
        declared = { name: single.name, kind };
    }

    return translateReplacement(replace, declared, isRegex);
}

/**
 * Supported Espanso fields:
 *   matches:
 *     - trigger: ":brb"        // or 'triggers: [":brb", ":omw"]'
 *       replace: "be right back"
 *
 * B-139: matches using constructs Snipsy's static replace-text model
 * can't represent (forms, shell/script/choice vars, case propagation,
 * image matches, markdown/html-only content) are
 * no longer imported as literal `{{corrupted}}` text — they're
 * skipped and reported via `skipped`, with three trivial free-win
 * mappings applied before anything is judged unsupported: Espanso's
 * `$|$` cursor placeholder → `$|`, `{{clipboard}}` → `$clipboard` (a Snipsy convenience),
 * and a single plain `date`-type var → `$date`/`$time`.
 *
 * ADR-0008: a `regex:` match imports as a pattern rule (`patterns`) when
 * `convertEspansoRegex` accepts it; otherwise it is skipped with the
 * reason the Patterns page would give.
 *
 * Trigger normalisation (leading/trailing colon strip + whitespace
 * trim) lives in `engine/triggers.ts:normalizeTrigger` so both this
 * importer and the community-packages install path apply the same
 * rules.
 */
export function espansoYamlToSnippets(text: string): EspansoImportResult {
    const doc = YAML.parse(text) as EspansoDocument;
    const snippets: Record<string, string> = {};
    const patterns: EspansoPatternCandidate[] = [];
    const skipped: EspansoSkip[] = [];
    if (!doc || typeof doc !== "object") return { snippets, patterns, skipped };
    let regexSeen = 0;

    const arr = Array.isArray(doc.matches) ? doc.matches : [];
    for (const m of arr) {
        if (!m) continue;

        const triggerCandidates: string[] = [];
        if (typeof m.trigger === "string") triggerCandidates.push(m.trigger);
        if (Array.isArray(m.triggers)) {
            for (const tt of m.triggers) {
                if (typeof tt === "string") triggerCandidates.push(tt);
            }
        }

        const verdict = classifyMatch(m);
        if (!verdict.ok) {
            // Normalize the label the same way a successful import
            // would key it, so the skip report reads consistently
            // with the trigger names that DID import (no stray
            // leading colons in one list but not the other).
            const rawLabel = triggerCandidates[0];
            const label = rawLabel
                ? (normalizeTrigger(rawLabel) || rawLabel)
                : (typeof m.regex === "string" ? `regex:${m.regex}` : "(unnamed match)");
            const kind = !rawLabel && typeof m.regex === "string" ? "regex" : "literal";
            skipped.push({ trigger: label, reason: verdict.reason, kind });
            continue;
        }

        if (typeof m.regex === "string") {
            const label = `regex:${m.regex}`;
            if (++regexSeen > MAX_REGEX_MATCHES) {
                skipped.push({ trigger: label, reason: `is past the ${MAX_REGEX_MATCHES} regex limit of one import`, kind: "regex" });
                continue;
            }
            const converted = convertEspansoRegex(m.regex, verdict.replace);
            if (!converted.ok) {
                skipped.push({ trigger: label, reason: converted.reason, kind: "regex" });
                continue;
            }
            patterns.push({
                label,
                source: converted.source,
                replacement: verdict.replace,
                mode: converted.mode,
                ...(converted.note === undefined ? {} : { note: converted.note }),
            });
            continue;
        }

        // YAML.parse already converts string escapes ("foo\nbar") to real
        // characters; nothing further to normalise here. (The previous
        // CURSOR_PLACEHOLDER and \\n→\n substitutions were no-ops — removed
        // in 1.0.9.)
        for (const raw of triggerCandidates) {
            const t = normalizeTrigger(raw);
            if (t) snippets[t] = verdict.replace;
        }
    }

    return { snippets, patterns, skipped };
}
