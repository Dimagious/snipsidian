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
import { hasReplacementCollision } from "../store/snippets";
import type { SnipSidianSettings } from "../types";
import {
    validatePackageForInstall,
    type ValidationResult,
} from "../services/package-validator";

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

/** Result of {@link planGroupedInstall}. */
export interface GroupedInstallPlan {
    /** S-009 gate result. Callers must check `isValid` before touching
     *  `collisions`/`diff` — an invalid package has neither computed
     *  meaningfully. */
    validation: ValidationResult;
    /** Bare trigger names that hard-block the whole install: the same
     *  trigger name lives in a DIFFERENT group with a different
     *  replacement (see semantics note below). Non-empty means the
     *  caller must refuse the install outright — no partial writes. */
    collisions: string[];
    /** Added/conflict classification once collisions are cleared. Feed
     *  straight into `PackagePreviewModal`. */
    diff: DiffResult;
}

/**
 * B-140: the ONE grouped-install planner. Both `PackageBrowser.
 * installPackage` (community packs) and `EspansoSection` (Espanso YAML
 * import) call this instead of hand-copying the
 * validate → collide → diff sequence — the two copies had already
 * diverged (this is how S-009 shipped: a rule added on one path only).
 *
 * **Pinned collision semantics (the reconciliation decision):** an
 * existing key at the same grouped path (`<groupSlug>/<trigger>`) is
 * NOT a cross-group collision, regardless of its stored value — a
 * same-key overwrite is the diff/preview's job (keep current vs. use
 * new), matching `PackageBrowser`'s pre-B-140 behavior. The hard
 * refusal is reserved for a genuine cross-group conflict: the same
 * bare trigger living in a DIFFERENT group with a DIFFERENT
 * replacement (`hasReplacementCollision`, excluding this package's own
 * grouped key). Espanso's pre-B-140 stricter "skip only on identical
 * value" check is gone — re-importing an edited snippet now goes
 * through the same conflict preview as community packs instead of a
 * hard refusal.
 *
 * Pure — no `Notice`, no DOM, no `this.plugin`. Runs
 * `validatePackageForInstall` first (S-009): every write path into
 * `settings.snippets` must pass this gate before the diff/write.
 *
 * @param bareSnippets `{ trigger: replacement }` WITHOUT the group
 *                      prefix (a package's `snippets` map, or an
 *                      Espanso parse's `snippets` map).
 * @param groupSlug     the already-slugified group this install writes
 *                       under (package label / Espanso group slug).
 * @param settings      live settings — read-only, never mutated.
 */
export function planGroupedInstall(
    bareSnippets: Record<string, string>,
    groupSlug: string,
    settings: SnipSidianSettings,
): GroupedInstallPlan {
    const validation = validatePackageForInstall({ label: groupSlug, snippets: bareSnippets });
    if (!validation.isValid) {
        return { validation, collisions: [], diff: { added: [], conflicts: [] } };
    }

    const collisions = Object.entries(bareSnippets)
        .filter(([trigger, replacement]) => {
            const groupedKey = joinKey(groupSlug, trigger);
            if (settings.snippets[groupedKey] !== undefined) return false;
            return hasReplacementCollision(settings, trigger, replacement, groupedKey);
        })
        .map(([trigger]) => trigger);

    if (collisions.length > 0) {
        return { validation, collisions, diff: { added: [], conflicts: [] } };
    }

    const diff = buildPackageDiff(bareSnippets, groupSlug, settings.snippets);
    return { validation, collisions, diff };
}

/**
 * Fold-in (2026-08 improvement audit, ux#7): how many snippets did an
 * install/import ACTUALLY change, given the user's per-conflict
 * choices? `applyResolvedInstallation` (PackageBrowser) and
 * `EspansoSection`'s conflict path used to report the full pack size
 * regardless of choices — a "Reinstall, keep everything" run claimed
 * "Installed N snippets" when zero snippets changed.
 *
 * Counts every `diff.added` entry (always genuinely new) plus every
 * `diff.conflicts` entry whose resolved value differs from what was
 * already stored (i.e. the user picked "Overwrite", or the bulk
 * "Overwrite all" action) — a conflict resolved as "Keep current"
 * contributes 0.
 *
 * @param resolved the final `{ key: replacement }` map
 *                  `PackagePreviewModal.onConfirm` handed back.
 */
export function countAppliedChanges(
    diff: DiffResult,
    resolved: Record<string, string>,
): number {
    const overwritten = diff.conflicts.filter((c) => resolved[c.key] !== c.current).length;
    return diff.added.length + overwritten;
}
