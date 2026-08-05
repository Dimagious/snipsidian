// @vitest-environment jsdom

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

// Stub `new Notice(msg)` so tests can assert on toast copy.
const noticeCalls: string[] = [];
vi.mock("obsidian", async () => {
    const actual = await vi.importActual("../../test/stubs/obsidian");
    return {
        ...actual,
        Notice: vi.fn().mockImplementation((msg: string) => {
            noticeCalls.push(msg);
        }),
    };
});

// Spy-wrap the install validator so one test can force an invalid
// verdict and prove the restore path actually consults the gate.
const validateSpy = vi.hoisted(() => vi.fn());
vi.mock("../../services/package-validator", async () => {
    const actual = await vi.importActual<
        typeof import("../../services/package-validator")
    >("../../services/package-validator");
    validateSpy.mockImplementation(actual.validatePackageForInstall);
    return { ...actual, validatePackageForInstall: validateSpy };
});

import { installObsidianDomHelpers } from "../../test/dom-polyfill";
import { makeMockPlugin } from "../../test/factories/plugin";
import { BasicTab } from "./BasicTab";
import { DEFAULT_SNIPPETS } from "../../presets";
import { defaultSnippetsAsGroup, DEFAULT_SNIPPETS_GROUP } from "../../store/presets";
import type { App } from "obsidian";
import type SnipSidianPlugin from "../../main";

/**
 * Mount tests for the General tab's B-131 "Restore default snippets"
 * flow:
 *
 *   1. The Defaults section renders with a Restore button.
 *   2. Empty library → Restore adds every default under
 *      `defaults/<trigger>`, saves, and reports the count.
 *   3. Everything present → informational Notice, no save.
 *   4. A bare pre-1.2.0 trigger is not duplicated; only missing
 *      defaults land.
 *   5. The write is gated through `validatePackageForInstall` — an
 *      invalid verdict blocks the write.
 */

beforeAll(() => {
    installObsidianDomHelpers();
});

let plugin: ReturnType<typeof makeMockPlugin>;
let app: App;
beforeEach(() => {
    document.body.innerHTML = "";
    noticeCalls.length = 0;
    validateSpy.mockClear();
    plugin = makeMockPlugin();
    app = plugin.app as unknown as App;
});

function mount(): { root: HTMLElement; restoreBtn: HTMLButtonElement } {
    const root = document.createElement("div");
    document.body.appendChild(root);
    new BasicTab(app, plugin as unknown as SnipSidianPlugin).render(root);
    const restoreBtn = Array.from(root.querySelectorAll("button")).find(
        (b) => b.textContent === "Restore",
    ) as HTMLButtonElement;
    if (!restoreBtn) throw new Error("BasicTab did not render the Restore button");
    return { root, restoreBtn };
}

async function click(btn: HTMLButtonElement) {
    btn.click();
    // restoreDefaults is async (saveSettings await); flush microtasks.
    await Promise.resolve();
    await Promise.resolve();
}

describe("BasicTab — Restore default snippets (B-131)", () => {
    it("renders the Defaults section with the Restore row", () => {
        const { root } = mount();
        const headings = Array.from(root.querySelectorAll("h4")).map((h) => h.textContent);
        expect(headings).toContain("Defaults");
        expect(
            Array.from(root.querySelectorAll(".snipsy-about-row-title")).map(
                (el) => el.textContent,
            ),
        ).toContain("Restore default snippets");
    });

    it("restores every default into the defaults group on an empty library", async () => {
        const { restoreBtn } = mount();
        await click(restoreBtn);

        expect(plugin.settings.snippets).toEqual(defaultSnippetsAsGroup());
        expect(plugin._saveCalls.length).toBe(1);
        const count = Object.keys(DEFAULT_SNIPPETS).length;
        expect(noticeCalls).toContain(`Restored ${count} default snippets`);
    });

    it("does nothing when every default is already present", async () => {
        plugin.settings.snippets = defaultSnippetsAsGroup();
        const { restoreBtn } = mount();
        await click(restoreBtn);

        expect(plugin._saveCalls.length).toBe(0);
        expect(noticeCalls).toContain("All default snippets are already in your library");
    });

    it("does not duplicate a bare pre-1.2.0 trigger, restores only the missing rest", async () => {
        plugin.settings.snippets = { todo: "- [ ] my own" };
        const { restoreBtn } = mount();
        await click(restoreBtn);

        expect(plugin.settings.snippets.todo).toBe("- [ ] my own");
        expect(plugin.settings.snippets[`${DEFAULT_SNIPPETS_GROUP}/todo`]).toBeUndefined();
        expect(plugin.settings.snippets[`${DEFAULT_SNIPPETS_GROUP}/done`]).toBe(
            DEFAULT_SNIPPETS.done,
        );
        expect(plugin._saveCalls.length).toBe(1);
    });

    it("blocks the write when validatePackageForInstall rejects", async () => {
        validateSpy.mockReturnValueOnce({
            isValid: false,
            errors: ["nope"],
            warnings: [],
        });
        const { restoreBtn } = mount();
        await click(restoreBtn);

        expect(validateSpy).toHaveBeenCalledOnce();
        expect(plugin.settings.snippets).toEqual({});
        expect(plugin._saveCalls.length).toBe(0);
        expect(noticeCalls).toContain("Cannot restore defaults: nope");
    });
});

