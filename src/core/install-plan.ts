/**
 * Pure install-plan helpers for community packages.
 *
 * The community-pack install path needs two answers before it writes
 * anything to settings:
 *
 *   1. **What would change?** — given a package's snippets and the
 *      current store, classify each entry as "added" (key didn't exist)
 *      or "conflict" (key existed with a different value). Drives the
 *      diff preview modal.
 *   2. **Is this package already installed?** — heuristic used by the
 *      Packages tab to label the row's button as "Install" vs
 *      "Installed" (and, with B-017 / B-042 in PR 3 of 1.1.6, to
 *      offer Reinstall + Uninstall affordances).
 *
 * Both functions are **pure** — no `this.plugin`, no DOM, no `Notice`.
 * That's the architectural point of this module: business logic out
 * of UI handlers so the rules can be tested at the function boundary
 * per [ADR-0005](.claude/brain/decisions/0005-test-philosophy.md).
 *
 * Extracted from `ui/components/community/PackageBrowser.ts` in 1.1.6
 * (B-028, partial — `core/snippet-ops.ts` covering add/rename/delete/
 * move is deferred to 1.2.0).
 */

import { joinKey } from "../store/keys";
import { diffIncoming, type DiffResult } from "../store/diff";

/**
 * Compute the diff between a package's incoming snippets and the
 * current snippet store, with each incoming trigger first prefixed by
 * the package's group label via `joinKey`.
 *
 * @param newSnippets    pack-level `{ trigger: replacement }` map
 *                       (triggers WITHOUT the group prefix)
 * @param packageGroup   the package label used as the group prefix
 *                       (e.g. "Markdown Essentials")
 * @param currentSnippets the live `settings.snippets` map (with full
 *                        `<group>/<trigger>` keys)
 *
 * The return shape is the shared `DiffResult` so the result can be
 * fed directly into `PackagePreviewModal` and any other consumer of
 * the diff.
 */
export function buildPackageDiff(
    newSnippets: Record<string, string>,
    packageGroup: string,
    currentSnippets: Record<string, string>,
): DiffResult {
    const prefixed: Record<string, string> = {};
    for (const [trigger, replacement] of Object.entries(newSnippets)) {
        prefixed[joinKey(packageGroup, trigger)] = replacement;
    }
    return diffIncoming(prefixed, currentSnippets);
}

/**
 * Is this package installed? Answers the row-button-label question
 * in the Packages tab.
 *
 * **Definition (1.1.6, B-017):** any key under `<packageGroup>/*`
 * present in the snippet store. We do NOT compare values: the user
 * may have edited some entries, and edits must not flip the badge
 * back to "Install" — that's the original P0 footgun (B-017) where
 * the disabled "Already installed" button left users with no path
 * to refresh from upstream and tempted them to "Install" again,
 * which silently overwrote their edits.
 *
 * Pre-1.1.6 used a ≥80 % value-match heuristic. That heuristic is
 * the one this redefinition replaces.
 */
export function isPackageInstalled(
    newSnippets: Record<string, string> | undefined,
    packageGroup: string,
    currentSnippets: Record<string, string>,
): boolean {
    if (!newSnippets) return false;
    const packageTriggers = Object.keys(newSnippets);
    if (packageTriggers.length === 0) return false;
    return packageTriggers.some((trigger) => {
        const groupedKey = joinKey(packageGroup, trigger);
        return currentSnippets[groupedKey] !== undefined;
    });
}

/**
 * List the full snippet keys that belong to a given package group —
 * i.e. every key shaped `<packageGroup>/*` currently in the store.
 *
 * Used to:
 *   - render the Uninstall confirmation modal (B-053 fold-in: show
 *     the first N trigger names of what will be removed)
 *   - drive `removePackageSnippets` below
 *
 * Package labels are validated to reject `/` (see package-validator
 * S-006), so the `<group>/<trigger>` prefix is unambiguous.
 */
export function listPackageKeys(
    packageGroup: string,
    currentSnippets: Record<string, string>,
): string[] {
    if (!packageGroup) return [];
    const prefix = `${packageGroup}/`;
    return Object.keys(currentSnippets).filter((k) => k.startsWith(prefix));
}

/**
 * Return a NEW snippet map with every `<packageGroup>/*` key removed.
 * The input map is not mutated — callers replace
 * `settings.snippets` with the returned value and persist.
 *
 * Removes the user's edits to the package's keys as well as the
 * package's own entries. That's by design: those edits were
 * conceptually "the user's version of this pack", and uninstalling
 * a pack should leave no trace of it. If the user wants to keep
 * something, they rename it out of the package group first.
 */
export function removePackageSnippets(
    packageGroup: string,
    currentSnippets: Record<string, string>,
): Record<string, string> {
    if (!packageGroup) return { ...currentSnippets };
    const prefix = `${packageGroup}/`;
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(currentSnippets)) {
        if (!k.startsWith(prefix)) result[k] = v;
    }
    return result;
}
