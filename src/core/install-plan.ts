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
