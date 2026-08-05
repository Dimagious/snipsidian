// Lightweight converter from Espanso YAML to { trigger: replacement }
import * as YAML from "yaml";
import type { EspansoDocument, EspansoMatch } from "../services/package-types";
import { normalizeTrigger } from "../engine/triggers";

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
}

export interface EspansoImportResult {
    snippets: Record<string, string>;
    skipped: EspansoSkip[];
}

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

/**
 * Decide whether a single match can be imported, and if so compute
 * its final replacement text (after the free-win substitutions).
 * Returns a skip reason otherwise. Pure — no I/O, no mutation.
 */
function classifyMatch(m: EspansoMatch): Verdict {
    if (m.form !== undefined || m.form_fields !== undefined) {
        return { ok: false, reason: "uses a form" };
    }
    if (typeof m.regex === "string") {
        return { ok: false, reason: "uses a regex trigger" };
    }
    if (m.propagate_case || m.uppercase_style !== undefined) {
        return { ok: false, reason: "uses case propagation" };
    }
    if (m.image_path !== undefined) {
        return { ok: false, reason: "is an image match" };
    }

    let replace: string | undefined =
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

    if (Array.isArray(m.vars) && m.vars.length > 0) {
        for (const v of m.vars) {
            if (v && typeof v.type === "string" && UNSUPPORTED_VAR_TYPES.has(v.type)) {
                return { ok: false, reason: `uses a "${v.type}" variable` };
            }
        }

        // The only var shape this importer maps automatically: exactly
        // one var, of type "date", with a trivial format, actually
        // referenced in the replacement text. Anything else involving
        // `vars:` (multiple vars, unrecognized types, an unmapped
        // format) is a skip — better an honest skip than a guess that
        // silently produces the wrong date/time.
        const single = m.vars.length === 1 ? m.vars[0] : undefined;
        const kind = single ? classifyDateFormat(single.params?.format) : null;
        if (single && single.type === "date" && kind && typeof single.name === "string") {
            const placeholder = `{{${single.name}}}`;
            if (!replace.includes(placeholder)) {
                return { ok: false, reason: "uses a date variable Snipsy can't map" };
            }
            replace = replace.split(placeholder).join(kind === "date" ? "$date" : "$time");
        } else {
            return { ok: false, reason: "uses variables Snipsy doesn't support" };
        }
    }

    // Free-win text-level mappings — Espanso's cursor placeholder and
    // its built-in `{{clipboard}}` magic variable both translate
    // directly to Snipsy placeholders with no ambiguity.
    replace = replace.split("$|$").join("$|");
    replace = replace.split("{{clipboard}}").join("$clipboard");

    return { ok: true, replace };
}

/**
 * Supported Espanso fields:
 *   matches:
 *     - trigger: ":brb"        // or 'triggers: [":brb", ":omw"]'
 *       replace: "be right back"
 *
 * B-139: matches using constructs Snipsy's static replace-text model
 * can't represent (forms, shell/script/choice vars, regex triggers,
 * case propagation, image matches, markdown/html-only content) are
 * no longer imported as literal `{{corrupted}}` text — they're
 * skipped and reported via `skipped`, with three trivial free-win
 * mappings applied before anything is judged unsupported: Espanso's
 * `$|$` cursor placeholder → `$|`, `{{clipboard}}` → `$clipboard`,
 * and a single plain `date`-type var → `$date`/`$time`.
 *
 * Trigger normalisation (leading/trailing colon strip + whitespace
 * trim) lives in `engine/triggers.ts:normalizeTrigger` so both this
 * importer and the community-packages install path apply the same
 * rules.
 */
export function espansoYamlToSnippets(text: string): EspansoImportResult {
    const doc = YAML.parse(text) as EspansoDocument;
    const snippets: Record<string, string> = {};
    const skipped: EspansoSkip[] = [];
    if (!doc || typeof doc !== "object") return { snippets, skipped };

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
            skipped.push({ trigger: label, reason: verdict.reason });
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

    return { snippets, skipped };
}
