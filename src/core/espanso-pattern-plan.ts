import { compileRule, MAX_PATTERN_RULES } from "../engine/patterns";
import type { PatternMode, PatternRule } from "../engine/types";
import type { SnipSidianSettings } from "../types";
import type { EspansoPatternCandidate } from "./espanso-regex";
import { appendRule, newPatternId, patternsUnreadable, readPatterns, ruleId } from "./pattern-list";

/**
 * ADR-0008, Imports: what an Espanso import would add to `settings.patterns`, decided before anything is written.
 * Pure: no `Notice`, no DOM, `settings` is only read. This is the pattern side of the S-009 rule (every write path
 * into the stored lists runs the limit check before the write): the candidates already went through the S-015 gate in
 * `convertEspansoRegex`, and each one goes through `compileRule` again here, so the plan stands on its own; then the
 * duplicate check and the 100-rule cap (`appendRule`, the one place that knows it), counted against the rules the
 * person already has.
 *
 * The caller plans once for the preview and again inside the Apply handler, so what is written is checked against
 * the settings as they are at that moment. The write itself is `commitSnippetsAndPatterns` (snippets and rules
 * with one save), not `commitPatterns`: an Espanso import writes both lists.
 */

/** A group name a snippet import accepts is at most 50 characters (`validatePackageForInstall`); patterns follow it. */
export const IMPORT_GROUP_MAX = 50;

export type PatternPreviewRow = {
    label: string;
    source: string;
    replacement: string;
    mode: PatternMode;
    note?: string;
};

export type PatternSkipRow = { label: string; reason: string };

export type PatternImportPlan = {
    /** The rules to append, in file order: enabled, in the import's group. */
    add: PatternRule[];
    /** One row per rule in `add`, for the preview. */
    rows: PatternPreviewRow[];
    /** Candidates left out here (a duplicate, past the cap, a gate failure); the parser's own skips are not repeated. */
    skipped: PatternSkipRow[];
};

export function field(rule: unknown, key: string): unknown {
    return typeof rule === "object" && rule !== null ? Reflect.get(rule, key) : undefined;
}

export function dedupeKey(source: unknown, replacement: unknown): string | undefined {
    return typeof source === "string" && typeof replacement === "string" ? JSON.stringify([source, replacement]) : undefined;
}

export const REASON_DUPLICATE = "already there.";
export const REASON_OVER_LIMIT = `over the ${MAX_PATTERN_RULES} rule limit.`;
export const REASON_UNREADABLE = "your stored pattern rules could not be read, so none were added.";
export const REASON_GROUP_EMPTY = "the group name is empty.";
export const REASON_GROUP_TOO_LONG = `the group name is longer than ${IMPORT_GROUP_MAX} characters.`;

export function planPatternImport(
    candidates: readonly EspansoPatternCandidate[],
    groupSlug: string,
    settings: Pick<SnipSidianSettings, "patterns">,
    makeId: () => string = newPatternId,
): PatternImportPlan {
    const plan: PatternImportPlan = { add: [], rows: [], skipped: [] };
    if (candidates.length === 0) return plan;

    const refuseAll = (reason: string): PatternImportPlan => {
        for (const c of candidates) plan.skipped.push({ label: c.label, reason });
        return plan;
    };
    if (groupSlug === "") return refuseAll(REASON_GROUP_EMPTY);
    if (groupSlug.length > IMPORT_GROUP_MAX) return refuseAll(REASON_GROUP_TOO_LONG);
    // The page shows an unreadable value as empty and must not overwrite it unasked; neither may an import.
    if (patternsUnreadable(settings)) return refuseAll(REASON_UNREADABLE);

    const existing = readPatterns(settings);
    let list: readonly PatternRule[] = existing;
    const takenIds = new Set<string>();
    const seen = new Set<string>();
    for (const rule of existing) {
        const id = ruleId(rule);
        if (id !== undefined) takenIds.add(id);
        const key = dedupeKey(field(rule, "source"), field(rule, "replacement"));
        if (key !== undefined) seen.add(key);
    }

    for (const c of candidates) {
        const gate = compileRule({ id: "import", source: c.source, replacement: c.replacement, mode: c.mode, group: groupSlug });
        if (!gate.ok) {
            plan.skipped.push({ label: c.label, reason: gate.reason });
            continue;
        }
        const key = dedupeKey(c.source, c.replacement);
        if (key !== undefined && seen.has(key)) {
            plan.skipped.push({ label: c.label, reason: REASON_DUPLICATE });
            continue;
        }
        let id = makeId();
        while (takenIds.has(id)) id = makeId();
        const rule: PatternRule = { id, source: c.source, replacement: c.replacement, enabled: true, mode: c.mode, group: groupSlug };
        const grown = appendRule(list, rule);
        if (grown === null) {
            plan.skipped.push({ label: c.label, reason: REASON_OVER_LIMIT });
            continue;
        }
        list = grown;
        takenIds.add(id);
        if (key !== undefined) seen.add(key);
        plan.add.push(rule);
        plan.rows.push({ label: c.label, source: c.source, replacement: c.replacement, mode: c.mode, ...(c.note === undefined ? {} : { note: c.note }) });
    }
    return plan;
}
