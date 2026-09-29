// @vitest-environment jsdom

import { describe, it, expect, beforeAll, vi } from "vitest";
import { installObsidianDomHelpers } from "../../test/dom-polyfill";
import { renderDefinitionGroups } from "./setting-definitions";
import type { ControlHost } from "./settings-control-path";
import type {
    SettingDefinitionControl,
    SettingDefinitionEmpty,
    SettingDefinitionGroup,
    SettingDefinitionRender,
} from "obsidian";
import type { SnipsyActionDef } from "./setting-definitions";

/**
 * Direct tests for the pre-1.13 adapter (`renderDefinitionGroups`,
 * finding #8): the module that lets General/About render the SAME
 * `SettingDefinitionGroup[]` tree the 1.13+ declarative path consumes
 * (B-151/ADR-0007). `BasicTab.test.ts`/`FeedbackTab.test.ts` already
 * cover this indirectly through real production definitions — these
 * tests exercise the adapter's own contract directly, with minimal
 * hand-built definitions, so a future definitions change can't
 * accidentally stop covering a vocabulary the adapter supports.
 */

beforeAll(() => {
    installObsidianDomHelpers();
});

function mount(): HTMLElement {
    const root = document.createElement("div");
    document.body.appendChild(root);
    return root;
}

function makeHost(initial: Record<string, unknown> = {}): ControlHost & { values: Record<string, unknown> } {
    const values = { ...initial };
    return {
        values,
        getControlValue: (key) => values[key],
        setControlValue: (key, value) => {
            values[key] = value;
        },
    };
}

function rowByTitle(root: HTMLElement, title: string): HTMLElement {
    const row = Array.from(root.querySelectorAll(".setting-item")).find(
        (el) => el.querySelector(".setting-item-name")?.textContent === title,
    );
    if (!row) throw new Error(`Row "${title}" not found`);
    return row as HTMLElement;
}

describe("renderDefinitionGroups — group visibility", () => {
    it("a group with visible: false does not render at all", () => {
        const root = mount();
        const groups: SettingDefinitionGroup[] = [
            { type: "group", heading: "Hidden", visible: false, items: [] },
            { type: "group", heading: "Shown", items: [] },
        ];
        renderDefinitionGroups(root, groups, makeHost());

        const headings = Array.from(
            root.querySelectorAll(".setting-item-heading .setting-item-name"),
        ).map((el) => el.textContent);
        expect(headings).toEqual(["Shown"]);
    });

    it("a group with a false-returning visible() function does not render", () => {
        const root = mount();
        const groups: SettingDefinitionGroup[] = [
            { type: "group", heading: "Hidden", visible: () => false, items: [] },
        ];
        renderDefinitionGroups(root, groups, makeHost());
        expect(root.querySelector(".setting-item-heading")).toBeNull();
    });
});

describe("renderDefinitionGroups — item visibility", () => {
    it("an item with visible: false is skipped; sibling items still render", () => {
        const root = mount();
        const items = [
            { name: "Hidden row", visible: false, buttonText: "Go", action: vi.fn() } satisfies SnipsyActionDef,
            { name: "Shown row", buttonText: "Go", action: vi.fn() } satisfies SnipsyActionDef,
        ];
        renderDefinitionGroups(root, [{ type: "group", heading: "G", items }], makeHost());

        expect(() => rowByTitle(root, "Hidden row")).toThrow();
        expect(rowByTitle(root, "Shown row")).toBeTruthy();
    });
});

describe("renderDefinitionGroups — disabled predicate re-evaluated after a sibling control changes", () => {
    it("toggling a control re-evaluates another control's disabled() without a full re-render", async () => {
        const root = mount();
        const host = makeHost({ "g.on": false });

        const items = [
            {
                name: "On/off",
                control: { type: "toggle", key: "g.on", defaultValue: false },
            } satisfies SettingDefinitionControl,
            {
                name: "Dependent",
                control: {
                    type: "dropdown",
                    key: "g.value",
                    defaultValue: "a",
                    options: { a: "a", b: "b" },
                    disabled: () => !host.values["g.on"],
                },
            } satisfies SettingDefinitionControl,
        ];
        renderDefinitionGroups(root, [{ type: "group", heading: "G", items }], host);

        const dependentRow = rowByTitle(root, "Dependent");
        expect(dependentRow.classList.contains("is-disabled")).toBe(true);
        expect((dependentRow.querySelector("select") as HTMLSelectElement).disabled).toBe(true);

        const toggle = rowByTitle(root, "On/off").querySelector(
            "input[type=checkbox]",
        ) as HTMLInputElement;
        toggle.checked = true;
        toggle.dispatchEvent(new Event("change"));
        await Promise.resolve();
        await Promise.resolve();

        expect(host.values["g.on"]).toBe(true);
        expect(dependentRow.classList.contains("is-disabled")).toBe(false);
        expect((dependentRow.querySelector("select") as HTMLSelectElement).disabled).toBe(false);
    });
});

