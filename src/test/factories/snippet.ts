/**
 * Factories for `SnippetItem` and bare snippet maps used by the engine
 * and store layers. Backlog B-078.
 *
 * The two shapes are deliberately distinct:
 *   - `SnippetItem` is the rich record the picker UI consumes
 *   - `Dict` (`Record<string, string>`) is the flat map the expansion
 *     engine and `settings.snippets` use
 * The factories return whichever shape the caller asks for so tests
 * don't have to remember which layer they're at.
 */

import type { SnippetItem } from "../../types";
import type { Dict } from "../../engine/types";

export interface SnippetOverrides {
    id?: string;
    folder?: string;
    trigger?: string;
    replacement?: string;
    keywords?: string[];
}

/**
 * Build a single `SnippetItem` with sensible defaults. Override any
 * field via `overrides`. Useful when a test needs a snippet with a
 * specific shape but doesn't care about the unrelated fields.
 */
export function makeSnippet(overrides: SnippetOverrides = {}): SnippetItem {
    const trigger = overrides.trigger ?? ":hi";
    const folder = overrides.folder ?? "test";
    return {
        id: overrides.id ?? `${folder}/${trigger}`,
        folder,
        trigger,
        replacement: overrides.replacement ?? "hello",
        ...(overrides.keywords ? { keywords: overrides.keywords } : {}),
    };
}

/**
 * Build a collection of `SnippetItem`s with sequential triggers
 * (`:s0`, `:s1`, ...). The picker UI's truncation logic (B-040 /
 * U-003) needs collections of 100+ items; factory makes this cheap.
 */
export function makeSnippetCollection(
    n: number,
    opts: { folder?: string; replacementPrefix?: string } = {},
): SnippetItem[] {
    const folder = opts.folder ?? "test";
    const prefix = opts.replacementPrefix ?? "value";
    return Array.from({ length: n }, (_, i) =>
        makeSnippet({
            trigger: `:s${i}`,
            folder,
            replacement: `${prefix}${i}`,
        }),
    );
}

/**
 * Build a flat trigger → replacement map (`Dict`) ready to drop into
 * `settings.snippets` or pass to the engine. Accepts either a list of
 * `SnippetItem`s or a plain object of pairs.
 */
export function makeDict(
    input: SnippetItem[] | Record<string, string>,
): Dict {
    if (Array.isArray(input)) {
        const map: Dict = {};
        for (const s of input) {
            const key = s.folder ? `${s.folder}/${s.trigger}` : s.trigger;
            map[key] = s.replacement;
        }
        return map;
    }
    return { ...input };
}
