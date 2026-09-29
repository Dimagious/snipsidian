import type SnipSidianPlugin from "../../main";

/**
 * Shape `SettingTab#getControlValue`/`setControlValue` need
 * (`obsidian.d.ts`). B-151/ADR-0007: `SnipSidianSettingTab` overrides
 * both on Obsidian 1.13+ so `control` rows in the declarative tree
 * read/write dotted keys instead of the default flat
 * `this.plugin.settings[key]` lookup — the spike confirmed the
 * override is required for a nested key like `expansion.
 * requirePrefix` to reach the right place (`reports/2026-09-29-spike-
 * 0007-declarative-settings.md`, Q3).
 *
 * The pre-1.13 adapter (`setting-definitions.ts`) uses the exact same
 * host for its own imperative `addToggle`/`addDropdown` rows, so both
 * render paths read and write settings through one function — the
 * "single source of truth" the ADR asks for isn't just the row
 * content, it's the persistence path too.
 */
export interface ControlHost {
    getControlValue(key: string): unknown;
    setControlValue(key: string, value: unknown): void | Promise<void>;
}

/** Finding #10: `key` here isn't attacker-controlled today — only the
 *  control definitions we author (`general-definitions.ts`) supply
 *  it. But the real framework's `control.key` type is a bare `string`
 *  (not a literal union), and both `getControlValue`/`setControlValue`
 *  are exposed as public overrides on the settings tab class — a
 *  future control definition (or, worst case, an unexpected call from
 *  Obsidian internals) could pass any dotted string. Explicitly
 *  allowlisting the two real `expansion.*` fields (S-004 style — a
 *  known-good set membership check, not `field in expansion` /
 *  bare `expansion[field]`) means an unrecognised field reads
 *  `undefined` and writes as a no-op, the same "never crash on a
 *  stale/unexpected key" contract the module doc already promises,
 *  now enforced by an explicit list instead of "any field under
 *  `expansion` passes through". */
const EXPANSION_FIELDS = new Set(["requirePrefix", "prefixChar"]);

/**
 * Maps a dotted settings key onto the nested settings object and
 * persists through the plugin's normal `saveSettings()` path. Only
 * `expansion.*` is nested today (the only control-backed section);
 * an unknown dotted key (or an unrecognised field within
 * `expansion.*`) reads as `undefined` and writes as a no-op rather
 * than throwing, so a stale or unexpected control definition never
 * crashes settings rendering.
 */
export function createControlHost(plugin: SnipSidianPlugin): ControlHost {
    return {
        getControlValue(key: string): unknown {
            const [section, field] = key.split(".");
            if (section === "expansion" && field && EXPANSION_FIELDS.has(field)) {
                const expansion = plugin.settings.expansion ?? {};
                return Object.prototype.hasOwnProperty.call(expansion, field)
                    ? (expansion as Record<string, unknown>)[field]
                    : undefined;
            }
            return undefined;
        },
        setControlValue(key: string, value: unknown): void | Promise<void> {
            const [section, field] = key.split(".");
            if (section === "expansion" && field && EXPANSION_FIELDS.has(field)) {
                plugin.settings.expansion = {
                    ...plugin.settings.expansion,
                    [field]: value,
                };
                return plugin.saveSettings();
            }
            return undefined;
        },
    };
}
