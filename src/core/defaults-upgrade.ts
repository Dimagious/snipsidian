import { DEFAULT_SNIPPETS } from "../presets";
import { validatePackageForInstall } from "../services/package-validator";
import { DEFAULT_SNIPPETS_GROUP } from "../store/presets";
import { joinKey } from "../store/keys";

/**
 * B-217: defaults are seeded once (B-130) and Restore is additive-only (B-131), so FIXING a default in
 * `src/presets.ts` reaches nobody who is already installed. This is the one controlled way in: a list of upgrades,
 * each naming a trigger and the values it was shipped with before it was fixed. On load, a stored default is
 * replaced only when its value is EXACTLY one of them, which proves the user never touched it.
 *
 * Each upgrade runs ONCE per install: its `id` goes into `settings.defaultsUpgraded` the first time it is looked
 * at (replaced or not), and a marked id is never run again. So a user who later sets the old text back (an old
 * backup imported, a hand edit) keeps it. A fresh install is marked at seed time (`allDefaultsUpgradeIds`).
 *
 * RULE: when a default's value changes in `src/presets.ts`, add an upgrade with a NEW id (`<trigger>@<version>`)
 * holding the old value(s); never remove entries (an install may skip several releases).
 *
 * Not listed on purpose: `today` / `now` once shipped as `{{date:YYYY-MM-DD}}` / `{{time:HH:mm}}` (before 1.1.0);
 * they print the same text as `$date` / `$time`, so there is nothing to fix.
 */
export interface DefaultsUpgrade {
    /** `<trigger>@<version the fix shipped in>`: the marker stored in `settings.defaultsUpgraded`. */
    readonly id: string;
    readonly trigger: string;
    /** Values this default was shipped with before the fix. */
    readonly old: readonly string[];
}

export const DEFAULTS_UPGRADES: readonly DefaultsUpgrade[] = [
    // B-208: the typed separator landed after the last pipe, which Live Preview shows as a 4th column; one body row.
    { id: "table@1.11.0", trigger: "table", old: ["| H1 | H2 | H3 |\n| --- | --- | --- |\n| $| | | |"] },
];

/** Every upgrade id: what a fresh install is marked with, since it is seeded with the fixed values. */
export function allDefaultsUpgradeIds(): string[] {
    return DEFAULTS_UPGRADES.map((u) => u.id);
}

/** The marker list of a stored settings object: anything that is not a list of strings is "none applied". */
export function readAppliedUpgrades(raw: unknown): string[] {
    return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : [];
}

const has = (map: object, key: string): boolean => Object.prototype.hasOwnProperty.call(map, key);

export interface DefaultsUpgradePlan {
    /** Full key to new value. */
    updates: Record<string, string>;
    /** Upgrade ids looked at for the first time: to be added to `settings.defaultsUpgraded`. */
    newlyApplied: string[];
}

/**
 * What to rewrite in the stored snippets: `defaults/<trigger>` (B-130 group) and the legacy bare `<trigger>` whose
 * value equals a superseded shipped value, for the upgrades not in `applied` yet. A deleted, renamed or edited
 * default is not in `updates`, so none of them comes back. The new values go through `validatePackageForInstall`
 * (S-009 invariant: every write into `settings.snippets` is limit-checked); if the check refuses, nothing is
 * upgraded or marked (and the reason is logged), so the next load tries again.
 */
export function planDefaultsUpgrade(
    snippets: Readonly<Record<string, string>>,
    applied: readonly string[] = [],
): DefaultsUpgradePlan {
    const updates: Record<string, string> = {};
    const incoming: Record<string, string> = {};
    const newlyApplied: string[] = [];
    for (const upgrade of DEFAULTS_UPGRADES) {
        if (applied.includes(upgrade.id)) continue;
        newlyApplied.push(upgrade.id);
        if (!has(DEFAULT_SNIPPETS, upgrade.trigger)) continue;
        const current = DEFAULT_SNIPPETS[upgrade.trigger];
        if (current === undefined) continue;
        for (const key of [joinKey(DEFAULT_SNIPPETS_GROUP, upgrade.trigger), upgrade.trigger]) {
            if (!has(snippets, key)) continue;
            const stored = snippets[key];
            if (stored !== undefined && stored !== current && upgrade.old.includes(stored)) {
                updates[key] = current;
                incoming[upgrade.trigger] = current;
            }
        }
    }
    if (Object.keys(updates).length === 0) return { updates, newlyApplied };
    const check = validatePackageForInstall({ label: "Defaults", snippets: incoming });
    if (!check.isValid) {
        console.warn("[snipsy] default snippet upgrade refused by the install limits", { errors: check.errors });
        return { updates: {}, newlyApplied: [] };
    }
    return { updates, newlyApplied };
}
