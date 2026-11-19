import { MAX_PATTERN_RULES } from "../engine/patterns";
import type { PatternMode, PatternRule } from "../engine/types";
import type { SnipSidianSettings } from "../types";
import { isRecordOfString } from "../shared/guards";
import { dedupeKey, field, REASON_OVER_LIMIT, REASON_UNREADABLE } from "./espanso-pattern-plan";
import type { PatternPreviewRow, PatternSkipRow } from "./espanso-pattern-plan";
import { storedRuleProblem } from "./pattern-draft";
import { appendRule, canAddRules, isRuleObject, newPatternId, patternsUnreadable, readPatterns, withUniqueIds } from "./pattern-list";

/**
 * ADR-0008, JSON backup. The backup file stays what it always was: one flat object of `{ key: replacement }`
 * strings, which every older Snipsy reads with `isRecordOfString`. A `patterns` array in that object would make an
 * older Snipsy refuse the whole file ("Invalid JSON"), so the rules travel as ONE more string entry: the rule list
 * as JSON text, under a key no trigger can have.
 *
 * `PATTERNS_EXPORT_KEY` holds a space, which is forbidden in a trigger and a separator, so:
 *   - Snipsy 1.7.0 and later (S-014 gate) lists it as a skipped key and writes nothing for it;
 *   - Snipsy before 1.7.0 stores it as a snippet that can never fire (a trigger with a space is never matched).
 * The import also accepts a top-level `patterns` array (the shape the ADR first sketched), so a hand-written file works.
 *
 * Pure: no Obsidian, no DOM. Every import goes through `planJsonPatternImport`, which is the S-009 limit check for
 * this write path: the S-015 pattern gate per rule, unique ids, the 100 rule cap.
 */
export const PATTERNS_EXPORT_KEY = "snipsy patterns";

/**
 * Entries of an incoming list that are looked at at all. A file past the cap cannot add more than the cap, and every
 * look runs the pattern gate and a compile, so a hostile file with a million entries must not make the preview freeze.
 */
export const MAX_INCOMING_PATTERNS_EXAMINED = MAX_PATTERN_RULES * 5;

/** What the Export button writes: the snippets as they were, plus the stored rules (as stored) when there are any. */
export function buildBackupObject(settings: Pick<SnipSidianSettings, "snippets" | "patterns">): Record<string, string> {
    const backup: Record<string, string> = { ...settings.snippets };
    // A snippet that already sits under our own key (a new backup imported by a Snipsy before 1.7.0) is stale text,
    // never the rules: drop it first so it is not exported as rules and does not break Snipsy's own import.
    delete backup[PATTERNS_EXPORT_KEY];
    const rules = readPatterns(settings);
    if (rules.length > 0) backup[PATTERNS_EXPORT_KEY] = JSON.stringify(rules);
    return backup;
}

export type BackupFile =
    | { ok: true; snippets: Record<string, string>; patterns: unknown[] | null }
    | { ok: false; message: string };

export const INVALID_FILE_MESSAGE = "Invalid JSON: must be an object of { trigger: replacement } strings";
export const INVALID_PATTERNS_MESSAGE = "Invalid JSON: the pattern rules in this file are not a list";

function ownEntries(value: object): Array<[string, unknown]> {
    return Object.entries(value);
}

/**
 * Splits a parsed backup file into its snippets and its rule list (`null` = the file carries no rules). A string
 * under `patterns` is a snippet like any other; only an array there is a rule list.
 */
export function readBackupFile(parsed: unknown): BackupFile {
    if (typeof parsed !== "object" || parsed === null) return { ok: false, message: INVALID_FILE_MESSAGE };
    let patterns: unknown[] | null = null;
    const rest: Array<[string, unknown]> = [];
    for (const [key, value] of ownEntries(parsed)) {
        if (key === PATTERNS_EXPORT_KEY) {
            if (typeof value !== "string") return { ok: false, message: INVALID_PATTERNS_MESSAGE };
            let decoded: unknown;
            try {
                decoded = JSON.parse(value);
            } catch {
                return { ok: false, message: INVALID_PATTERNS_MESSAGE };
            }
            if (!Array.isArray(decoded)) return { ok: false, message: INVALID_PATTERNS_MESSAGE };
            patterns = decoded as unknown[];
        } else if (key === "patterns" && Array.isArray(value)) {
            // The `snipsy patterns` entry is the format Snipsy writes: it wins over a top-level array whatever the order.
            patterns ??= value as unknown[];
        } else {
            rest.push([key, value]);
        }
    }
    // Own data properties only (`Object.fromEntries`): a `__proto__` key stays a plain key (S-004).
    const snippets: unknown = Object.fromEntries(rest);
    if (!isRecordOfString(snippets)) return { ok: false, message: INVALID_FILE_MESSAGE };
    return { ok: true, snippets, patterns };
}

