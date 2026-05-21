/**
 * Pure snippet-operation plans for the Snippets tab.
 *
 * Add / edit / delete on snippets used to live inline in
 * `SnippetsTab.ts` click handlers — validation, key construction,
 * collision checks, mutation, and Notice / save / re-render all
 * mixed together. This file lifts the plan-building half out so
 * the rules can be tested at the function boundary per
 * [ADR-0005](.claude/brain/decisions/0005-test-philosophy.md).
 *
 * Pattern:
 *   1. UI handler calls a `plan*` function with current settings +
 *      user input. Function returns either a success plan with
 *      the writes to apply, or `{ ok: false, reason }`.
 *   2. UI handler applies the plan to settings + saves + reacts.
 *
 * Closes the second half of B-028 (1.1.7). The first half — install-
 * plan extraction — shipped in 1.1.6 PR #38. Together with
 * `core/install-plan.ts`, the `core/` layer now owns all of Snipsy's
 * mutation-planning logic.
 */

import { joinKey, splitKey, slugifyGroup } from "../store/keys";
import { normalizeTrigger, isBadTrigger } from "../engine/triggers";
import type { SnipSidianSettings } from "../types";
import { hasTriggerCollision } from "../store/snippets";

/** Plan result: success carries the data the caller needs to apply;
 *  failure carries a user-readable reason string. */
export type Plan<T = void> =
    | { ok: true; data: T }
    | { ok: false; reason: string };

/** Output of `planAddSnippet`: the key under which to write the new
 *  snippet, plus the replacement value. */
export interface AddSnippetPlan {
    key: string;
    value: string;
}

/**
 * Validate and plan adding a new snippet.
 *
 * Checks (in order):
 *   1. Trigger normalises to a non-empty, well-formed key.
 *   2. Replacement is non-empty.
 *   3. The composed `<group>/<trigger>` key isn't already present.
 *   4. The trigger name doesn't already exist in another group with
 *      the same trigger word (`hasTriggerCollision`).
 *
 * Returns a plan with the computed key on success, or
 * `{ ok: false, reason }` on any check failure. Pure — the input
 * settings object is not mutated.
 */
export function planAddSnippet(
    input: { trigger: string; replacement: string; group: string },
    settings: SnipSidianSettings,
): Plan<AddSnippetPlan> {
    const normalizedTrigger = normalizeTrigger(input.trigger);
    if (isBadTrigger(normalizedTrigger)) {
        return { ok: false, reason: "Invalid trigger: contains separators or is empty" };
    }
    if (input.replacement.length === 0) {
        return { ok: false, reason: "Replacement cannot be empty" };
    }

    const normalizedGroup = slugifyGroup(input.group);
    const key = joinKey(normalizedGroup, normalizedTrigger);

    if (settings.snippets[key] !== undefined) {
        return { ok: false, reason: `Snippet "${normalizedTrigger}" already exists` };
    }
    if (hasTriggerCollision(settings, normalizedTrigger, key)) {
        return {
            ok: false,
            reason: `Trigger "${normalizedTrigger}" already exists in another group`,
        };
    }

    return { ok: true, data: { key, value: input.replacement } };
}

/**
 * Output of `planEditSnippet`: which key to write the new value to,
 * what value to write, and (if the trigger was renamed) the old key
 * the caller should delete from settings + update in selection state.
 */
export interface EditSnippetPlan {
    /** Key under which the snippet should live after the edit. */
    newKey: string;
    /** Replacement value to write at `newKey`. */
    value: string;
    /** Set when the trigger name changed; caller must `delete
     *  settings.snippets[renamedFrom]` and migrate any UI state
     *  (selection, editing pointer) keyed on it. */
    renamedFrom?: string;
}

/**
 * Validate and plan editing an existing snippet.
 *
 * The group is preserved from `originalKey` — edits don't move
 * snippets between groups (that's what Move-to is for). Only the
 * trigger name and the replacement can change.
 *
 * Checks:
 *   1. Trigger normalises to a non-empty, well-formed key.
 *   2. Replacement is non-empty.
 *   3. If the trigger changed, the new key isn't already occupied
 *      in the same group (with prototype-chain defence — uses
 *      `hasOwnProperty.call` not `in`).
 *   4. The trigger name doesn't collide cross-group
 *      (`hasTriggerCollision`, excluding the original key itself
 *      so renaming a snippet to its own name within its own group
 *      doesn't false-positive).
 */
export function planEditSnippet(
    originalKey: string,
    input: { triggerName: string; replacement: string },
    settings: SnipSidianSettings,
): Plan<EditSnippetPlan> {
    const normalized = normalizeTrigger(input.triggerName);
    if (isBadTrigger(normalized)) {
        return { ok: false, reason: "Invalid trigger: contains separators or is empty" };
    }
    if (input.replacement.length === 0) {
        return { ok: false, reason: "Replacement cannot be empty" };
    }

    const { group } = splitKey(originalKey);
    const newKey = joinKey(group, normalized);
    const isRename = newKey !== originalKey;

    if (
        isRename &&
        Object.prototype.hasOwnProperty.call(settings.snippets, newKey)
    ) {
        return { ok: false, reason: `Trigger "${normalized}" already exists` };
    }

    if (hasTriggerCollision(settings, normalized, originalKey)) {
        return {
            ok: false,
            reason: `Trigger "${normalized}" already exists in another group`,
        };
    }

    if (settings.snippets[originalKey] === undefined) {
        return { ok: false, reason: "Original snippet missing" };
    }

    return {
        ok: true,
        data: {
            newKey,
            value: input.replacement,
            renamedFrom: isRename ? originalKey : undefined,
        },
    };
}
