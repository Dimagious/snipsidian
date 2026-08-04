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