describe("renderDefinitionGroups — render rows", () => {
    it("applies name/desc before calling render(), and a returned cleanup fn doesn't throw", () => {
        const root = mount();
        const cleanup = vi.fn();
        const items = [
            {
                name: "Custom row",
                desc: "Custom description",
                render: (setting) => {
                    setting.addButton((b) => b.setButtonText("Go"));
                    return cleanup;
                },
            } satisfies SettingDefinitionRender,
        ];
        expect(() =>
            renderDefinitionGroups(root, [{ type: "group", heading: "G", items }], makeHost()),
        ).not.toThrow();

        const row = rowByTitle(root, "Custom row");
        expect(row.querySelector(".setting-item-description")?.textContent).toBe(
            "Custom description",
        );
        expect(row.querySelector("button")?.textContent).toBe("Go");
        // The adapter has no unmount hook on the pre-1.13 path (the
        // whole tab content is discarded via `root.empty()` on the
        // next render instead) — it never invokes the returned
        // cleanup itself. Documented, not a bug: asserting it here
        // pins that the adapter doesn't call it prematurely either.
        expect(cleanup).not.toHaveBeenCalled();
    });
});

describe("renderDefinitionGroups — empty rows (SettingDefinitionEmpty, finding #9)", () => {
    it("renders name/desc only, no control", () => {
        const root = mount();
        const items = [{ name: "Version", desc: "Snipsy 1.4.0" } satisfies SettingDefinitionEmpty];
        renderDefinitionGroups(root, [{ type: "group", heading: "G", items }], makeHost());

        const row = rowByTitle(root, "Version");
        expect(row.querySelector(".setting-item-description")?.textContent).toBe("Snipsy 1.4.0");
        expect(row.querySelector("button")).toBeNull();
        expect(row.querySelector("input")).toBeNull();
    });
});

describe("renderDefinitionGroups — action rows", () => {
    it("action() receives the row's own settingEl", () => {
        const root = mount();
        let received: HTMLElement | undefined;
        const items = [
            {
                name: "Do a thing",
                buttonText: "Go",
                action: (el) => {
                    received = el;
                },
            } satisfies SnipsyActionDef,
        ];
        renderDefinitionGroups(root, [{ type: "group", heading: "G", items }], makeHost());

        const row = rowByTitle(root, "Do a thing");
        row.querySelector("button")!.dispatchEvent(new Event("click"));

        expect(received).toBe(row);
    });

    it("action() receives the item's own position within the group's items array, not a hardcoded 0", () => {
        const root = mount();
        const receivedIndexes: number[] = [];
        const items = [
            {
                name: "Do a thing",
                buttonText: "Go",
                action: (_el, index) => {
                    receivedIndexes.push(index);
                },
            } satisfies SnipsyActionDef,
            {
                name: "Do another thing",
                buttonText: "Go",
                action: (_el, index) => {
                    receivedIndexes.push(index);
                },
            } satisfies SnipsyActionDef,
        ];
        renderDefinitionGroups(root, [{ type: "group", heading: "G", items }], makeHost());

        rowByTitle(root, "Do a thing").querySelector("button")!.dispatchEvent(new Event("click"));
        rowByTitle(root, "Do another thing").querySelector("button")!.dispatchEvent(new Event("click"));

        expect(receivedIndexes).toEqual([0, 1]);
    });
});

describe("renderDefinitionGroups — group cls (finding #3)", () => {
    it("threads a group's cls onto the rendered group container", () => {
        const root = mount();
        renderDefinitionGroups(
            root,
            [{ type: "group", heading: "Expansion", cls: "snipsy-expansion", items: [] }],
            makeHost(),
        );
        expect(root.querySelector(".snipsy-expansion")).toBeTruthy();
    });
});
