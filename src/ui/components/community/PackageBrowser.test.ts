// @vitest-environment jsdom

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

// Stub `new Notice(msg)` so tests can assert on toast copy.
const noticeCalls: string[] = [];
vi.mock("obsidian", async () => {
    const actual = await vi.importActual("../../../test/stubs/obsidian");
    return {
        ...actual,
        Notice: vi.fn().mockImplementation((msg: string) => {
            noticeCalls.push(msg);
        }),
    };
});

// B-142: PackageBrowser's install/uninstall/reinstall click→plan→write
// wiring has no net (the file is coverage-excluded, vitest.config.ts)
// even though the pure logic underneath (`core/install-plan.ts`) is
// well tested — B-017 shipped exactly in this gap. Mock the network
// loader so `render()` can resolve deterministically without hitting
// GitHub; the packages array is set per test via
// `loadAllCommunityPackagesMock.mockResolvedValue(...)`.
const loadAllCommunityPackagesMock = vi.hoisted(() => vi.fn());
vi.mock("../../../services/community-packages", () => ({
    loadAllCommunityPackages: loadAllCommunityPackagesMock,
}));

import { installObsidianDomHelpers } from "../../../test/dom-polyfill";
import { makeMockPlugin } from "../../../test/factories/plugin";
import { PackageBrowser, shouldOpenPackageDetailsOnKeydown } from "./PackageBrowser";
import type { App } from "obsidian";
import type SnipSidianPlugin from "../../../main";

/**
 * Mount tests for `PackageBrowser` — the click→plan→write path for
 * install / uninstall / reinstall, plus the B-135 keydown-wiring
 * guard (a regression here would silently un-wire the a11y fix without
 * any test failing).
 */

beforeAll(() => {
    installObsidianDomHelpers();
});

let plugin: ReturnType<typeof makeMockPlugin>;
let app: App;

beforeEach(() => {
    document.body.innerHTML = "";
    noticeCalls.length = 0;
    loadAllCommunityPackagesMock.mockReset();
    plugin = makeMockPlugin();
    app = plugin.app as unknown as App;
});

const SAMPLE_PACK = {
    label: "Markdown Essentials",
    description: "Handy markdown snippets",
    author: "Snipsy",
    version: "1.0.0",
    snippets: { todo: "- [ ]", done: "- [x]" },
};

async function mount(packages: Array<Record<string, unknown>> = [SAMPLE_PACK]): Promise<{
    root: HTMLElement;
    browser: PackageBrowser;
}> {
    loadAllCommunityPackagesMock.mockResolvedValue({ packages, source: "live" });
    const root = document.createElement("div");
    document.body.appendChild(root);
    const browser = new PackageBrowser(app, plugin as unknown as SnipSidianPlugin);
    await browser.render(root);
    return { root, browser };
}