export type JsonPatternPlan = {
    /** The list to store, or `null` when the stored value must be left alone (it is not a list). */
    next: PatternRule[] | null;
    /** One row per rule that is added (in Replace: every rule that is kept), for the preview. */
    rows: PatternPreviewRow[];
    /** Rules of the file that are left out, each with the sentence the Patterns page uses. */
    skipped: PatternSkipRow[];
    /** Rules already in the list (same pattern and replacement), Merge only. */
    unchanged: number;
    /** Rules of the current list that Replace drops. */
    removed: number;
};

function label(entry: unknown, index: number): string {
    const source = field(entry, "source");
    return typeof source === "string" && source !== "" ? source : `Entry ${index + 1}`;
}

function modeOf(entry: unknown): PatternMode {
    return field(entry, "mode") === "separator" ? "separator" : "instant";
}

/**
 * What importing `incoming` would store, decided before anything is written, against `settings` as they are NOW
 * (the caller plans again inside Apply). A rule is stored as the file has it (unknown fields included) unless it has
 * no id: it then gets a fresh one and is switched off, as the Patterns page does (`withUniqueIds`).
 *
 * Merge appends the rules the list does not hold yet (same pattern and replacement) after the existing ones, which
 * stay untouched. Replace swaps the whole list for the file's rules. Both: a rule the S-015 gate refuses is left out
 * with the page's sentence, and the list never grows past the 100 rule cap. A stored value that is not a list is not
 * overwritten (no rule is added; the same rule as the page and the Espanso import).
 */
export function planJsonPatternImport(
    incoming: readonly unknown[],
    mode: "merge" | "replace",
    settings: Pick<SnipSidianSettings, "patterns">,
    makeId: () => string = newPatternId,
): JsonPatternPlan {
    const plan: JsonPatternPlan = { next: null, rows: [], skipped: [], unchanged: 0, removed: 0 };
    if (patternsUnreadable(settings)) {
        incoming.forEach((entry, i) => plan.skipped.push({ label: label(entry, i), reason: REASON_UNREADABLE }));
        return plan;
    }

    const existing: PatternRule[] = mode === "merge" ? readPatterns(settings) : [];
    plan.removed = mode === "replace" ? readPatterns(settings).length : 0;
    // Ids are made unique across the kept rules and the file's, so a merged rule never takes an existing id.
    const entries = withUniqueIds([...existing, ...incoming], makeId).slice(existing.length) as unknown[];

    const seen = new Set<string>();
    if (mode === "merge") {
        for (const rule of existing) {
            const key = dedupeKey(field(rule, "source"), field(rule, "replacement"));
            if (key !== undefined) seen.add(key);
        }
    }

    let list: readonly PatternRule[] = existing;
    entries.forEach((entry, i) => {
        const name = label(entry, i);
        // Past the cap, or past what is worth reading: not compiled at all.
        if (!canAddRules(list) || i >= MAX_INCOMING_PATTERNS_EXAMINED) {
            plan.skipped.push({ label: name, reason: REASON_OVER_LIMIT });
            return;
        }
        const problem = isRuleObject(entry) ? storedRuleProblem(entry, 0) : "This entry is not a rule.";
        if (problem !== null) {
            plan.skipped.push({ label: name, reason: problem });
            return;
        }
        const key = mode === "merge" ? dedupeKey(field(entry, "source"), field(entry, "replacement")) : undefined;
        if (key !== undefined && seen.has(key)) {
            plan.unchanged++;
            return;
        }
        const grown = appendRule(list, entry as PatternRule);
        if (grown === null) {
            plan.skipped.push({ label: name, reason: REASON_OVER_LIMIT });
            return;
        }
        list = grown;
        if (key !== undefined) seen.add(key);
        plan.rows.push({
            label: name,
            source: String(field(entry, "source")),
            replacement: String(field(entry, "replacement")),
            mode: modeOf(entry),
        });
    });
    plan.next = [...list];
    return plan;
}
