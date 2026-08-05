// @vitest-environment jsdom

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";

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
import { Platform } from "obsidian";
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

// ---- B-137/B-150: Expansion section (require-prefix mode) ----
//
// B-150 restyled these two rows onto the plugin's card-row markup
// (`.snipsy-about-row` — same shell as Commands/Backup/Defaults)
// instead of raw `new Setting(container)` items, so Obsidian's
// `.setting-item` chrome no longer applies. BasicTab mounts exactly
// two rows for this section, in a fixed order: toggle first, dropdown
// second — index-based lookup within the Expansion list is precise.
function expansionListEl(root: HTMLElement): HTMLElement {
    const heading = Array.from(root.querySelectorAll("h4")).find(
        (h) => h.textContent === "Expansion",
    );
    if (!heading) throw new Error("Expansion heading not found");
    const list = heading.nextElementSibling as HTMLElement | null;
    if (!list) throw new Error("Expansion list container not found");
    return list;
}
function toggleRowEl(root: HTMLElement): HTMLElement {
    return expansionListEl(root).querySelectorAll(".snipsy-about-row")[0] as HTMLElement;
}
function dropdownRowEl(root: HTMLElement): HTMLElement {
    return expansionListEl(root).querySelectorAll(".snipsy-about-row")[1] as HTMLElement;
}

async function flush() {
    await Promise.resolve();
    await Promise.resolve();
}

describe("BasicTab — Expansion section (B-137/B-150)", () => {
    it("renders the Expansion heading with a toggle and a prefix-char dropdown", () => {
        const { root } = mount();
        const headings = Array.from(root.querySelectorAll("h4")).map((h) => h.textContent);
        expect(headings).toContain("Expansion");

        expect(toggleRowEl(root).querySelector("input[type=checkbox]")).toBeTruthy();
        expect(dropdownRowEl(root).querySelector("select")).toBeTruthy();
    });

    it("both Expansion rows use the plugin's card-row style (consistency guard, B-150)", () => {
        const { root } = mount();
        const list = expansionListEl(root);
        expect(list.classList.contains("snipsy-about-list")).toBe(true);

        for (const row of [toggleRowEl(root), dropdownRowEl(root)]) {
            expect(row.classList.contains("snipsy-about-row")).toBe(true);
            expect(row.querySelector(".snipsy-about-row-title")).toBeTruthy();
            expect(row.querySelector(".snipsy-about-row-desc")).toBeTruthy();
            // No leftover Obsidian `.setting-item` chrome from the old
            // `new Setting(container)` rendering.
            expect(row.classList.contains("setting-item")).toBe(false);
            expect(row.querySelector(".setting-item")).toBeNull();
        }

        expect(
            toggleRowEl(root).querySelector(".snipsy-about-row-title")?.textContent,
        ).toBe("Require a prefix before triggers");
        expect(
            dropdownRowEl(root).querySelector(".snipsy-about-row-title")?.textContent,
        ).toBe("Prefix character");
    });

    it("defaults: toggle unchecked, dropdown disabled, value \":\"", () => {
        const { root } = mount();
        const toggle = toggleRowEl(root).querySelector(
            "input[type=checkbox]",
        ) as HTMLInputElement;
        const select = dropdownRowEl(root).querySelector("select") as HTMLSelectElement;

        expect(toggle.checked).toBe(false);
        expect(select.disabled).toBe(true);
        expect(select.value).toBe(":");
    });

    it("reflects an already-on setting: toggle checked, dropdown enabled with the stored char", () => {
        plugin.settings.expansion = { requirePrefix: true, prefixChar: ";" };
        const { root } = mount();
        const toggle = toggleRowEl(root).querySelector(
            "input[type=checkbox]",
        ) as HTMLInputElement;
        const select = dropdownRowEl(root).querySelector("select") as HTMLSelectElement;

        expect(toggle.checked).toBe(true);
        expect(select.disabled).toBe(false);
        expect(select.value).toBe(";");
    });

    it("toggling on writes requirePrefix:true and persists, and enables the dropdown", async () => {
        const { root } = mount();
        const toggle = toggleRowEl(root).querySelector(
            "input[type=checkbox]",
        ) as HTMLInputElement;
        const select = dropdownRowEl(root).querySelector("select") as HTMLSelectElement;

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
        const toggle = toggleRowEl(root).querySelector(
            "input[type=checkbox]",
        ) as HTMLInputElement;
        const select = dropdownRowEl(root).querySelector("select") as HTMLSelectElement;

        toggle.checked = false;
        toggle.dispatchEvent(new Event("change"));
        await flush();

        expect(plugin.settings.expansion?.requirePrefix).toBe(false);
        expect(select.disabled).toBe(true);
    });

    it("changing the dropdown writes prefixChar and persists", async () => {
        plugin.settings.expansion = { requirePrefix: true, prefixChar: ":" };
        const { root } = mount();
        const select = dropdownRowEl(root).querySelector("select") as HTMLSelectElement;

        select.value = ";";
        select.dispatchEvent(new Event("change"));
        await flush();

        expect(plugin.settings.expansion?.prefixChar).toBe(";");
        expect(plugin._saveCalls.length).toBe(1);
    });

    it("toggling the mode does not clobber an already-chosen prefixChar", async () => {
        plugin.settings.expansion = { requirePrefix: false, prefixChar: ";" };
        const { root } = mount();
        const toggle = toggleRowEl(root).querySelector(
            "input[type=checkbox]",
        ) as HTMLInputElement;

        toggle.checked = true;
        toggle.dispatchEvent(new Event("change"));
        await flush();

        expect(plugin.settings.expansion).toEqual({ requirePrefix: true, prefixChar: ";" });
    });
});

