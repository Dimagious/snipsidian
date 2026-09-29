// @vitest-environment jsdom

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";

// Stub `new Notice(msg)` so tests can assert on toast copy. `msg` can
// be a plain string or (for B-047's reveal-failure notice) a
// DocumentFragment — the mock just records whatever it's given.
const noticeCalls: Array<string | DocumentFragment> = [];
vi.mock("obsidian", async () => {
    const actual = await vi.importActual("../../test/stubs/obsidian");
    return {
        ...actual,
        Notice: vi.fn().mockImplementation((msg: string | DocumentFragment) => {
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
 * Mount tests for the General tab.
 *
 * UI redesign (2026-09): sections render via `renderSettingGroup` as
 * real `Setting` rows inside a sentence-case-heading group
 * (`.setting-item-heading` + `.snipsy-group .setting-item`) instead of
 * the old hand-rolled `.snipsy-about-row` card shell — helpers below
 * query the new shape. Behavioural coverage carried over unchanged:
 *
 *   1. B-131 "Restore default snippets" (empty library / already
 *      present / bare pre-1.2.0 trigger / validator gate).
 *   2. B-137/B-150 Expansion section (prefix toggle + char dropdown).
 *   3. B-144 mobile export fallback (vault write, retry, clipboard).
 *   4. "Set hotkey" prefills the Hotkeys tab's search box.
 *
 * New for the redesign:
 *   5. Section order: Expansion, Commands, Backup, Defaults.
 *   6. B-047: Reveal data file is hidden on mobile; on desktop a
 *      failure shows the path with a Copy path action instead of raw
 *      internals jargon.
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

function mount(onDeclarativeChange?: () => void): { root: HTMLElement } {
    const root = document.createElement("div");
    document.body.appendChild(root);
    new BasicTab(app, plugin as unknown as SnipSidianPlugin, onDeclarativeChange).render(root);
    return { root };
}

function groupHeadings(root: HTMLElement): string[] {
    return Array.from(root.querySelectorAll(".setting-item-heading .setting-item-name")).map(
        (el) => el.textContent,
    );
}

/** The rows body for the group with this heading text. Valid for both
 *  `renderSettingGroup` branches (see `setting-group.test.ts`):
 *  native `SettingGroup` (Obsidian >= 1.11) nests the heading INSIDE
 *  `.setting-group`, immediately before the `.setting-items` rows
 *  body — so the body is a sibling of the heading, not `.snipsy-group`
 *  itself (that class now lives on the outer `.setting-group`, not the
 *  rows container, per F4). The pre-1.11 fallback renders the heading
 *  as a standalone row, immediately followed by a sibling
 *  `.snipsy-group.snipsy-group-fallback` body. */
function groupBody(root: HTMLElement, heading: string): HTMLElement {
    const nameEl = Array.from(root.querySelectorAll(".setting-item-heading .setting-item-name")).find(
        (el) => el.textContent === heading,
    );
    if (!nameEl) throw new Error(`Group heading "${heading}" not found`);
    const headingEl = nameEl.closest(".setting-item-heading") as HTMLElement;
    const body = headingEl.nextElementSibling as HTMLElement | null;
    if (!body || (!body.classList.contains("setting-items") && !body.classList.contains("snipsy-group"))) {
        throw new Error(`Group body for "${heading}" not found`);
    }
    return body;
}

function rowByTitle(root: HTMLElement, title: string): HTMLElement {
    const row = Array.from(root.querySelectorAll(".setting-item")).find(
        (el) => el.querySelector(".setting-item-name")?.textContent === title,
    );
    if (!row) throw new Error(`Row "${title}" not found`);
    return row as HTMLElement;
}

function buttonInRow(row: HTMLElement, text: string): HTMLButtonElement {
    const btn = Array.from(row.querySelectorAll("button")).find((b) => b.textContent === text);
    if (!btn) throw new Error(`Button "${text}" not found in row`);
    return btn as HTMLButtonElement;
}

async function click(btn: HTMLButtonElement) {
    btn.click();
    // restoreDefaults is async (saveSettings await); flush microtasks.
    await Promise.resolve();
    await Promise.resolve();
}

describe("BasicTab — section order and shape (UI redesign)", () => {
    it("renders sections in Expansion, Commands, Backup, Defaults order, no redundant page heading", () => {
        const { root } = mount();
        expect(root.querySelector("h3.snipsy-tab-heading")).toBeNull();
        expect(groupHeadings(root)).toEqual(["Expansion", "Commands", "Backup", "Defaults"]);
    });
});

describe("BasicTab — Restore default snippets (B-131)", () => {
    it("renders the Defaults group with the Restore row", () => {
        const { root } = mount();
        expect(groupHeadings(root)).toContain("Defaults");
        const row = rowByTitle(root, "Restore default snippets");
        expect(buttonInRow(row, "Restore")).toBeTruthy();
    });

    it("restores every default into the defaults group on an empty library", async () => {
        const { root } = mount();
        await click(buttonInRow(rowByTitle(root, "Restore default snippets"), "Restore"));

        expect(plugin.settings.snippets).toEqual(defaultSnippetsAsGroup());
        expect(plugin._saveCalls.length).toBe(1);
        const count = Object.keys(DEFAULT_SNIPPETS).length;
        expect(noticeCalls).toContain(`Restored ${count} default snippets`);
    });

    it("does nothing when every default is already present", async () => {
        plugin.settings.snippets = defaultSnippetsAsGroup();
        const { root } = mount();
        await click(buttonInRow(rowByTitle(root, "Restore default snippets"), "Restore"));

        expect(plugin._saveCalls.length).toBe(0);
        expect(noticeCalls).toContain("All default snippets are already in your library");
    });

    it("does not duplicate a bare pre-1.2.0 trigger, restores only the missing rest", async () => {
        plugin.settings.snippets = { todo: "- [ ] my own" };
        const { root } = mount();
        await click(buttonInRow(rowByTitle(root, "Restore default snippets"), "Restore"));

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
        const { root } = mount();
        await click(buttonInRow(rowByTitle(root, "Restore default snippets"), "Restore"));

        expect(validateSpy).toHaveBeenCalledOnce();
        expect(plugin.settings.snippets).toEqual({});
        expect(plugin._saveCalls.length).toBe(0);
        expect(noticeCalls).toContain("Cannot restore defaults: nope");
    });
});

// ---- Finding #2: onDeclarativeChange callback ----
//
// `SnipSidianSettingTab` wires this to its own `refreshDeclarative()`
// (`this.update()`, guarded to 1.13+ — see `SettingsTab.test.ts`).
// These tests pin BasicTab's half of the contract in isolation: the
// callback fires after a write that changes the snippet count, and
// does NOT fire when a "restore"/"import" action didn't actually
// write anything (already-up-to-date library, validation rejection).
describe("BasicTab — onDeclarativeChange callback (finding #2)", () => {
    it("fires after Restore default snippets actually writes", async () => {
        const onDeclarativeChange = vi.fn();
        const { root } = mount(onDeclarativeChange);
        await click(buttonInRow(rowByTitle(root, "Restore default snippets"), "Restore"));

        expect(plugin._saveCalls.length).toBe(1);
        expect(onDeclarativeChange).toHaveBeenCalledTimes(1);
    });

    it("does NOT fire when every default is already present (no write)", async () => {
        const onDeclarativeChange = vi.fn();
        plugin.settings.snippets = defaultSnippetsAsGroup();
        const { root } = mount(onDeclarativeChange);
        await click(buttonInRow(rowByTitle(root, "Restore default snippets"), "Restore"));

        expect(plugin._saveCalls.length).toBe(0);
        expect(onDeclarativeChange).not.toHaveBeenCalled();
    });

    it("does NOT fire when validatePackageForInstall rejects the restore", async () => {
        validateSpy.mockReturnValueOnce({ isValid: false, errors: ["nope"], warnings: [] });
        const onDeclarativeChange = vi.fn();
        const { root } = mount(onDeclarativeChange);
        await click(buttonInRow(rowByTitle(root, "Restore default snippets"), "Restore"));

        expect(onDeclarativeChange).not.toHaveBeenCalled();
    });

    it("fires after an Import snippets confirm actually writes", async () => {
        const onDeclarativeChange = vi.fn();
        const { root } = mount(onDeclarativeChange);

        // `startImport` builds a detached `<input type=file>` via the
        // global `createEl` and wires its own `onchange` — simulate a
        // file pick by spying on that global to capture the input,
        // then invoking its handler directly with a minimal
        // file-like object (jsdom's own `File` doesn't implement
        // `.text()`; `startImport` only calls that one method),
        // rather than trying to drive a real native file-picker
        // dialog.
        const createElSpy = vi.spyOn(globalThis as unknown as { createEl: typeof createEl }, "createEl");
        buttonInRow(rowByTitle(root, "Import snippets"), "Import JSON").click();
        const inputCall = createElSpy.mock.results.find(
            (r) => (r.value as HTMLElement).tagName === "INPUT",
        );
        const input = inputCall!.value as HTMLInputElement;
        const file = { text: async () => JSON.stringify({ hello: "world" }) };
        Object.defineProperty(input, "files", { value: [file], configurable: true });
        await input.onchange!({ target: input } as unknown as Event);
        await Promise.resolve();

        // The import flow opens `ImportPreviewModal` and waits for the
        // user to click Apply — click it (defaults to merge mode).
        const apply = document.querySelector(
            ".modal-button-container .mod-cta",
        ) as HTMLButtonElement | null;
        expect(apply).toBeTruthy();
        apply!.click();
        await Promise.resolve();
        await Promise.resolve();

        expect(plugin.settings.snippets.hello).toBe("world");
        expect(onDeclarativeChange).toHaveBeenCalledTimes(1);
    });
});

// ---- B-137/B-150: Expansion section (require-prefix mode) ----
function toggleRowEl(root: HTMLElement): HTMLElement {
    return rowByTitle(root, "Require a prefix before triggers");
}
function dropdownRowEl(root: HTMLElement): HTMLElement {
    return rowByTitle(root, "Prefix character");
}

async function flush() {
    await Promise.resolve();
    await Promise.resolve();
}

describe("BasicTab — Expansion section (B-137/B-150)", () => {
    it("renders the Expansion heading with a toggle and a prefix-char dropdown", () => {
        const { root } = mount();
        expect(groupHeadings(root)).toContain("Expansion");

        expect(toggleRowEl(root).querySelector("input[type=checkbox]")).toBeTruthy();
        expect(dropdownRowEl(root).querySelector("select")).toBeTruthy();
    });

    it("both Expansion rows live inside the Expansion group as real setting-item rows", () => {
        const { root } = mount();
        const body = groupBody(root, "Expansion");
        expect(body.contains(toggleRowEl(root))).toBe(true);
        expect(body.contains(dropdownRowEl(root))).toBe(true);

        for (const row of [toggleRowEl(root), dropdownRowEl(root)]) {
            expect(row.classList.contains("setting-item")).toBe(true);
            expect(row.querySelector(".setting-item-name")).toBeTruthy();
            expect(row.querySelector(".setting-item-description")).toBeTruthy();
        }
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
        // The dependent row dims as a whole while the toggle is off
        // (not just the dropdown's own glyph).
        expect(dropdownRowEl(root).classList.contains("is-disabled")).toBe(true);
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
        expect(dropdownRowEl(root).classList.contains("is-disabled")).toBe(false);
    });

    it("toggling on writes requirePrefix:true and persists, enables the dropdown, and undims the row", async () => {
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
        expect(dropdownRowEl(root).classList.contains("is-disabled")).toBe(false);
    });

    it("toggling off writes requirePrefix:false, disables the dropdown, and dims the row", async () => {
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
        expect(dropdownRowEl(root).classList.contains("is-disabled")).toBe(true);
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
        return buttonInRow(rowByTitle(root, "Export snippets"), "Export JSON");
    }

    async function flushExport() {
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
        await flushExport();

        expect(createSpy).not.toHaveBeenCalled();
    });

    it("mobile: writes the export into the vault root and shows a Notice with the filename", async () => {
        Platform.isDesktop = false;
        plugin.settings.snippets = { hello: "world" };
        const { root } = mount();
        const createSpy = vi.spyOn(plugin.app.vault, "create");
        exportButton(root).click();
        await flushExport();

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
        await flushExport();

        expect(calls).toBe(2);
        expect(
            noticeCalls.some(
                (m) =>
                    typeof m === "string" &&
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
        await flushExport();

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
        await flushExport();

        expect(
            noticeCalls.some((m) => typeof m === "string" && m.startsWith("Export failed:")),
        ).toBe(true);
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
        return buttonInRow(rowByTitle(root, title), "Set hotkey");
    }

    it("calls setQuery with the command's display name when the tab exposes it", () => {
        const setQuery = vi.fn();
        vi.spyOn(app.setting, "openTabById").mockReturnValue({ setQuery });
        const { root } = mount();

        setHotkeyButton(root, "Set hotkey for Insert snippet").click();

        expect(setQuery).toHaveBeenCalledWith("Insert snippet…");
    });

    it("falls back to searchComponent.setValue + onChanged when setQuery isn't present", () => {
        const setValue = vi.fn();
        const onChanged = vi.fn();
        vi.spyOn(app.setting, "openTabById").mockReturnValue({
            searchComponent: { setValue, onChanged },
        });
        const { root } = mount();

        setHotkeyButton(root, "Set hotkey for Open settings").click();

        expect(setValue).toHaveBeenCalledWith("Open settings");
        expect(onChanged).toHaveBeenCalledOnce();
    });

    it("does not throw when openTabById returns undefined (real Obsidian internals may not match)", () => {
        vi.spyOn(app.setting, "openTabById").mockReturnValue(undefined);
        const { root } = mount();

        expect(() => setHotkeyButton(root, "Set hotkey for Insert snippet").click()).not.toThrow();
    });

    it("does not throw when the returned tab has neither setQuery nor searchComponent", () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberately shape-mismatched internal-API stub
        vi.spyOn(app.setting, "openTabById").mockReturnValue({} as any);
        const { root } = mount();

        expect(() => setHotkeyButton(root, "Set hotkey for Insert snippet").click()).not.toThrow();
    });
});

// ---- B-047: Reveal data file ----
describe("BasicTab — Reveal data file (B-047)", () => {
    const originalIsDesktop = Platform.isDesktop;
    afterEach(() => {
        Platform.isDesktop = originalIsDesktop;
    });

    it("is hidden entirely on mobile — the row does not render", () => {
        Platform.isDesktop = false;
        const { root } = mount();
        expect(root.querySelector(".setting-item-name")).toBeTruthy(); // sanity: other rows exist
        expect(
            Array.from(root.querySelectorAll(".setting-item-name")).some(
                (el) => el.textContent === "Reveal data file",
            ),
        ).toBe(false);
    });

    it("renders on desktop with the 'Show in folder' wording", () => {
        Platform.isDesktop = true;
        const { root } = mount();
        const row = rowByTitle(root, "Reveal data file");
        expect(row.querySelector(".setting-item-description")?.textContent).toBe(
            "Show the data file in your file manager.",
        );
        expect(buttonInRow(row, "Show in folder")).toBeTruthy();
    });

    it("desktop failure with no computable path shows a plain-language notice and no path/Copy button", () => {
        Platform.isDesktop = true;
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            const { root } = mount();
            // Strip `getBasePath` so `revealDataFile` fails before it
            // ever computes a path — e.g. a non-FileSystemAdapter
            // vault. jsdom never has `window.require("electron")`
            // either way, so both branches fail; this one fails
            // earlier.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberately shape-mismatched adapter for this branch
            (plugin.app.vault as any).adapter = {};

            buttonInRow(rowByTitle(root, "Reveal data file"), "Show in folder").click();

            expect(errorSpy).toHaveBeenCalledWith(
                "[snipsy] failed to reveal data file",
                expect.any(Error),
            );
            expect(noticeCalls.length).toBe(1);
            const notice = noticeCalls[0];
            expect(notice).toBeInstanceOf(DocumentFragment);
            const frag = notice as DocumentFragment;
            expect(frag.textContent).toContain("Could not open the file manager.");
            // No path was computed, so no "Data file:" line or Copy
            // path button.
            expect(frag.textContent).not.toContain("Data file:");
            expect(frag.querySelector("button")).toBeNull();
        } finally {
            errorSpy.mockRestore();
        }
    });

    it("desktop failure with a known path (electron shell unavailable under jsdom) shows it with a working Copy path button", () => {
        Platform.isDesktop = true;
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, "clipboard", {
            value: { writeText },
            configurable: true,
        });
        try {
            // Default mock app: getBasePath → "/test-vault", configDir
            // → ".obsidian" — `revealDataFile` computes a path, then
            // fails on the (never-present-under-jsdom) electron shell
            // lookup, exercising the "path known" branch.
            const { root } = mount();
            buttonInRow(rowByTitle(root, "Reveal data file"), "Show in folder").click();

            expect(errorSpy).toHaveBeenCalledWith(
                "[snipsy] failed to reveal data file",
                expect.any(Error),
            );
            const frag = noticeCalls[0] as DocumentFragment;
            expect(frag.textContent).toContain(
                "/test-vault/.obsidian/plugins/snipsidian/data.json",
            );
            const copyBtn = frag.querySelector("button") as HTMLButtonElement;
            expect(copyBtn?.textContent).toBe("Copy path");

            copyBtn.click();
            expect(writeText).toHaveBeenCalledWith(
                "/test-vault/.obsidian/plugins/snipsidian/data.json",
            );
        } finally {
            errorSpy.mockRestore();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- cleanup only, test stub shape
            delete (navigator as any).clipboard;
        }
    });
});
