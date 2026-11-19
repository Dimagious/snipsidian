import { MAX_PATTERN_RULES } from "../engine/patterns";
import type { PatternRule } from "../engine/types";
import type { SnipSidianSettings } from "../types";
import { STARTER_RULES } from "./pattern-starter";

/**
 * ADR-0008, Patterns page: pure operations on the rule list (order is the priority) and the one commit path.
 * The 100-rule cap lives here, so no write path can go past it. The S-015 gate is not repeated: a rule is
 * validated by the editor before it gets here, and whatever is stored is compiled through the gate on load anyway.
 */

/** The id of a stored entry, or `undefined` for one that has none (a hand-edited data.json can hold anything). */
export function ruleId(rule: unknown): string | undefined {
    const id: unknown = typeof rule === "object" && rule !== null ? Reflect.get(rule, "id") : undefined;
    return typeof id === "string" && id !== "" ? id : undefined;
}

/** A stored entry that can be a rule at all: an object. `null`, strings, numbers and arrays are slots to delete. */
export function isRuleObject(entry: unknown): entry is object {
    return typeof entry === "object" && entry !== null && !Array.isArray(entry);
}

/** Where the entry with the unique id `id` sits now; -1 if none. */
export function locateRule(rules: readonly unknown[], id: string): number {
    return rules.findIndex((r) => ruleId(r) === id);
}

/**
 * The list with every object entry made addressable: one that has no string id, or whose id repeats an earlier
 * entry's, gets a fresh unique one on a copy (the stored entry is not touched). Everything else, including entries
 * that are not objects, keeps its identity. The page tracks rows, editor and menus by these ids alone.
 */
export function withUniqueIds(rules: readonly unknown[], makeId: () => string = newPatternId): PatternRule[] {
    const seen = new Set<string>();
    for (const r of rules) {
        const id = ruleId(r);
        if (id !== undefined) seen.add(id);
    }
    const taken = new Set<string>();
    return rules.map((entry): PatternRule => {
        if (!isRuleObject(entry)) return entry as PatternRule;
        const id = ruleId(entry);
        if (id !== undefined && !taken.has(id)) {
            taken.add(id);
            return entry as PatternRule;
        }
        let fresh = makeId();
        while (seen.has(fresh) || taken.has(fresh)) fresh = makeId();
        taken.add(fresh);
        return { ...(entry as PatternRule), id: fresh };
    });
}

/** What an unreadable stored value looked like, for the log line written before it is replaced (cut to `max`). */
export function describeUnreadable(value: unknown, max = 500): string {
    let text: string;
    try {
        text = JSON.stringify(value) ?? String(value);
    } catch {
        text = String(value);
    }
    return text.length > max ? `${text.slice(0, max)}... (${text.length} characters)` : text;
}

/** `settings.patterns` as a list: `data.json` can hold anything, and anything but an array reads as empty. */
export function readPatterns(settings: Pick<SnipSidianSettings, "patterns">): PatternRule[] {
    const value: unknown = settings.patterns;
    // `Array.isArray` narrows to `any[]`; the entries are checked one by one where they are read.
    return Array.isArray(value) ? (value as PatternRule[]) : [];
}

/** A stored value that is neither absent nor a list: the page shows it as empty and must not overwrite it unasked. */
export function patternsUnreadable(settings: Pick<SnipSidianSettings, "patterns">): boolean {
    const value: unknown = settings.patterns;
    return value !== undefined && value !== null && !Array.isArray(value);
}

function ruleSource(rule: unknown): unknown {
    return typeof rule === "object" && rule !== null ? Reflect.get(rule, "source") : undefined;
}

/** Stable id for a new rule: not derived from the pattern, so editing it never changes it. */
export function newPatternId(random: () => number = Math.random, now: () => number = Date.now): string {
    return `p${now().toString(36)}${Math.floor(random() * 36 ** 6).toString(36).padStart(6, "0")}`;
}

export function freeSlots(rules: readonly PatternRule[]): number {
    return Math.max(0, MAX_PATTERN_RULES - rules.length);
}

export function canAddRules(rules: readonly PatternRule[], count = 1): boolean {
    return rules.length + count <= MAX_PATTERN_RULES;
}

/** Appends at the end (lowest priority). Refuses past the cap. */
export function appendRule(rules: readonly PatternRule[], rule: PatternRule): PatternRule[] | null {
    return canAddRules(rules) ? [...rules, rule] : null;
}

/** Drops the slot `index`. */
export function removeRule(rules: readonly PatternRule[], index: number): PatternRule[] {
    return rules.filter((_, i) => i !== index);
}

/** Puts `rule` in the slot `index` (not "every entry with this id"). `null` when there is no such slot. */
export function replaceRule(rules: readonly PatternRule[], index: number, rule: PatternRule): PatternRule[] | null {
    if (index < 0 || index >= rules.length) return null;
    return rules.map((r, i) => (i === index ? rule : r));
}

/** Moves the rule at `from` one place; `null` at the edge or for no such slot. */
export function moveRule(rules: readonly PatternRule[], from: number, delta: -1 | 1): PatternRule[] | null {
    return moveRuleTo(rules, from, from + delta, true);
}

/** Moves the rule at `from` to an index (drag and drop). `null` when nothing changes. */
export function moveRuleTo(rules: readonly PatternRule[], from: number, to: number, strict = false): PatternRule[] | null {
    const rule = rules[from];
    if (!rule || (strict && (to < 0 || to >= rules.length))) return null;
    const target = Math.min(Math.max(to, 0), rules.length - 1);
    if (target === from) return null;
    const next = [...rules];
    next.splice(from, 1);
    next.splice(target, 0, rule);
    return next;
}

/** Starter rules whose pattern the list does not have yet (by source: an edited replacement still counts as present). */
export function missingStarterRules(rules: readonly PatternRule[]): typeof STARTER_RULES {
    const have = new Set(rules.map(ruleSource));
    return STARTER_RULES.filter((s) => !have.has(s.source));
}

/** Rules for the missing starter patterns, appended in the starter's order. `null` when they do not all fit. */
export function addMissingStarter(rules: readonly PatternRule[], makeId: () => string): PatternRule[] | null {
    const missing = missingStarterRules(rules);
    if (missing.length === 0 || !canAddRules(rules, missing.length)) return null;
    return [...rules, ...missing.map((s) => ({ ...s, id: makeId(), enabled: true }))];
}

/** The entry value of the page: `No rules` / `1 rule` / `12 rules` / `12 rules, 1 with an error`. */
export function formatPatternsSummary(count: number, errors: number): string {
    if (count === 0) return "No rules";
    const base = `${count} ${count === 1 ? "rule" : "rules"}`;
    return errors > 0 ? `${base}, ${errors} with an error` : base;
}

/**
 * Replaces `settings.patterns`, persists, and puts the previous list back when persisting fails (the same contract
 * as `commitSnippets`, B-181), so a failed save never leaves a rule live in memory that is not on disk. The list is
 * put back only while it is still the one this call set: a newer write that replaced it is not undone.
 */
export async function commitPatterns(
    settings: Pick<SnipSidianSettings, "patterns">,
    next: PatternRule[],
    save: () => Promise<void>,
): Promise<void> {
    const previous = settings.patterns;
    settings.patterns = next;
    try {
        await save();
    } catch (err) {
        if (settings.patterns === next) settings.patterns = previous;
        throw err;
    }
}