// ---- B-137: Expansion section (require-prefix mode) ----
//
// The obsidian test stub's `Setting.setName`/`setDesc` are no-ops
// (they don't render text into the DOM), so rows can't be located by
// their label text the way real Obsidian markup could. BasicTab
// mounts exactly two `Setting` rows (both added for this section, in
// a fixed order: toggle first, dropdown second) — index-based lookup
// is precise and doesn't require touching the shared stub.
function toggleSettingEl(root: HTMLElement): HTMLElement {
    return root.querySelectorAll(".setting-item")[0] as HTMLElement;
}
function dropdownSettingEl(root: HTMLElement): HTMLElement {
    return root.querySelectorAll(".setting-item")[1] as HTMLElement;
}

async function flush() {
    await Promise.resolve();
    await Promise.resolve();
}

describe("BasicTab — Expansion section (B-137)", () => {
    it("renders the Expansion heading with a toggle and a prefix-char dropdown", () => {
        const { root } = mount();
        const headings = Array.from(root.querySelectorAll("h4")).map((h) => h.textContent);
        expect(headings).toContain("Expansion");

        const toggleSetting = toggleSettingEl(root);
        expect(toggleSetting.querySelector("input[type=checkbox]")).toBeTruthy();

        const dropdownSetting = dropdownSettingEl(root);
        expect(dropdownSetting.querySelector("select")).toBeTruthy();
    });

    it("defaults: toggle unchecked, dropdown disabled, value \":\"", () => {
        const { root } = mount();
        const toggle = toggleSettingEl(root).querySelector(
            "input[type=checkbox]",
        ) as HTMLInputElement;
        const select = dropdownSettingEl(root).querySelector(
            "select",
        ) as HTMLSelectElement;

        expect(toggle.checked).toBe(false);
        expect(select.disabled).toBe(true);
        expect(select.value).toBe(":");
    });

    it("reflects an already-on setting: toggle checked, dropdown enabled with the stored char", () => {
        plugin.settings.expansion = { requirePrefix: true, prefixChar: ";" };
        const { root } = mount();
        const toggle = toggleSettingEl(root).querySelector(
            "input[type=checkbox]",
        ) as HTMLInputElement;
        const select = dropdownSettingEl(root).querySelector(
            "select",
        ) as HTMLSelectElement;

        expect(toggle.checked).toBe(true);
        expect(select.disabled).toBe(false);
        expect(select.value).toBe(";");
    });

    it("toggling on writes requirePrefix:true and persists, and enables the dropdown", async () => {
        const { root } = mount();
        const toggle = toggleSettingEl(root).querySelector(
            "input[type=checkbox]",
        ) as HTMLInputElement;
        const select = dropdownSettingEl(root).querySelector(
            "select",
        ) as HTMLSelectElement;

        toggle.checked = true;
        toggle.dispatchEvent(new Event("change"));
        await flush();

        expect(plugin.settings.expansion?.requirePrefix).toBe(true);
        expect(plugin._saveCalls.length).toBe(1);
        expect(select.disabled).toBe(false);
    });

    it("toggling off writes requirePrefix:false and disables the dropdown", async () => {
        plugin.settings.expansion = { requirePrefix: true, prefixChar: ":" };
        const { root } = mount();
        const toggle = toggleSettingEl(root).querySelector(
            "input[type=checkbox]",
        ) as HTMLInputElement;
        const select = dropdownSettingEl(root).querySelector(
            "select",
        ) as HTMLSelectElement;

        toggle.checked = false;
        toggle.dispatchEvent(new Event("change"));
        await flush();

        expect(plugin.settings.expansion?.requirePrefix).toBe(false);
        expect(select.disabled).toBe(true);
    });

    it("changing the dropdown writes prefixChar and persists", async () => {
        plugin.settings.expansion = { requirePrefix: true, prefixChar: ":" };
        const { root } = mount();
        const select = dropdownSettingEl(root).querySelector(
            "select",
        ) as HTMLSelectElement;

        select.value = ";";
        select.dispatchEvent(new Event("change"));
        await flush();

        expect(plugin.settings.expansion?.prefixChar).toBe(";");
        expect(plugin._saveCalls.length).toBe(1);
    });

    it("toggling the mode does not clobber an already-chosen prefixChar", async () => {
        plugin.settings.expansion = { requirePrefix: false, prefixChar: ";" };
        const { root } = mount();
        const toggle = toggleSettingEl(root).querySelector(
            "input[type=checkbox]",
        ) as HTMLInputElement;

        toggle.checked = true;
        toggle.dispatchEvent(new Event("change"));
        await flush();

        expect(plugin.settings.expansion).toEqual({ requirePrefix: true, prefixChar: ";" });
    });
});
