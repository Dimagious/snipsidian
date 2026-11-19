import {
    checkPattern,
    compileRule,
    hasLoneSurrogate,
    MAX_PATTERN_REPLACEMENT,
    MAX_PATTERN_RULES,
} from "../engine/patterns";
import type { PatternMode } from "../engine/types";
import { describePatternRefusal } from "./pattern-reasons";

/**
 * ADR-0008, Patterns page: validation of what the editor holds (a draft) and of a stored rule. The pattern goes
 * through the S-015 gate (`checkPattern`) with the draft's MODE (the limits differ per mode); the editor only
 * words the refusal. Nothing here writes settings.
 */

export type PatternDraft = { source: string; replacement: string; mode: PatternMode };

export type DraftIssues = {
    /** Why the pattern is refused, in a sentence; absent when it passes or is still empty. */
    pattern?: string;
    replacement?: string;
    /** Soft warnings: Save stays allowed. */
    warnings: string[];
    /** True when the draft can be saved. */
    ok: boolean;
};

export const REPLACEMENT_TOO_LONG = `Keep the replacement to ${MAX_PATTERN_REPLACEMENT.toLocaleString("en-US")} characters.`;
export const REPLACEMENT_HALF_EMOJI = "The replacement contains half of an emoji. Paste the emoji again.";
export const OVER_RULE_LIMIT = `Skipped: over the ${MAX_PATTERN_RULES} rule limit.`;

/** How many numbered groups the pattern body has: `(`, `(?<name>`; not `(?:`, `(?<=`, `(?<!`, escaped or in a class. */
export function countCaptureGroups(source: string): number {
    const m = /^\/([\s\S]+)\/[a-z]*$/.exec(source);
    const body = m?.[1] ?? "";
    let count = 0;
    let inClass = false;
    for (let i = 0; i < body.length; i++) {
        const c = body[i];
        if (c === "\\") {
            i++;
        } else if (inClass) {
            if (c === "]") inClass = false;
        } else if (c === "[") {
            inClass = true;
        } else if (c === "(") {
            if (body[i + 1] !== "?") count++;
            else if (body[i + 2] === "<" && body[i + 3] !== "=" && body[i + 3] !== "!") count++;
        }
    }
    return count;
}

/** `{{3}}` in the replacement with no group 3 in the pattern: inserts nothing (warning, not an error). */
function groupRefWarnings(source: string, replacement: string): string[] {
    const groups = countCaptureGroups(source);
    const seen = new Set<number>();
    for (const found of replacement.matchAll(/\{\{(\d)\}\}/g)) {
        const k = Number(found[1]);
        if (k > groups) seen.add(k);
    }
    return Array.from(seen)
        .sort((a, b) => a - b)
        .map((k) => `{{${k}}} has no group ${k} in the pattern, so it inserts nothing.`);
}

function replacementIssue(replacement: string): string | undefined {
    if (replacement.length > MAX_PATTERN_REPLACEMENT) return REPLACEMENT_TOO_LONG;
    if (hasLoneSurrogate(replacement)) return REPLACEMENT_HALF_EMOJI;
    return undefined;
}

/**
 * The editor's live check. An empty pattern is not an error line (nothing was typed yet) but cannot be saved.
 * `mode` is passed to the gate: an instant rule has a smaller limit of open-ended repeats.
 */
export function validatePatternDraft(draft: PatternDraft): DraftIssues {
    const issues: DraftIssues = { warnings: [], ok: false };
    let patternOk = false;
    if (draft.source.trim() !== "") {
        const check = checkPattern(draft.source, draft.mode);
        if (check.ok) patternOk = true;
        else issues.pattern = describePatternRefusal(check);
    }
    issues.replacement = replacementIssue(draft.replacement);
    if (patternOk) issues.warnings = groupRefWarnings(draft.source, draft.replacement);
    issues.ok = patternOk && issues.replacement === undefined;
    return issues;
}

/**
 * Why a stored rule is refused, or `null` when the engine accepts it. `index` is its position in the list: rules
 * past the limit are not compiled at all. Takes `unknown` because `data.json` can hold anything (sync, hand edits).
 */
export function storedRuleProblem(raw: unknown, index: number): string | null {
    if (index >= MAX_PATTERN_RULES) return OVER_RULE_LIMIT;
    if (typeof raw !== "object" || raw === null) return "This entry is not a rule.";
    const source: unknown = Reflect.get(raw, "source");
    const replacement: unknown = Reflect.get(raw, "replacement");
    const mode: unknown = Reflect.get(raw, "mode") ?? "instant";
    if (typeof source !== "string") return "This rule has no pattern.";
    if (typeof replacement !== "string") return "This rule has no replacement.";
    if (mode !== "instant" && mode !== "separator") return "This rule has an unknown mode. Pick when it fires.";
    const issues = validatePatternDraft({ source, replacement, mode });
    if (!issues.ok) return issues.pattern ?? issues.replacement ?? "Write the pattern between slashes, like /abc$/.";
    const compiled = compileRule(raw);
    return compiled.ok ? null : compiled.reason;
}
