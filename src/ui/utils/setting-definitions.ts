import type {
    SettingDefinitionAction,
    SettingDefinitionControl,
    SettingDefinitionEmpty,
    SettingDefinitionGroup,
    SettingDefinitionRender,
    SettingGroup,
    SettingGroupItem,
} from "obsidian";
import { renderSettingGroup } from "./setting-group";
import type { ControlHost } from "./settings-control-path";

/**
 * Adapter-only extension of `SettingDefinitionAction` (B-151/ADR-0007):
 * a button label for the pre-1.13 imperative render path. The real
 * 1.13+ framework renders `action` rows as accent-coloured link text
 * with no separate button (spike report, Q2 "what clicking a result
 * does") — it never reads this field, so adding it doesn't change
 * anything about what Obsidian 1.13+ does with the same object. It
 * exists purely so the pre-1.13 tab strip can keep today's per-action
 * wording ("Set hotkey", "Export JSON", "Restore", ...) instead of one
 * generic button label, while both versions render from the exact
 * same definition array.
 */
export interface SnipsyActionDef extends SettingDefinitionAction {
    buttonText: string;
}

function resolveBool(value: boolean | (() => boolean) | undefined, fallback: boolean): boolean {
    if (value === undefined) return fallback;
    return typeof value === "function" ? value() : value;
}

function isControlDef(item: SettingGroupItem): item is SettingDefinitionControl {
    return "control" in item && !!item.control;
}
function isActionDef(item: SettingGroupItem): item is SnipsyActionDef {
    return "action" in item && typeof item.action === "function";
}
function isRenderDef(item: SettingGroupItem): item is SettingDefinitionRender {
    return "render" in item && typeof item.render === "function";
}
/** A row with no `control`/`action`/`render` (`SettingDefinitionEmpty`)
 *  — the real API's plain "name + desc" row, used here for the About
 *  tab's version footer (finding #9). Checked last: it's the fallback
 *  once the other three shapes — and a stray `page` entry, which this
 *  adapter never handles (Snippets/Packages stay imperative, see the
 *  module doc) — are ruled out. */
function isEmptyDef(item: SettingGroupItem): item is SettingDefinitionEmpty {
    if ("type" in item && item.type === "page") return false;
    return !isControlDef(item) && !isActionDef(item) && !isRenderDef(item);
}

/**
 * Pre-1.13 adapter (B-151/ADR-0007): renders the SAME
 * `SettingDefinitionGroup[]` tree the 1.13+ declarative path returns
 * from `getSettingDefinitions()` (see `general-definitions.ts` /
 * `about-definitions.ts`), via `renderSettingGroup` + plain `Setting`
 * rows — so General and About have one source of truth for their
 * content regardless of Obsidian version, per the ADR.
 *
 * Only `control` (toggle/dropdown), `action`, and `render` items are
 * supported — the entire vocabulary General/About need. Snippets and
 * Packages stay fully imperative on both render paths (the ADR's
 * whole rationale for choosing option A), so this adapter never has
 * to handle `list`/`page` items.
 *
 * `disabled` is function-capable per the real API, but this adapter
 * has no framework `refreshDomState()` to call after a sibling
 * control changes (that machinery is 1.13+-only, confirmed unusable
 * below 1.13 by the scanner's `no-unsupported-api` rule) — so it
 * re-evaluates every registered `disabled` predicate itself after any
 * control's `onChange`, the same effect `refreshDomState()` has on
 * 1.13+ (spike report, Q3: "the framework awaits setControlValue and
 * then calls refreshDomState() itself").
 *
 * Finding #3: a disabled row gets Obsidian's own `is-disabled` class
 * (real `SettingItem` behaviour on 1.13+ marks a disabled row this
 * way, per the framework's own `setDisabled` handling) — not a
 * Snipsy-only class name — so `main.css`'s dimming rule
 * (`.snipsy-expansion .setting-item.is-disabled`) applies identically
 * regardless of which render path produced the row.
 */
export function renderDefinitionGroups(
    container: HTMLElement,
    groups: readonly SettingDefinitionGroup[],
    host: ControlHost,
): void {
    const disabledRefreshers: Array<() => void> = [];

    for (const groupDef of groups) {
        if (!resolveBool(groupDef.visible, true)) continue;
        const group = renderSettingGroup(container, groupDef.heading ?? "", groupDef.cls);
        (groupDef.items ?? []).forEach((item, index) => {
            renderItem(group, item, host, disabledRefreshers, index);
        });
    }
}

