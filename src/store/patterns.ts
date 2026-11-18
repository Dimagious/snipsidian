import { compilePatternRules, NO_PATTERNS, type CompiledPatterns } from "../engine/patterns";
import type { SnipSidianSettings } from "../types";

/**
 * ADR-0008: the compiled pattern rules of `settings`, for the hot path.
 *
 * Every rule goes through the S-015 gate (`compilePatternRules`), whatever put
 * it in `settings.patterns` (editor, import, sync, a hand-edited data.json).
 * Rules in a group listed in `disabledGroups` are left out, like snippets. The
 * regexes themselves are cached by source inside the engine, so calling this on
 * every keystroke compiles nothing; with no patterns it returns a shared empty
 * value without allocating.
 */
export function getCompiledPatterns(settings: SnipSidianSettings): CompiledPatterns {
    if (!settings.patterns || settings.patterns.length === 0) return NO_PATTERNS;
    return compilePatternRules(settings.patterns, settings.disabledGroups);
}
