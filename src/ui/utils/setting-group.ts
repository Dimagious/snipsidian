import * as ObsidianModule from "obsidian";
import { Setting } from "obsidian";
import type { ExtraButtonComponent, SearchComponent } from "obsidian";

/**
 * Handle returned by `renderSettingGroup`. Both the native-`SettingGroup`
 * branch and the pre-1.11 fallback expose the same shape so callers
 * never need to know which one rendered.
 */
export interface SnipsyGroup {
    /** The element group rows mount into. Used directly by callers that
     *  render custom (non-`Setting`) row markup inside the group — e.g.
     *  the Packages catalog's package rows. */
    readonly bodyEl: HTMLElement;
    /** Adds a row, built the same way a top-level `new Setting(el)` row
     *  is (`setName`/`setDesc`/`addButton`/`addToggle`/…). */
    addSetting(cb: (setting: Setting) => void): SnipsyGroup;
    /** Adds a clickable icon next to the group heading (e.g. a Refresh
     *  action). Available on `Setting` since 0.9.16 and on `SettingGroup`
     *  since 1.11.0, so both branches support it unconditionally. */
    addExtraButton(cb: (button: ExtraButtonComponent) => void): SnipsyGroup;
    /** Adds a search input docked at the top of the group. */
    addSearch(cb: (search: SearchComponent) => void): SnipsyGroup;
}

/** Shape of the real `SettingGroup` class (Obsidian >= 1.11.0) we
 *  feature-detect for at runtime — see the module doc below. */
interface RuntimeSettingGroup {
    listEl: HTMLElement;
    setHeading(text: string): unknown;
    addClass(...classes: string[]): unknown;
    addSetting(cb: (setting: Setting) => void): unknown;
    addExtraButton(cb: (button: ExtraButtonComponent) => void): unknown;
    addSearch(cb: (search: SearchComponent) => void): unknown;
}
type RuntimeSettingGroupCtor = new (containerEl: HTMLElement) => RuntimeSettingGroup;

/** Reads `SettingGroup` off the live `obsidian` module object, if
 *  present. A real (non-mocked) module simply yields `undefined` for a
 *  missing export on older Obsidian — no throw. The try/catch only
 *  matters under Vitest's `vi.mock`, whose namespace proxy throws on
 *  access to a key the mock factory didn't return (see
 *  `setting-group.test.ts`'s fallback branch, which mocks `obsidian`
 *  with `SettingGroup` stripped to simulate pre-1.11 Obsidian). */
function readSettingGroupCtor(): RuntimeSettingGroupCtor | undefined {
    try {
        const mod = ObsidianModule as unknown as { SettingGroup?: RuntimeSettingGroupCtor };
        return typeof mod.SettingGroup === "function" ? mod.SettingGroup : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Renders a "filled group" section: a sentence-case heading (the same
 * look `Setting.setHeading()` produces — bold, no card border) over a
 * rounded `--background-primary-alt` container of rows, the pattern
 * Obsidian's own Editor / Hotkeys pages use.
 *
 * Uses the real `SettingGroup` API (Obsidian >= 1.11.0) when the
 * running app exposes it, **feature-detected at runtime** so
 * `minAppVersion` stays at 1.5.0 — `SettingGroup` is imported from
 * `obsidian` for its TypeScript type only; at runtime we read it off
 * the actual module object Obsidian injects, which is `undefined` on
 * older installs rather than throwing (same pattern as
 * `applyHotkeySearchQuery`'s feature-detection in `BasicTab.ts`).
 *
 * The fallback (older Obsidian) hand-builds the same heading + rows
 * shape — a heading `Setting` row followed by plain `Setting` rows in
 * a `.snipsy-group.snipsy-group-fallback` wrapper — so both branches
 * render identical headings, in the identical order. The two branches
 * are NOT identical DOM, though: the native branch nests the heading
 * *inside* `.setting-group`, immediately before the `.setting-items`
 * rows body, and relies on Obsidian's own `.setting-group
 * .setting-items` CSS to fill just that rows body (the heading stays
 * unfilled, matching Obsidian's own Editor/Hotkeys pages); the
 * fallback has no such native CSS to lean on, so `main.css` fills
 * `.snipsy-group-fallback` directly instead.
 */
export function renderSettingGroup(container: HTMLElement, heading: string): SnipsyGroup {
    const SettingGroupCtor = readSettingGroupCtor();

    if (typeof SettingGroupCtor === "function") {
        const group = new SettingGroupCtor(container);
        group.setHeading(heading);
        group.addClass("snipsy-group");
        const handle: SnipsyGroup = {
            bodyEl: group.listEl,
            addSetting(cb) {
                group.addSetting(cb);
                return handle;
            },
            addExtraButton(cb) {
                group.addExtraButton(cb);
                return handle;
            },
            addSearch(cb) {
                group.addSearch(cb);
                return handle;
            },
        };
        return handle;
    }

    // Fallback for Obsidian < 1.11 (SettingGroup shipped in 1.11.0;
    // minAppVersion stays 1.5.0): a heading `Setting` row, then a
    // `.snipsy-group` wrapper of plain `Setting` rows.
    const headingSetting = new Setting(container).setName(heading).setHeading();
    const bodyEl = container.createDiv({ cls: "snipsy-group snipsy-group-fallback" });
    const handle: SnipsyGroup = {
        bodyEl,
        addSetting(cb) {
            cb(new Setting(bodyEl));
            return handle;
        },
        addExtraButton(cb) {
            headingSetting.addExtraButton(cb);
            return handle;
        },
        addSearch(cb) {
            // No native "search docked in the group" affordance without
            // SettingGroup — render it as the group's first row instead.
            new Setting(bodyEl).addSearch(cb);
            return handle;
        },
    };
    return handle;
}
