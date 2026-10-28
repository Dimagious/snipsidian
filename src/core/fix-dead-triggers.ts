import { isBadTrigger, normalizeTrigger } from "../engine/triggers";
import { validatePackageForInstall } from "../services/package-validator";
import { joinKey, splitKey } from "../store/keys";

/**
 * B-183: stored snippet keys that can never fire from typing.
 *
 * `:` is a separator (`shared/delimiters.ts`), and `findTrigger` walks back
 * from the typed separator to the previous separator, so the candidate it
 * looks up never contains a `:`. Any stored trigger name containing `:` is
 * therefore unreachable: `:smile:` (Espanso style, written before B-117
 * started normalising on install/import) and also `a:b`. Prefix mode (B-137)
 * does not change this: the prefix char is matched next to the candidate and
 * consumed, the candidate itself is still colon-free, so with `:` as prefix
 * the key `smile` fires from `:smile ` while `:smile:` still never does.
 *
 * Only keys whose NAME (the part after the first `/`) has a `:` are "dead".
 * Other unreachable shapes (spaces, `$`) are out of scope here.
 */

export interface TriggerRename {
    /** Full stored key, e.g. `emoji/:smile:`. */
    from: string;
    /** Full target key, e.g. `emoji/smile`. Same group as `from`. */
    to: string;
}

export interface SkippedDeadTrigger {
    key: string;
    reason: string;
}

export interface DeadTriggerPlan {
    /** Every dead key, fixable or not (drives the warning count). */
    dead: string[];
    renames: TriggerRename[];
    skipped: SkippedDeadTrigger[];
}

export function isDeadTriggerKey(fullKey: string): boolean {
    return splitKey(fullKey).name.includes(":");
}

/**
 * Plan the rename of every dead key to its `normalizeTrigger` form, same
 * group, value untouched.
 *
 * Pinned decisions:
 * - A rename is skipped (never overwrites) when the normalized name is
 *   already the name of any live key in ANY group. This is stricter than
 *   `getDict`'s first-wins resolution on purpose: it mirrors
 *   `hasTriggerCollision`, so the fix never silently shadows or is
 *   shadowed (a muted group does not make a name free).
 * - Two dead keys that normalize to the same name: the one whose full key
 *   sorts first (`localeCompare`, same order as `getDict`) wins, the other
 *   is skipped.
 * - Empty (`::`), structurally bad (`isBadTrigger`, e.g. `a:b` or a lone
 *   `-`) or install-gate-failing (`validatePackageForInstall`: charset,
 *   length) results are skipped.
 * - Name lookups use a `Map`/`Set`, never a plain object, so triggers such
 *   as `constructor` or `__proto__` behave (S-004/S-008).
 */
export function planDeadTriggerFix(snippets: Record<string, string>): DeadTriggerPlan {
    const keys = Object.keys(snippets).sort((a, b) => a.localeCompare(b));
    const dead = keys.filter(isDeadTriggerKey);
    const deadSet = new Set(dead);

    // name -> group of the first live key that owns it.
    const liveNames = new Map<string, string>();
    for (const key of keys) {
        if (deadSet.has(key)) continue;
        const { group, name } = splitKey(key);
        if (!liveNames.has(name)) liveNames.set(name, group);
    }

    const renames: TriggerRename[] = [];
    const skipped: SkippedDeadTrigger[] = [];
    const planned = new Map<string, string>(); // name -> first planned `from`

    for (const key of dead) {
        const { group, name } = splitKey(key);
        const target = normalizeTrigger(name);

        if (target.length === 0) {
            skipped.push({ key, reason: "trigger is empty after removing colons" });
            continue;
        }
        if (isBadTrigger(target)) {
            skipped.push({ key, reason: `"${target}" is not a valid trigger` });
            continue;
        }
        const value = snippets[key];
        const gate = validatePackageForInstall({
            label: "Fix triggers",
            snippets: { [target]: value ?? "" },
        });
        if (!gate.isValid) {
            skipped.push({ key, reason: gate.errors[0] ?? `"${target}" is not allowed` });
            continue;
        }
        if (liveNames.has(target)) {
            const owner = liveNames.get(target);
            skipped.push({
                key,
                reason: owner ? `"${target}" is already used in group "${owner}"` : `"${target}" is already used`,
            });
            continue;
        }
        if (planned.has(target)) {
            skipped.push({ key, reason: `"${target}" is also the target of ${planned.get(target)}` });
            continue;
        }
        planned.set(target, key);
        renames.push({ from: key, to: joinKey(group, target) });
    }

    return { dead, renames, skipped };
}

/**
 * Returns a new map with the plan's renames applied (values preserved,
 * entry order kept). Built via `Object.fromEntries`, which defines own
 * properties, so a target named `__proto__` cannot swap the prototype.
 */
export function applyDeadTriggerRenames(
    snippets: Record<string, string>,
    renames: readonly TriggerRename[],
): Record<string, string> {
    const map = new Map(renames.map((r) => [r.from, r.to]));
    const entries: [string, string][] = Object.entries(snippets).map(([key, value]) => [
        map.get(key) ?? key,
        value,
    ]);
    return Object.fromEntries(entries);
}

/**
 * Gate for the apply step (every write path into `settings.snippets` is
 * gated, S-009): each renamed entry must pass the install rules
 * (`validatePackageForInstall`: trigger charset/length, replacement
 * <= 10000). Checked per entry, NOT as one payload, on purpose: a rename
 * never changes the snippet count or adds bytes (the target is shorter than
 * the source), so the count (500) and total-size (2 MiB) caps are library
 * invariants a rename cannot break. Validating the batch as one package
 * would block exactly the big legacy libraries this fix targets.
 */
export function validateDeadTriggerRenames(
    snippets: Record<string, string>,
    renames: readonly TriggerRename[],
): { ok: true } | { ok: false; error: string } {
    const errors: string[] = [];
    for (const r of renames) {
        const res = validatePackageForInstall({
            label: "Fix triggers",
            snippets: { [splitKey(r.to).name]: snippets[r.from] ?? "" },
        });
        if (!res.isValid) {
            errors.push(...res.errors);
            if (errors.length >= 3) break;
        }
    }
    return errors.length === 0 ? { ok: true } : { ok: false, error: errors.join("; ") };
}