// ---- B-144: Export snippets on mobile ----
//
// `exportJson`'s blob-anchor download is a silent no-op in iOS
// WKWebView — nothing happens, no error, no Notice. On
// `!Platform.isDesktop`, the export should land in the vault instead
// (falling back to the clipboard if that fails too), always with an
// honest Notice. `Platform` is a plain mutable object in the obsidian
// test stub — mutate it directly per test, restore in `afterEach`.
describe("BasicTab — Export snippets on mobile (B-144)", () => {
    const originalIsDesktop = Platform.isDesktop;

    beforeAll(() => {
        // jsdom doesn't implement the Blob-URL APIs the (unchanged)
        // desktop download path uses. Only the desktop test below
        // exercises that path — stub just enough that it doesn't
        // throw, so the async `exportJson()` call the click handler
        // fires doesn't produce an unhandled rejection.
        if (typeof URL.createObjectURL !== "function") {
            URL.createObjectURL = vi.fn(() => "blob:mock");
        }
        if (typeof URL.revokeObjectURL !== "function") {
            URL.revokeObjectURL = vi.fn();
        }
    });

    afterEach(() => {
        Platform.isDesktop = originalIsDesktop;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- cleanup only, test stub shape
        delete (navigator as any).clipboard;
    });

    function exportButton(root: HTMLElement): HTMLButtonElement {
        const btn = Array.from(root.querySelectorAll("button")).find(
            (b) => b.textContent === "Export JSON",
        ) as HTMLButtonElement | undefined;
        if (!btn) throw new Error("Export JSON button not found");
        return btn;
    }

    async function flush() {
        // The mobile path chains up to two sequential `vault.create`
        // attempts (plain filename, then timestamped retry) before
        // falling back to the clipboard — each `await` hop needs its
        // own microtask tick, so a couple of `Promise.resolve()`s
        // isn't always enough to drain the whole chain.
        for (let i = 0; i < 8; i++) {
            await Promise.resolve();
        }
    }

    it("desktop: unchanged blob-anchor path, vault.create is never called", async () => {
        Platform.isDesktop = true;
        const { root } = mount();
        const createSpy = vi.spyOn(plugin.app.vault, "create");
        exportButton(root).click();
        await flush();

        expect(createSpy).not.toHaveBeenCalled();
    });

    it("mobile: writes the export into the vault root and shows a Notice with the filename", async () => {
        Platform.isDesktop = false;
        plugin.settings.snippets = { hello: "world" };
        const { root } = mount();
        const createSpy = vi.spyOn(plugin.app.vault, "create");
        exportButton(root).click();
        await flush();

        expect(createSpy).toHaveBeenCalledTimes(1);
        const [filename, data] = createSpy.mock.calls[0] as [string, string];
        expect(filename).toBe("snipsidian-snippets.json");
        expect(JSON.parse(data)).toEqual({ hello: "world" });
        expect(noticeCalls).toContain("Exported to snipsidian-snippets.json in your vault");
    });

    it("mobile: a name collision on the plain filename retries once with a timestamp", async () => {
        Platform.isDesktop = false;
        const { root } = mount();
        let calls = 0;
        vi.spyOn(plugin.app.vault, "create").mockImplementation(async (path: string) => {
            calls++;
            if (path === "snipsidian-snippets.json") {
                throw new Error("File already exists");
            }
            return undefined as never;
        });
        exportButton(root).click();
        await flush();

        expect(calls).toBe(2);
        expect(
            noticeCalls.some(
                (m) =>
                    m.startsWith("Exported to snipsidian-snippets-") &&
                    m.endsWith(" in your vault"),
            ),
        ).toBe(true);
    });

    it("mobile: falls back to the clipboard when the vault write fails twice", async () => {
        Platform.isDesktop = false;
        plugin.settings.snippets = { hello: "world" };
        const { root } = mount();
        vi.spyOn(plugin.app.vault, "create").mockRejectedValue(new Error("read-only vault"));
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, "clipboard", {
            value: { writeText },
            configurable: true,
        });

        exportButton(root).click();
        await flush();

        expect(writeText).toHaveBeenCalledTimes(1);
        expect(JSON.parse(writeText.mock.calls[0][0] as string)).toEqual({ hello: "world" });
        expect(noticeCalls).toContain("Export copied to clipboard");
    });

    it("mobile: reports failure honestly when both the vault write and the clipboard fail", async () => {
        Platform.isDesktop = false;
        const { root } = mount();
        vi.spyOn(plugin.app.vault, "create").mockRejectedValue(new Error("read-only vault"));
        // No `navigator.clipboard` defined at all — the guard treats
        // this the same as a clipboard failure.

        exportButton(root).click();
        await flush();

        expect(noticeCalls.some((m) => m.startsWith("Export failed:"))).toBe(true);
    });
});

