/**
 * Pure page filter for the CDP launcher (B-220). No Playwright or Node
 * imports on purpose, so it can be unit tested from `src/test/` (see
 * `obsidian-version.ts` for the same split).
 */

/** The slice of a Playwright `Page` the filter needs. */
export interface UrlPage {
    url(): string;
}

/** Real windows only: Obsidian's DevTools / extension targets would
 *  otherwise show up as pages. Popout windows (`about:blank`) are kept. */
export function filterObsidianPages<T extends UrlPage>(pages: readonly T[]): T[] {
    return pages.filter((p) => !p.url().startsWith("devtools://"));
}
