import { Platform } from "obsidian";
import type { SettingDefinitionControl, SettingDefinitionGroup } from "obsidian";
import type SnipSidianPlugin from "../../main";
import type { SnipsyActionDef } from "../utils/setting-definitions";

/** B-137: default prefix char when the mode is on but the user
 *  hasn't picked one yet. Kept in sync with `plugin.ts`'s `getPrefix`
 *  fallback and `AddSnippetModal`'s hint computation. */
export const DEFAULT_PREFIX_CHAR = ":";

/** Action-row callbacks. `BasicTab` owns the actual implementations
 *  (file I/O, Notices, the Hotkeys-tab deep link) — this module only
 *  describes WHICH rows exist and what they say, per B-151/ADR-0007's
 *  "General renders as declarative groups" requirement. */
export interface GeneralDefinitionsHandlers {
    setHotkey(commandId: string, commandName: string): void;
    exportJson(): void | Promise<void>;
    startImport(): void;
    revealDataFile(): void;
    restoreDefaults(): void | Promise<void>;
}

/**
 * Builds the General tab's content as a `SettingDefinitionGroup[]` —
 * the single source of truth for BOTH render paths (B-151/ADR-0007):
 * `SnipSidianSettingTab.getSettingDefinitions()` returns these groups
 * directly on Obsidian 1.13+; `BasicTab.render()` feeds the exact same
 * array through `renderDefinitionGroups` (`setting-definitions.ts`) on
 * older versions. Section order (Expansion, Commands, Backup,
 * Defaults) matches the pre-1.13 wording unchanged — Expansion first
 * because it's the only real preference, per the 2026-09 UI redesign.
 * Row names changed once since then: finding #4 renamed the two
 * Commands rows ("Set hotkey for Insert snippet"/"Set hotkey for Open
 * settings") so an `action` row's name alone says what clicking it
 * does — on 1.13+ it renders as accent link text with no button.
 *
 * Search aliases (B-151 target behaviour: page entries match search by
 * name only, so "snippet"/"hotstring"/"trigger"/"text expansion" have
 * to live on real rows) sit on "Require a prefix before triggers" and
 * "Set hotkey for Insert snippet" — both are genuinely about
 * triggers/snippets, so this isn't a decoy row, just search words on
 * content that was already there. "Import"/"export" sit on the two
 * Backup rows for the same reason.
 *
 * Each group's `items` array is built as its own unannotated `const`
 * (rather than inline inside the group's object literal) so each
 * item's own `satisfies` check — not the group's outer
 * `SettingDefinitionGroup` type — is what TypeScript validates it
 * against; nesting the array literal directly inside an annotated
 * object triggers excess-property "freshness" checks against the
 * broader `SettingDefinitionControl | SettingDefinitionAction` union,
 * which rejects `SnipsyActionDef`'s adapter-only `buttonText` field.
 */
export function buildGeneralDefinitions(
    plugin: SnipSidianPlugin,
    handlers: GeneralDefinitionsHandlers,
): SettingDefinitionGroup[] {
    const requirePrefix = () => plugin.settings.expansion?.requirePrefix ?? false;

    const expansionItems = [
        {
            name: "Require a prefix before triggers",
            desc: "With this on, todo stays text; :todo expands.",
            aliases: ["trigger", "hotstring"],
            control: { type: "toggle", key: "expansion.requirePrefix", defaultValue: false },
        } satisfies SettingDefinitionControl,
        {
            name: "Prefix character",
            desc: "Which character must come right before a trigger when the toggle above is on.",
            control: {
                type: "dropdown",
                key: "expansion.prefixChar",
                defaultValue: DEFAULT_PREFIX_CHAR,
                options: { ":": ":", ";": ";" },
                disabled: () => !requirePrefix(),
            },
        } satisfies SettingDefinitionControl,
    ];

    const commandsItems = [
        {
            // Finding #4: on 1.13+ an `action` row renders as accent
            // link text with NO button (spike report, Q2) — the row's
            // own name has to say what clicking does. "Insert
            // snippet" read as the command's own name, not an action
            // this row performs (it doesn't insert anything — it
            // opens the Hotkeys tab to bind a key for that command).
            name: "Set hotkey for Insert snippet",
            desc: "Opens the Hotkeys tab filtered to this command.",
            aliases: ["snippet", "hotstring", "trigger", "text expansion"],
            buttonText: "Set hotkey",
            action: () => handlers.setHotkey("snipsidian:insert-snippet", "Insert snippet…"),
        } satisfies SnipsyActionDef,
        {
            name: "Set hotkey for Open settings",
            desc: "Opens the Hotkeys tab filtered to this command.",
            buttonText: "Set hotkey",
            action: () => handlers.setHotkey("snipsidian:open-settings", "Open settings"),
        } satisfies SnipsyActionDef,
    ];

    const backupItems = [
        {
            name: "Export snippets",
            desc: "Download your library as JSON.",
            aliases: ["export", "backup"],
            buttonText: "Export JSON",
            action: () => void handlers.exportJson(),
        } satisfies SnipsyActionDef,
        {
            name: "Import snippets",
            desc: "Preview a JSON file before merge or replace.",
            aliases: ["import", "json"],
            buttonText: "Import JSON",
            action: () => handlers.startImport(),
        } satisfies SnipsyActionDef,
        // B-047: hidden entirely on mobile, not just disabled — there's
        // no working fallback there ("File manager access is only
        // available on desktop"). `visible` is a plain boolean (not a
        // function): `Platform.isDesktop` doesn't change mid-session,
        // and `getSettingDefinitions()` is only re-evaluated on
        // `update()`/`addSettingTab()`, so a function form would buy
        // nothing here.
        {
            name: "Reveal data file",
            desc: "Show the data file in your file manager.",
            visible: Platform.isDesktop,
            buttonText: "Show in folder",
            action: () => handlers.revealDataFile(),
        } satisfies SnipsyActionDef,
    ];

    const defaultsItems = [
        {
            name: "Restore default snippets",
            desc: "Re-add missing built-in snippets. Existing snippets are not changed.",
            buttonText: "Restore",
            action: () => void handlers.restoreDefaults(),
        } satisfies SnipsyActionDef,
    ];

    return [
        // Finding #3: `cls` scopes the whole-row dimming rule
        // (`.snipsy-expansion .setting-item.is-disabled`, main.css) to
        // just this group — Obsidian's own 1.13+ framework applies
        // `is-disabled` to a disabled row but ships no dimming CSS for
        // it on a `control`/`action` row (only on its own List rows),
        // so Snipsy supplies that CSS itself, scoped narrowly rather
        // than dimming every disabled row plugin-wide.
        { type: "group", heading: "Expansion", items: expansionItems, cls: "snipsy-expansion" },
        { type: "group", heading: "Commands", items: commandsItems },
        { type: "group", heading: "Backup", items: backupItems },
        { type: "group", heading: "Defaults", items: defaultsItems },
    ];
}