// ---- Fold-in: "Set hotkey" prefills the Hotkeys tab's search query ----
//
// `openHotkeyTab` used to only scroll-hunt for a `data-id` attribute
// that isn't documented anywhere; on a miss the user faced the full,
// unfiltered command list. Prefilling the search box (the community
// pattern) is the primary fix; the scroll stays as best-effort on top.
describe("BasicTab — Set hotkey prefills the Hotkeys search box", () => {
    function setHotkeyButton(root: HTMLElement, title: string): HTMLButtonElement {
        const btn = Array.from(root.querySelectorAll(".snipsy-about-row")).find(
            (row) => row.querySelector(".snipsy-about-row-title")?.textContent === title,
        )?.querySelector("button") as HTMLButtonElement | undefined;
        if (!btn) throw new Error(`Set-hotkey row "${title}" not found`);
        return btn;
    }

    it("calls setQuery with the command's display name when the tab exposes it", () => {
        const setQuery = vi.fn();
        vi.spyOn(app.setting, "openTabById").mockReturnValue({ setQuery });
        const { root } = mount();

        setHotkeyButton(root, "Insert snippet").click();

        expect(setQuery).toHaveBeenCalledWith("Insert snippet…");
    });

    it("falls back to searchComponent.setValue + onChanged when setQuery isn't present", () => {
        const setValue = vi.fn();
        const onChanged = vi.fn();
        vi.spyOn(app.setting, "openTabById").mockReturnValue({
            searchComponent: { setValue, onChanged },
        });
        const { root } = mount();

        setHotkeyButton(root, "Open settings").click();

        expect(setValue).toHaveBeenCalledWith("Open settings");
        expect(onChanged).toHaveBeenCalledOnce();
    });

    it("does not throw when openTabById returns undefined (real Obsidian internals may not match)", () => {
        vi.spyOn(app.setting, "openTabById").mockReturnValue(undefined);
        const { root } = mount();

        expect(() => setHotkeyButton(root, "Insert snippet").click()).not.toThrow();
    });

    it("does not throw when the returned tab has neither setQuery nor searchComponent", () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberately shape-mismatched internal-API stub
        vi.spyOn(app.setting, "openTabById").mockReturnValue({} as any);
        const { root } = mount();

        expect(() => setHotkeyButton(root, "Insert snippet").click()).not.toThrow();
    });
});
