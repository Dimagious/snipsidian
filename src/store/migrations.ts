import type { RawSettingsData } from "../services/package-types";

export type Migration = (raw: RawSettingsData) => RawSettingsData;
export const MIGRATIONS: Migration[] = [];
export function runMigrations(raw: RawSettingsData): RawSettingsData {
    return MIGRATIONS.reduce((acc, m) => m(acc), raw);
}

/**
 * B-254: is this the saved data of the "Text Snippets" plugin
 * (`snippets_file` is its textarea, `snippets` its list cache) rather than
 * Snipsy's `{ trigger: replacement }` map? Checked on the SHAPE, not on the
 * plugin id, so it protects any install that ends up with such a file.
 */
export function isTextSnippetsData(value: unknown): value is Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const data = value as Record<string, unknown>;
    const snippets = data.snippets;
    const hasList = Array.isArray(snippets);
    // A `snippets` that is neither absent nor a list (Snipsy's map) means this
    // is a Snipsy file, even when a stray `snippets_file` rides along: taking
    // it for Text Snippets would back up and wipe a Snipsy library.
    if (snippets !== undefined && snippets !== null && !hasList) return false;
    return typeof data.snippets_file === "string" || hasList;
}

/**
 * B-254: Text Snippets options -> Snipsy's manual expansion mode (B-255).
 * `useTab` defaults to on there, so only an explicit `false` turns Tab off;
 * Space expansion (`useSpace`, default off) is the one thing that maps to
 * "expand while typing".
 */
export function textSnippetsExpansion(data: Record<string, unknown>): { onType: boolean; onTab: boolean } {
    return { onType: data.useSpace === true, onTab: data.useTab !== false };
}