function renderItem(
    group: ReturnType<typeof renderSettingGroup>,
    item: SettingGroupItem,
    host: ControlHost,
    disabledRefreshers: Array<() => void>,
    index: number,
): void {
    const visible = "visible" in item ? item.visible : undefined;
    if (!resolveBool(visible, true)) return;

    if (isControlDef(item)) {
        renderControlItem(group, item, host, disabledRefreshers);
    } else if (isActionDef(item)) {
        renderActionItem(group, item, index);
    } else if (isRenderDef(item)) {
        renderRenderItem(group, item);
    } else if (isEmptyDef(item)) {
        renderEmptyItem(group, item);
    }
}

/** `SettingDefinitionEmpty` — a plain name+desc row with no control,
 *  action, or custom render (finding #9's About-tab version footer).
 *  `searchable` has no pre-1.13 analogue (there's no search index to
 *  exclude a row from here) — the adapter ignores it, since it only
 *  affects the 1.13+ framework's own search behaviour. */
function renderEmptyItem(group: ReturnType<typeof renderSettingGroup>, item: SettingDefinitionEmpty): void {
    group.addSetting((s) => {
        s.setName(item.name);
        if (item.desc) s.setDesc(item.desc);
    });
}

function renderControlItem(
    group: ReturnType<typeof renderSettingGroup>,
    item: SettingDefinitionControl,
    host: ControlHost,
    disabledRefreshers: Array<() => void>,
): void {
    const control = item.control;

    group.addSetting((s) => {
        s.setName(item.name);
        if (item.desc) s.setDesc(item.desc);
        const rowEl: HTMLElement = s.settingEl;

        const applyDisabled = () => {
            rowEl.toggleClass("is-disabled", resolveBool(control.disabled, false));
        };

        if (control.type === "toggle") {
            const current =
                (host.getControlValue(control.key) as boolean | undefined) ?? control.defaultValue ?? false;
            s.addToggle((t) =>
                t
                    .setValue(current)
                    .setDisabled(resolveBool(control.disabled, false))
                    .onChange(async (value: boolean) => {
                        await host.setControlValue(control.key, value);
                        disabledRefreshers.forEach((fn) => fn());
                    }),
            );
        } else if (control.type === "dropdown") {
            const current =
                (host.getControlValue(control.key) as string | undefined) ?? control.defaultValue ?? "";
            s.addDropdown((d) => {
                d.addOptions(control.options);
                d.setValue(current)
                    .setDisabled(resolveBool(control.disabled, false))
                    .onChange(async (value: string) => {
                        await host.setControlValue(control.key, value);
                        disabledRefreshers.forEach((fn) => fn());
                    });
                disabledRefreshers.push(() => {
                    d.setDisabled(resolveBool(control.disabled, false));
                    applyDisabled();
                });
            });
        }

        applyDisabled();
    });
}

/** `index` is the item's own position within its parent group's
 *  `items` array (`renderDefinitionGroups`'s `forEach`) — matches the
 *  real 1.13+ framework's documented contract for `action`'s second
 *  argument ("the row's current index within its parent group or
 *  list", `obsidian.d.ts`), rather than a placeholder `0`. It's the
 *  raw array position, not a rendered-rows-only count, so a hidden
 *  sibling (`visible: false`, e.g. "Reveal data file" on mobile) can
 *  make this differ from the framework's own DOM-row index by a
 *  constant offset — acceptable today since none of our `action`
 *  callbacks (`general-definitions.ts`, `about-definitions.ts`) read
 *  the argument; only re-derive rendered-only indices here if one
 *  starts to. */
function renderActionItem(group: ReturnType<typeof renderSettingGroup>, item: SnipsyActionDef, index: number): void {
    group.addSetting((s) => {
        s.setName(item.name);
        if (item.desc) s.setDesc(item.desc);
        s.addButton((b) =>
            b
                .setButtonText(item.buttonText)
                .setDisabled(resolveBool(item.disabled, false))
                .onClick(() => item.action(s.settingEl, index)),
        );
    });
}

/**
 * `render`-type items are Obsidian's own escape hatch for a row that
 * needs more than one control (e.g. "More from the author" → Dashy's
 * two buttons, which a single-callback `action` row can't express).
 * The framework applies `name`/`desc` itself before calling `render`
 * (consistent with `control`/`action`) — this adapter does the same,
 * then hands off to the definition's own callback for the rest.
 *
 * The real signature is `(setting: Setting, group: SettingGroup) =>
 * void`. Neither of our own `render` definitions (see
 * `about-definitions.ts`) reads the `group` argument — this adapter
 * has no real `SettingGroup` instance to offer in the pre-1.11
 * fallback branch of `renderSettingGroup`, so it passes a typed
 * placeholder rather than widening the public callback signature.
 */
function renderRenderItem(group: ReturnType<typeof renderSettingGroup>, item: SettingDefinitionRender): void {
    group.addSetting((s) => {
        s.setName(item.name);
        if (item.desc) s.setDesc(item.desc);
        item.render(s, undefined as unknown as SettingGroup);
    });
}