async function flush(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

function packageRow(root: HTMLElement, label: string): HTMLElement {
    const rows = Array.from(root.querySelectorAll(".package-row"));
    const row = rows.find(
        (r) => r.querySelector(".package-name")?.textContent === label,
    ) as HTMLElement | undefined;
    if (!row) throw new Error(`Package row "${label}" not found`);
    return row;
}

function rowButton(row: HTMLElement, text: string): HTMLButtonElement {
    const btn = Array.from(row.querySelectorAll("button")).find(
        (b) => b.textContent === text,
    ) as HTMLButtonElement | undefined;
    if (!btn) throw new Error(`Row button "${text}" not found`);
    return btn;
}

function modalButton(text: string): HTMLButtonElement {
    const btn = Array.from(
        document.body.querySelectorAll(".modal-button-container button"),
    ).find((b) => b.textContent === text) as HTMLButtonElement | undefined;
    if (!btn) throw new Error(`Modal button "${text}" not found`);
    return btn;
}

describe("PackageBrowser — install (B-142)", () => {
    it("clicking Install opens the preview modal, and Apply writes the grouped keys + saves", async () => {
        const { root } = await mount();
        rowButton(packageRow(root, "Markdown Essentials"), "Install").click();

        // Preview modal open with the diff — Apply commits it.
        modalButton("Apply").click();
        await flush();

        expect(plugin.settings.snippets["Markdown Essentials/todo"]).toBe("- [ ]");
        expect(plugin.settings.snippets["Markdown Essentials/done"]).toBe("- [x]");
        expect(plugin._saveCalls.length).toBe(1);
    });

    it("does not write anything until the preview modal is applied", async () => {
        const { root } = await mount();
        rowButton(packageRow(root, "Markdown Essentials"), "Install").click();

        expect(plugin.settings.snippets).toEqual({});
        expect(plugin._saveCalls.length).toBe(0);
    });

    it("cancelling the preview modal writes nothing", async () => {
        const { root } = await mount();
        rowButton(packageRow(root, "Markdown Essentials"), "Install").click();
        modalButton("Cancel").click();

        expect(plugin.settings.snippets).toEqual({});
        expect(plugin._saveCalls.length).toBe(0);
    });

    it("a cross-group trigger collision refuses the install outright — no write, no modal", async () => {
        plugin.settings.snippets["Other/todo"] = "a totally different value";
        const { root } = await mount();
        rowButton(packageRow(root, "Markdown Essentials"), "Install").click();

        expect(
            noticeCalls.some((m) => m.startsWith("Skipped install: trigger name collision")),
        ).toBe(true);
        expect(plugin.settings.snippets).toEqual({ "Other/todo": "a totally different value" });
        expect(plugin._saveCalls.length).toBe(0);
        expect(document.body.querySelector(".modal-content")).toBeNull();
    });
});

describe("PackageBrowser — failed save rolls back (B-181)", () => {
    it("restores the previous snippets (same object) when saveSettings rejects after Apply", async () => {
        const previous = plugin.settings.snippets;
        plugin.saveSettings = vi.fn().mockRejectedValue(new Error("disk full"));
        const { root } = await mount();
        rowButton(packageRow(root, "Markdown Essentials"), "Install").click();
        modalButton("Apply").click();
        await flush();

        expect(noticeCalls.some((m) => m.startsWith("Failed to install package"))).toBe(true);
        expect(plugin.settings.snippets).toBe(previous);
        expect(plugin.settings.snippets).toEqual({});
    });
});

describe("PackageBrowser — install-time validation failure Notice (checker finding #2)", () => {
    // Regression guard: `installPackage`'s "Cannot install" Notice used
    // to interpolate `pkg.label` raw, only sanitizing the trailing
    // validation-error text. A package's `label` is untrusted
    // (GitHub-fetched community catalog data) — an oversized or
    // control-char label reached the Notice DOM text node unmodified.
    // These fail before the fix (raw label present verbatim / message
    // unbounded) and pass after wrapping `pkg.label` in
    // `sanitizeForNotice` too.

    it("strips control characters out of an oversized package label before the Cannot install Notice", async () => {
        // >50 chars fails `validatePackageForInstall`'s label-length
        // check, so `installPackage` reaches the "Cannot install"
        // Notice branch without needing an invalid snippet.
        const badLabel = `Bad${"\x07\x00\x1B"}Label${"A".repeat(60)}`;
        const { root } = await mount([
            { ...SAMPLE_PACK, label: badLabel },
        ]);
        rowButton(packageRow(root, badLabel), "Install").click();

        const notice = noticeCalls.find((m) => m.startsWith("Cannot install"));
        expect(notice).toBeDefined();
        // eslint-disable-next-line no-control-regex -- asserting control chars are ABSENT
        expect(notice).not.toMatch(/[\x00-\x1F\x7F-\x9F]/);
        expect(plugin.settings.snippets).toEqual({});
        expect(plugin._saveCalls.length).toBe(0);
    });

    it("caps an oversized package label's contribution to the Cannot install Notice", async () => {
        const hugeLabel = "L".repeat(400);
        const { root } = await mount([
            { ...SAMPLE_PACK, label: hugeLabel },
        ]);
        rowButton(packageRow(root, hugeLabel), "Install").click();

        const notice = noticeCalls.find((m) => m.startsWith("Cannot install"));
        expect(notice).toBeDefined();
        // sanitizeForNotice's default cap (300) plus surrounding copy —
        // nowhere near the raw 400-char label reaching the Notice whole.
        expect(notice?.length ?? 0).toBeLessThan(400);
        expect(notice).toContain("…");
    });
});

describe("PackageBrowser — uninstall (B-142)", () => {
    async function mountInstalled() {
        plugin.settings.snippets["Markdown Essentials/todo"] = "- [ ]";
        plugin.settings.snippets["Markdown Essentials/done"] = "- [x]";
        plugin.settings.snippets["Other Pack/keep"] = "untouched";
        return mount();
    }

    it("removes exactly the pack's keys and saves, leaving other groups untouched", async () => {
        const { root } = await mountInstalled();
        rowButton(packageRow(root, "Markdown Essentials"), "Uninstall").click();
        modalButton("Uninstall").click();
        await flush();

        expect(plugin.settings.snippets["Markdown Essentials/todo"]).toBeUndefined();
        expect(plugin.settings.snippets["Markdown Essentials/done"]).toBeUndefined();
        expect(plugin.settings.snippets["Other Pack/keep"]).toBe("untouched");
        expect(plugin._saveCalls.length).toBe(1);
    });

    it("removes a user's edited value too (uninstall leaves no trace of the pack)", async () => {
        const { root } = await mountInstalled();
        plugin.settings.snippets["Markdown Essentials/todo"] = "- [ ] USER EDIT";
        rowButton(packageRow(root, "Markdown Essentials"), "Uninstall").click();
        modalButton("Uninstall").click();
        await flush();

        expect(plugin.settings.snippets["Markdown Essentials/todo"]).toBeUndefined();
    });

    it("cancelling the uninstall confirm modal writes nothing", async () => {
        const { root } = await mountInstalled();
        const before = JSON.stringify(plugin.settings.snippets);
        rowButton(packageRow(root, "Markdown Essentials"), "Uninstall").click();
        modalButton("Cancel").click();

        expect(JSON.stringify(plugin.settings.snippets)).toBe(before);
        expect(plugin._saveCalls.length).toBe(0);
    });
});

describe("PackageBrowser — reinstall (B-142, B-017 regression surface)", () => {
    it("routes through the conflict preview and defaults to 'keep current', preserving a user edit", async () => {
        // User installed the pack, then edited "todo".
        plugin.settings.snippets["Markdown Essentials/todo"] = "- [ ] USER EDIT";
        plugin.settings.snippets["Markdown Essentials/done"] = "- [x]";
        const { root } = await mount();

        rowButton(packageRow(root, "Markdown Essentials"), "Reinstall").click();
        // Apply with no changes to the per-row selects — default is
        // "keep current" for every conflict (B-017).
        modalButton("Apply").click();
        await flush();

        expect(plugin.settings.snippets["Markdown Essentials/todo"]).toBe("- [ ] USER EDIT");
        expect(plugin._saveCalls.length).toBe(1);

        // ux#7 fold-in: nothing actually changed (one conflict, kept;
        // "done" already matched upstream and contributes nothing to
        // `diff.added`) — the Notice must say so honestly instead of
        // claiming the full pack size was "installed".
        expect(noticeCalls).toContain(
            'No changes — "Markdown Essentials" already matches your library',
        );
        expect(noticeCalls.some((m) => m.startsWith("Installed"))).toBe(false);
    });

    it("choosing 'Overwrite all' on reinstall replaces the user's edit with upstream", async () => {
        plugin.settings.snippets["Markdown Essentials/todo"] = "- [ ] USER EDIT";
        plugin.settings.snippets["Markdown Essentials/done"] = "- [x]";
        const { root } = await mount();

        rowButton(packageRow(root, "Markdown Essentials"), "Reinstall").click();
        const overwriteAll = Array.from(
            document.body.querySelectorAll(".snipsidian-bulk-actions button"),
        ).find((b) => b.textContent === "Overwrite all") as HTMLButtonElement;
        overwriteAll.click();
        modalButton("Apply").click();
        await flush();

        expect(plugin.settings.snippets["Markdown Essentials/todo"]).toBe("- [ ]");
        // One conflict, overwritten → 1 actually changed, not the
        // full 2-snippet pack size.
        expect(noticeCalls).toContain('Installed Markdown Essentials (1 snippet)');
    });

    it("a mixed reinstall (one new snippet, one kept conflict) reports only the new one", async () => {
        // "todo" is a user-edited conflict the user keeps; "done"
        // doesn't exist yet locally, so it's a genuine addition.
        plugin.settings.snippets["Markdown Essentials/todo"] = "- [ ] USER EDIT";
        const { root } = await mount();

        rowButton(packageRow(root, "Markdown Essentials"), "Reinstall").click();
        modalButton("Apply").click();
        await flush();

        expect(plugin.settings.snippets["Markdown Essentials/todo"]).toBe("- [ ] USER EDIT");
        expect(plugin.settings.snippets["Markdown Essentials/done"]).toBe("- [x]");
        expect(noticeCalls).toContain('Installed Markdown Essentials (1 snippet)');
    });
});

describe("PackageBrowser — package-row keydown wiring (B-135 regression guard)", () => {
    it("Enter on the Install button installs — it must NOT be hijacked by the row's own keydown handler", async () => {
        const { root } = await mount();
        const row = packageRow(root, "Markdown Essentials");
        const installBtn = rowButton(row, "Install");

        // shouldOpenPackageDetailsOnKeydown(key, target, row) must
        // return false when target is a descendant button — pin the
        // actual wiring (`row.addEventListener("keydown", ...)` calls
        // this exact function with `e.target`/`row`), not just the
        // pure function in isolation.
        expect(shouldOpenPackageDetailsOnKeydown("Enter", installBtn, row)).toBe(false);

        // Drive it through the real row listener: dispatch keydown
        // with the button as target (jsdom sets `e.target` from
        // `dispatchEvent`'s call site when invoked on the button and
        // the event bubbles to the row).
        const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
        installBtn.dispatchEvent(event);
        await flush();

        // Real activation (click) still needs to happen for jsdom
        // (dispatching keydown doesn't synthesize a click on a real
        // <button>) — but the row must not have opened the details
        // modal as a side effect of the keydown.
        expect(document.body.querySelector(".modal-content")).toBeNull();
    });
});
