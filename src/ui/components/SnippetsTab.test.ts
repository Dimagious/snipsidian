// @vitest-environment jsdom

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { installObsidianDomHelpers } from "../../test/dom-polyfill";
import { makeMockPlugin } from "../../test/factories/plugin";
import { SnippetsTab } from "./SnippetsTab";
import type { App } from "obsidian";
import type SnipSidianPlugin from "../../main";

/**
 * Mount tests for SnippetsTab — pins the single-edit-mode contract
 * that fixed B-021 in 1.1.0 (re-render machine destroying in-flight
 * edits).
 *
 * Before 1.1.0, every state change called `renderSnippetList(root)`,
 * which wiped the DOM and any open edit state with it — Save on row
 * A would silently discard typing-in-progress on row B because the
 * edit form lived in a local closure.
 *
 * The 1.1.0 fix lifted edit state to `UIStateManager`. These tests
 * pin the new contract:
 *
 *   1. Clicking Edit on row A opens an edit form bound to A's draft
 *   2. The draft survives `renderList` calls (we trigger one via a
 *      group toggle and verify the input still mounts with the
 *      draft's typed value)
 *   3. Opening Edit on row B while A is editing discards A's draft
 *      (single-edit-mode, predictable over silent data loss)
 *   4. Save persists and clears editing state
 *   5. Cancel discards the draft
 *
 * Also pinned: B-099 search count badge ("N of M") shows only on
 * filter, not on the unfiltered list.
 */

beforeAll(() => {
    installObsidianDomHelpers();
});

let plugin: SnipSidianPlugin;
let app: App;
let root: HTMLDivElement;

beforeEach(() => {
    document.body.innerHTML = "";
    root = document.createElement("div");
    root.classList.add("snipsidian-settings");
    document.body.appendChild(root);
});

function mount(
    initialSnippets: Record<string, string> = {},
): { tab: SnippetsTab } {
    const mockPlugin = makeMockPlugin({
        settings: { snippets: initialSnippets },
    });
    plugin = mockPlugin as unknown as SnipSidianPlugin;
    app = mockPlugin.app as unknown as App;
    const tab = new SnippetsTab(app, plugin);
    tab.render(root);
    return { tab };
}

/** Find the edit button for a snippet by its trigger name in the
 *  current row layout. Rows render under `.snippet-row` with the
 *  trigger as the first cell's text. */
function findRow(triggerName: string): HTMLElement | null {
    const rows = root.querySelectorAll(".snippet-row");
    for (const row of rows) {
        const triggerCell = row.querySelector(".snippet-trigger");
        if (triggerCell?.textContent?.trim() === triggerName) {
            return row as HTMLElement;
        }
    }
    return null;
}

function findRowEditButton(triggerName: string): HTMLButtonElement | null {
    const row = findRow(triggerName);
    if (!row) return null;
    return row.querySelector('[aria-label^="Edit snippet"]') as HTMLButtonElement | null;
}

function expandGroup(groupTitle: string): void {
    const headers = root.querySelectorAll(".group-header");
    for (const header of headers) {
        const title = header.querySelector(".group-title");
        if (title?.textContent === groupTitle) {
            const toggle = header.querySelector(".group-toggle") as HTMLButtonElement;
            toggle.click();
            return;
        }
    }
    throw new Error(`Group "${groupTitle}" not found`);
}

describe("SnippetsTab — heading + toolbar shape", () => {
    // AUDIT X3: the redundant per-tab page heading is gone — the active
    // tab button already says "Snippets", and the tabpanel carries
    // `aria-labelledby` (SettingsTab.ts) for the accessible name, so no
    // second heading duplicates it inside the panel content.
    it("does not render a redundant page heading above the toolbar", () => {
        mount({ hello: "world" });
        expect(root.querySelector("h3.snipsy-tab-heading")).toBeNull();
        expect(root.querySelector(".snipsy-snippet-list")).not.toBeNull();
    });

    it("renders the toolbar with a search input, count badge, Add snippet, and icon actions", () => {
        mount({ a: "1", b: "2" });
        const toolbar = root.querySelector(".snipsy-snippet-toolbar");
        expect(toolbar).not.toBeNull();
        expect(toolbar?.querySelector("input[aria-label='Filter snippets']")).not.toBeNull();

        // Add snippet is a real (accent) button.
        const addBtn = Array.from(toolbar?.querySelectorAll("button.snippet-action") ?? []).find(
            (b) => b.textContent === "Add snippet",
        );
        expect(addBtn).toBeTruthy();
        expect(addBtn?.classList.contains("mod-cta")).toBe(true);

        // Select and Expand all are clickable icons with a tooltip/
        // aria-label instead of visible text (owner decision #2).
        const selectIcon = toolbar?.querySelector('[aria-label="Select snippets"]');
        const expandIcon = toolbar?.querySelector('[aria-label="Expand all"]');
        expect(selectIcon).toBeTruthy();
        expect(selectIcon?.classList.contains("snippet-icon-action")).toBe(true);
        expect(selectIcon?.textContent).toBe("");
        expect(expandIcon).toBeTruthy();
        expect(expandIcon?.textContent).toBe("");
    });
});

describe("SnippetsTab — search filter count badge (B-099)", () => {
    it("hides the count badge when the filter is empty", () => {
        mount({ a: "1", b: "2", c: "3" });
        const badge = root.querySelector(".snipsy-filter-count");
        expect(badge?.classList.contains("is-hidden")).toBe(true);
    });

    it("shows 'N of M' badge after typing into the filter", () => {
        mount({ apple: "1", apricot: "2", banana: "3" });
        const search = root.querySelector(
            "input[aria-label='Filter snippets']",
        ) as HTMLInputElement;
        search.value = "ap";
        search.dispatchEvent(new Event("input"));
        const badge = root.querySelector(".snipsy-filter-count");
        expect(badge?.classList.contains("is-hidden")).toBe(false);
        // 2 matches out of 3 total entries.
        expect(badge?.textContent).toBe("2 of 3");
    });
});

describe("SnippetsTab — single-edit-mode (B-021 regression surface)", () => {
    it("opens an edit form when Edit is clicked on a row", () => {
        mount({ hello: "world" });
        // Default group is "Ungrouped" — expand it to reveal the row.
        expandGroup("Ungrouped");
        const editBtn = findRowEditButton("hello");
        expect(editBtn).not.toBeNull();
        editBtn!.click();
        // The row should now be in edit mode — class `is-editing`
        // toggled, and the trigger + replacement inputs rendered.
        const editingRow = root.querySelector(".snippet-row.is-editing");
        expect(editingRow).not.toBeNull();
        const triggerInput = editingRow!.querySelector(
            "input[aria-label='Snippet trigger']",
        ) as HTMLInputElement;
        const replacementInput = editingRow!.querySelector(
            "textarea[aria-label='Snippet replacement']",
        ) as HTMLTextAreaElement;
        expect(triggerInput.value).toBe("hello");
        expect(replacementInput.value).toBe("world");
    });

    it("discards row A's draft when the user opens Edit on row B (single-edit-mode)", () => {
        mount({ alpha: "1", bravo: "2" });
        expandGroup("Ungrouped");

        // Open edit on alpha, type a new replacement, then open
        // edit on bravo without saving.
        findRowEditButton("alpha")!.click();
        const alphaTextarea = root.querySelector(
            ".snippet-row.is-editing textarea[aria-label='Snippet replacement']",
        ) as HTMLTextAreaElement;
        alphaTextarea.value = "ALPHA UNSAVED";
        alphaTextarea.dispatchEvent(new Event("input"));

        findRowEditButton("bravo")!.click();

        // Only one row should be in edit mode now — bravo's.
        const editingRows = root.querySelectorAll(".snippet-row.is-editing");
        expect(editingRows.length).toBe(1);
        const bravoTriggerInput = editingRows[0]?.querySelector(
            "input[aria-label='Snippet trigger']",
        ) as HTMLInputElement;
        expect(bravoTriggerInput.value).toBe("bravo");

        // Alpha's unsaved value did NOT land in settings.
        expect(plugin.settings.snippets.alpha).toBe("1");
    });

    it("Save persists edits and exits edit mode", async () => {
        mount({ hello: "world" });
        expandGroup("Ungrouped");
        findRowEditButton("hello")!.click();

        const textarea = root.querySelector(
            ".snippet-row.is-editing textarea[aria-label='Snippet replacement']",
        ) as HTMLTextAreaElement;
        textarea.value = "world EDITED";
        textarea.dispatchEvent(new Event("input"));

        // Click Save (mod-cta within the edit form's actions row).
        const saveBtn = root.querySelector(
            ".snippet-row.is-editing .actions .mod-cta",
        ) as HTMLButtonElement;
        saveBtn.click();
        // Save is async (awaits saveSettings). Yield one microtask.
        await Promise.resolve();
        await Promise.resolve();

        expect(plugin.settings.snippets.hello).toBe("world EDITED");
        // Edit mode exited.
        expect(root.querySelectorAll(".snippet-row.is-editing").length).toBe(0);
    });

    it("Cancel discards the draft without writing settings", () => {
        mount({ hello: "world" });
        expandGroup("Ungrouped");
        findRowEditButton("hello")!.click();

        const textarea = root.querySelector(
            ".snippet-row.is-editing textarea[aria-label='Snippet replacement']",
        ) as HTMLTextAreaElement;
        textarea.value = "world DISCARDED";
        textarea.dispatchEvent(new Event("input"));

        // Find the Cancel button — first action button in the
        // form (Save is the .mod-cta one).
        const cancelBtn = Array.from(
            root.querySelectorAll(".snippet-row.is-editing .actions button"),
        ).find((b) => !b.classList.contains("mod-cta")) as HTMLButtonElement;
        cancelBtn.click();

        expect(plugin.settings.snippets.hello).toBe("world");
        expect(root.querySelectorAll(".snippet-row.is-editing").length).toBe(0);
    });
});

describe("SnippetsTab — empty + filtered empty states", () => {
    it("renders an 'add your first snippet' empty state when no snippets exist", () => {
        mount({});
        const empty = root.querySelector(".snipsy-empty");
        expect(empty?.textContent).toContain("No snippets yet.");
    });

    it("renders a 'no match' empty state when filter has no results", () => {
        mount({ hello: "world" });
        const search = root.querySelector(
            "input[aria-label='Filter snippets']",
        ) as HTMLInputElement;
        search.value = "no-such-thing";
        search.dispatchEvent(new Event("input"));
        const empty = root.querySelector(".snipsy-empty");
        expect(empty?.textContent).toContain("No snippets match your filter");
    });
});

// B-124 regression: pre-fix the click handler was only on the tiny
// 14×14 chevron `.group-toggle` button. CSS had `cursor: pointer` on
// the whole `.group-header`, which was lying — clicking the title text
// or the count badge did nothing. Reported by a real user against
// 1.1.7 ("Она не открывается" — clicked the title, expected expand,
// nothing). Fix: click handler moved to the header div; chevron stays
// as the AT-accessible affordance + visual indicator (no own click
// handler — keyboard activation on the button bubbles to header).
// UI redesign: a muted group shows an "Off" flair on its header so
// the disabled state is readable without hovering, and a multi-line
// replacement renders embedded newlines as a faint ↵ marker instead
// of flattening them to invisible whitespace.
describe("SnippetsTab — redesign: muted-group flair + multi-line preview", () => {
    function mountWithDisabled(
        snippets: Record<string, string>,
        disabledGroups: string[] = [],
    ): void {
        const mockPlugin = makeMockPlugin({ settings: { snippets, disabledGroups } });
        plugin = mockPlugin as unknown as SnipSidianPlugin;
        app = mockPlugin.app as unknown as App;
        new SnippetsTab(app, plugin).render(root);
    }

    it("shows an 'Off' flair on a disabled group's header, and none on an enabled one", () => {
        mountWithDisabled(
            { "work/sig": "Best", "personal/todo": "- [ ] " },
            ["work"],
        );
        const headers = Array.from(root.querySelectorAll(".group-header"));
        const workHeader = headers.find(
            (h) => h.querySelector(".group-title")?.textContent === "Work",
        );
        const personalHeader = headers.find(
            (h) => h.querySelector(".group-title")?.textContent === "Personal",
        );
        expect(workHeader?.querySelector(".group-off-flair")?.textContent).toBe("Off");
        expect(personalHeader?.querySelector(".group-off-flair")).toBeNull();
    });

    it("renders a faint ↵ marker for each embedded newline in a snippet's replacement preview", () => {
        mountWithDisabled({ mtg: "## Meeting: $|\n**Date:** $date" });
        expandGroup("Ungrouped");
        const row = findRow("mtg")!;
        const preview = row.querySelector(".snippet-replacement") as HTMLElement;
        const markers = preview.querySelectorAll(".nl");
        expect(markers.length).toBe(1);
        expect(markers[0]?.textContent).toBe("↵");
        expect(preview.textContent).toBe("## Meeting: $|↵**Date:** $date");
    });

    it("renders a single-line replacement with no ↵ marker at all", () => {
        mountWithDisabled({ hello: "world" });
        expandGroup("Ungrouped");
        const row = findRow("hello")!;
        const preview = row.querySelector(".snippet-replacement") as HTMLElement;
        expect(preview.querySelectorAll(".nl").length).toBe(0);
        expect(preview.textContent).toBe("world");
    });
});

describe("SnippetsTab — group header click target (B-124)", () => {
    it("expands the group when the title text is clicked, not just the chevron", () => {
        mount({ hello: "world", brb: "be right back" });
        const header = root.querySelector(".group-header") as HTMLElement;
        expect(header).toBeTruthy();
        const title = header.querySelector(".group-title") as HTMLElement;
        expect(title?.textContent).toBe("Ungrouped");

        // Body not yet rendered — group starts collapsed.
        expect(root.querySelector(".group-content")).toBeNull();

        // Click on the title text (NOT the chevron) — pre-fix this did
        // nothing because the handler was scoped to `.group-toggle`.
        // The click bubbles up to the header div which now owns the
        // toggle behaviour.
        title.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        // Body now rendered with the two rows.
        const content = root.querySelector(".group-content");
        expect(content).toBeTruthy();
        expect(content?.querySelectorAll(".snippet-row").length).toBe(2);
    });

    it("expands the group when the count badge is clicked too (whole header is the hit-target)", () => {
        mount({ a: "1", b: "2", c: "3" });
        const count = root.querySelector(".group-count") as HTMLElement;
        expect(count?.textContent).toBe("3");

        count.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(root.querySelectorAll(".snippet-row").length).toBe(3);
    });

    it("the chevron button still toggles via its bubbled click (keyboard activation path)", () => {
        mount({ hello: "world" });
        const toggle = root.querySelector(".group-toggle") as HTMLButtonElement;
        // `.click()` on a button generates a click event that bubbles
        // up to the header — same path the keyboard activation
        // (Enter / Space on the focused button) takes.
        toggle.click();
        expect(root.querySelector(".group-content")).toBeTruthy();
    });

    it("clicking the rename action does not toggle the group (stopPropagation contract preserved)", () => {
        // Setup: group already open so we can verify rename doesn't
        // accidentally COLLAPSE it via the header listener.
        // After every click that triggers renderList() the DOM is
        // rebuilt — re-query each time.
        mount({ "alpha/a": "1", "alpha/b": "2" });

        const findAlphaTitle = () =>
            Array.from(root.querySelectorAll(".group-header")).find(
                (h) => h.querySelector(".group-title")?.textContent === "Alpha",
            )?.querySelector(".group-title") as HTMLElement | undefined;

        // Open via title click first.
        findAlphaTitle()!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(root.querySelectorAll(".snippet-row").length).toBe(2);

        // Click the rename button — should NOT toggle the group closed.
        // (It opens a modal; we don't assert on the modal here, just on
        // the toggle invariant: rows still rendered after the click.)
        const renameBtn = root.querySelector(
            '[aria-label^="Rename group Alpha"]',
        ) as HTMLButtonElement;
        renameBtn.click();

        // Group still open (renameBtn fires stopPropagation, so the
        // header click handler never sees the event).
        expect(root.querySelectorAll(".snippet-row").length).toBe(2);
    });
});

// B-133 regression: `AddSnippetModal`'s Add handler used to call
// `onConfirm` then unconditionally `this.close()` — real validation
// (`planAddSnippet`) runs downstream in `showAddSnippetModal`, so any
// failure there closed the modal anyway and discarded everything the
// user typed. `onConfirm` now reports success/failure via
// `SnippetOpResult`; the modal only closes on `{ ok: true }`.
describe("SnippetsTab — Add-snippet modal stays open on failure (B-133)", () => {
    function openAddModal(): void {
        const addBtn = Array.from(
            root.querySelectorAll("button.snippet-action"),
        ).find((b) => b.textContent === "Add snippet") as HTMLButtonElement;
        addBtn.click();
    }

    function modalField(placeholder: string): HTMLInputElement | HTMLTextAreaElement {
        return document.body.querySelector(
            `input[placeholder="${placeholder}"], textarea[placeholder="${placeholder}"]`,
        ) as HTMLInputElement | HTMLTextAreaElement;
    }

    function modalSubmitButton(): HTMLButtonElement {
        return Array.from(
            document.body.querySelectorAll(".modal-content button"),
        ).find((b) => b.textContent === "Add snippet") as HTMLButtonElement;
    }

    function fillAndSubmit(trigger: string, replacement: string, group = ""): void {
        const triggerInput = modalField("Example: brb") as HTMLInputElement;
        triggerInput.value = trigger;
        triggerInput.dispatchEvent(new Event("input"));
        const replacementInput = modalField("Example: hello, world!") as HTMLTextAreaElement;
        replacementInput.value = replacement;
        replacementInput.dispatchEvent(new Event("input"));
        if (group) {
            const groupInput = modalField("Example: greetings") as HTMLInputElement;
            groupInput.value = group;
            groupInput.dispatchEvent(new Event("input"));
        }
        modalSubmitButton().click();
    }

    // The `onConfirm` callback in `showAddSnippetModal` is async
    // (`await this.plugin.saveSettings()`), and the modal itself
    // resolves the outcome through a promise chain — flush the
    // microtask queue before asserting.
    async function flush(): Promise<void> {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
    }

    it("invalid trigger keeps the modal open, shows the error, writes nothing", async () => {
        mount({});
        openAddModal();
        expect(document.body.querySelector(".modal-content")).not.toBeNull();

        fillAndSubmit("e-mail", "test@example.com");
        await flush();

        // Modal still attached — did NOT close.
        expect(document.body.querySelector(".modal-content")).not.toBeNull();
        const err = document.body.querySelector(".snipsidian-error");
        expect(err?.textContent).toContain("Invalid trigger");
        expect(Object.keys(plugin.settings.snippets).length).toBe(0);
        // B-088: the error div is aria-live="polite" so AT users hear
        // the validation failure without losing input focus.
        expect(err?.getAttribute("aria-live")).toBe("polite");
    });

    it("duplicate/cross-group trigger collision keeps the modal open and shows the error", async () => {
        mount({ "work/brb": "be right back" });
        openAddModal();

        fillAndSubmit("brb", "something else", "personal");
        await flush();

        expect(document.body.querySelector(".modal-content")).not.toBeNull();
        const err = document.body.querySelector(".snipsidian-error");
        expect(err?.textContent).toContain("already exists");
        expect(plugin.settings.snippets["personal/brb"]).toBeUndefined();
    });

    it("valid input closes the modal, writes the snippet, and saves", async () => {
        mount({});
        openAddModal();

        fillAndSubmit("brb", "be right back");
        await flush();

        // Modal closed — removed from the DOM.
        expect(document.body.querySelector(".modal-content")).toBeNull();
        expect(plugin.settings.snippets["brb"]).toBe("be right back");
    });

    // Checker finding (2026-08-05 review): a rejected `onConfirm`
    // (e.g. `plugin.saveSettings()` failing) used to be swallowed —
    // `console.error` only, modal left open with zero user-visible
    // feedback. CLAUDE.md §4: never swallow errors.
    it("a rejected save shows an inline error instead of failing silently, and keeps the modal open", async () => {
        mount({});
        plugin.saveSettings = async () => {
            throw new Error("disk full");
        };
        openAddModal();

        fillAndSubmit("brb", "be right back");
        await flush();

        // Did NOT close on a failed save.
        expect(document.body.querySelector(".modal-content")).not.toBeNull();
        const err = document.body.querySelector(".snipsidian-error");
        expect(err?.textContent).toContain("Could not save snippet");
        expect(err?.textContent).toContain("disk full");
        expect(err?.getAttribute("aria-live")).toBe("polite");
    });
});

// ---- B-138: per-group enable/disable ----

describe("SnippetsTab — per-group enable/disable (B-138)", () => {
    function mountWithDisabled(
        snippets: Record<string, string>,
        disabledGroups: string[] = [],
    ): { tab: SnippetsTab } {
        const mockPlugin = makeMockPlugin({
            settings: { snippets, disabledGroups },
        });
        plugin = mockPlugin as unknown as SnipSidianPlugin;
        app = mockPlugin.app as unknown as App;
        const tab = new SnippetsTab(app, plugin);
        tab.render(root);
        return { tab };
    }

    function groupHeaderFor(groupTitle: string): HTMLElement {
        const headers = root.querySelectorAll(".group-header");
        for (const header of headers) {
            const title = header.querySelector(".group-title");
            if (title?.textContent === groupTitle) return header as HTMLElement;
        }
        throw new Error(`Group "${groupTitle}" not found`);
    }

    // `.snipsy-group-enable-toggle` is `toggleEl` — the
    // `label.checkbox-container` wrapper (real API and stub both
    // match this now), not the checkbox input itself. It's what
    // carries `aria-label` and receives the click; `enableCheckboxFor`
    // below reaches into it for the actual `<input>` that carries
    // `.checked` and fires `change`.
    function enableToggleFor(groupTitle: string): HTMLElement {
        const toggle = groupHeaderFor(groupTitle).querySelector(
            ".snipsy-group-enable-toggle",
        ) as HTMLElement | null;
        if (!toggle) throw new Error(`Enable toggle for "${groupTitle}" not found`);
        return toggle;
    }

    function enableCheckboxFor(groupTitle: string): HTMLInputElement {
        const input = enableToggleFor(groupTitle).querySelector("input") as HTMLInputElement | null;
        if (!input) throw new Error(`Enable checkbox for "${groupTitle}" not found`);
        return input;
    }

    async function flush() {
        await Promise.resolve();
        await Promise.resolve();
    }

    it("renders an enable/disable toggle on a real group's header, checked by default", () => {
        mountWithDisabled({ "work/sig": "Best" });
        expect(enableCheckboxFor("Work").checked).toBe(true);
        expect(enableToggleFor("Work").getAttribute("aria-label")).toBe("Enable/disable group Work");
    });

    it("does NOT render a toggle on the Ungrouped pseudo-group", () => {
        mountWithDisabled({ hello: "world" });
        const header = groupHeaderFor("Ungrouped");
        expect(header.querySelector(".snipsy-group-enable-toggle")).toBeNull();
    });

    it("a disabled group starts unchecked and its groupEl carries the dimming class", () => {
        mountWithDisabled({ "work/sig": "Best" }, ["work"]);
        expect(enableCheckboxFor("Work").checked).toBe(false);
        const groupEl = groupHeaderFor("Work").closest(".snippet-group");
        expect(groupEl?.classList.contains("snippet-group-disabled")).toBe(true);
    });

    it("unchecking the toggle disables the group, persists, and dims it (round-trip: off)", async () => {
        mountWithDisabled({ "work/sig": "Best" });
        const checkbox = enableCheckboxFor("Work");
        checkbox.checked = false;
        checkbox.dispatchEvent(new Event("change"));
        await flush();

        expect(plugin.settings.disabledGroups).toEqual(["work"]);
        expect(plugin._saveCalls.length).toBe(1);
        const groupEl = groupHeaderFor("Work").closest(".snippet-group");
        expect(groupEl?.classList.contains("snippet-group-disabled")).toBe(true);
    });

    it("re-checking the toggle re-enables the group and persists (round-trip: back on)", async () => {
        mountWithDisabled({ "work/sig": "Best" }, ["work"]);
        let checkbox = enableCheckboxFor("Work");
        expect(checkbox.checked).toBe(false);

        checkbox.checked = true;
        checkbox.dispatchEvent(new Event("change"));
        await flush();

        expect(plugin.settings.disabledGroups).toEqual([]);
        expect(plugin._saveCalls.length).toBe(1);
        checkbox = enableCheckboxFor("Work");
        expect(checkbox.checked).toBe(true);
        const groupEl = groupHeaderFor("Work").closest(".snippet-group");
        expect(groupEl?.classList.contains("snippet-group-disabled")).toBe(false);
    });

    it("toggling one group's checkbox does not affect another group's disabled state", async () => {
        mountWithDisabled(
            { "work/sig": "Best", "personal/todo": "- [ ] " },
            ["personal"],
        );
        const workCheckbox = enableCheckboxFor("Work");
        workCheckbox.checked = false;
        workCheckbox.dispatchEvent(new Event("change"));
        await flush();

        expect(new Set(plugin.settings.disabledGroups)).toEqual(new Set(["work", "personal"]));
    });

    // Scorecard parity fix (0.4.1): the toggle's `change` listener used to be
    // a bare `async () => {...}` passed straight to `addEventListener`
    // (flagged by @typescript-eslint/no-misused-promises — DOM listeners
    // must return void). It's now a sync callback that delegates to a named
    // async method via `void this.setGroupEnabled(...)`. That method wraps
    // its `await saveSettings()` in try/catch, so a rejection is caught
    // rather than becoming an unhandled promise rejection (which the bare
    // `void`-discarded call would otherwise produce) — CLAUDE.md §4: never
    // swallow errors silently, but also never let one escape unhandled.
    it("a rejected save from the group-disable toggle does not throw or leave an unhandled rejection", async () => {
        // Fake timers wrap the whole test, including `mountWithDisabled`:
        // the initial `renderList()` auto-syncs each group's open state
        // via `UIStateManager#setGroupOpen`, which arms a real 250ms
        // `window.setTimeout` debounce (ui-state.ts). If that timer isn't
        // faked from the start, it stays pending on the real clock past
        // this test's end and can fire later — against the rejecting
        // `saveSettings` mock installed below — as an unhandled rejection
        // in a subsequent test. This is the CI-only flake this test pins
        // (GitHub Actions run 31030336533).
        vi.useFakeTimers();
        try {
            mountWithDisabled({ "work/sig": "Best" });
            plugin.saveSettings = async () => {
                throw new Error("disk full");
            };
            const checkbox = enableCheckboxFor("Work");
            checkbox.checked = false;

            expect(() => checkbox.dispatchEvent(new Event("change"))).not.toThrow();
            await flush();

            // The in-memory mutation is applied before the save is attempted
            // (same order as saveEdit/moveSelectedSnippets/renameGroup below) —
            // only persistence failed, not the local state update.
            expect(plugin.settings.disabledGroups).toEqual(["work"]);

            // Restore a resolving save, then deterministically flush the
            // group-open debounce timer armed by the initial mount so it
            // doesn't leak past this test still wired to a rejecting mock.
            plugin.saveSettings = async () => {};
            await vi.advanceTimersByTimeAsync(300);
        } finally {
            vi.useRealTimers();
        }
    });

    // Fix round (checker finding 3, fix/scorecard-parity-0.4.1): on a failed
    // save, `setGroupEnabled` used to skip `renderList()` (it only sat in the
    // try block, right after `saveSettings()`), leaving the row's grey-out
    // styling out of sync with the in-memory `disabledGroups` mutation above.
    // The re-render now runs in `finally`, so the row's styling matches the
    // applied state even when persistence failed. This test fails without
    // that fix: the stale header still carries no `snippet-group-disabled`
    // class even though `disabledGroups` already contains "work".
    it("a rejected save from the group-disable toggle still re-renders so the grey-out class matches the applied state", async () => {
        // See the previous test for why fake timers wrap the whole test
        // body: `mountWithDisabled` arms a real 250ms group-open debounce
        // timer that must not survive past this test still pointed at the
        // rejecting `saveSettings` mock below.
        vi.useFakeTimers();
        try {
            mountWithDisabled({ "work/sig": "Best" });
            plugin.saveSettings = async () => {
                throw new Error("disk full");
            };
            const checkbox = enableCheckboxFor("Work");
            checkbox.checked = false;
            checkbox.dispatchEvent(new Event("change"));
            await flush();

            const groupEl = groupHeaderFor("Work").closest(".snippet-group");
            expect(groupEl?.classList.contains("snippet-group-disabled")).toBe(true);
            // The re-rendered checkbox must also reflect the applied
            // (disabled) state, not the pre-toggle "enabled" default.
            expect(enableCheckboxFor("Work").checked).toBe(false);

            plugin.saveSettings = async () => {};
            await vi.advanceTimersByTimeAsync(300);
        } finally {
            vi.useRealTimers();
        }
    });

    it("clicking the toggle does not also collapse/expand the group accordion", () => {
        mountWithDisabled({ "work/sig": "Best" });
        const toggle = enableToggleFor("Work");
        // The group starts closed (default); clicking the enable
        // toggle must not bubble into the header's click-to-toggle
        // handler and flip open state as a side effect.
        toggle.click();
        // Re-query after the re-render triggered by the toggle's own
        // `change` handler — the header's own accordion-open listener
        // must NOT have also fired.
        const header = groupHeaderFor("Work");
        const chevron = header.querySelector(".group-toggle") as HTMLButtonElement;
        expect(chevron.getAttribute("aria-expanded")).toBe("false");
    });

    it("deleting a group removes its entry from disabledGroups", async () => {
        mountWithDisabled({ "work/sig": "Best" }, ["work"]);
        const header = groupHeaderFor("Work");
        const deleteBtn = header.querySelector(
            '[aria-label="Delete group Work"]',
        ) as HTMLButtonElement;
        deleteBtn.click();
        // ConfirmModal opened — click its "Delete" confirm button.
        const confirmBtn = Array.from(
            document.body.querySelectorAll("button"),
        ).find((b) => b.textContent === "Delete") as HTMLButtonElement;
        confirmBtn.click();
        await flush();

        expect(plugin.settings.snippets["work/sig"]).toBeUndefined();
        expect(plugin.settings.disabledGroups).toEqual([]);
    });

    it("deleting a DIFFERENT (enabled) group leaves an existing disabledGroups entry untouched", async () => {
        mountWithDisabled(
            { "work/sig": "Best", "personal/todo": "- [ ] " },
            ["work"],
        );
        const header = groupHeaderFor("Personal");
        const deleteBtn = header.querySelector(
            '[aria-label="Delete group Personal"]',
        ) as HTMLButtonElement;
        deleteBtn.click();
        const confirmBtn = Array.from(
            document.body.querySelectorAll("button"),
        ).find((b) => b.textContent === "Delete") as HTMLButtonElement;
        confirmBtn.click();
        await flush();

        expect(plugin.settings.snippets["personal/todo"]).toBeUndefined();
        expect(plugin.settings.disabledGroups).toEqual(["work"]);
    });

    // B-138 (checker follow-up): renaming a group used to leave
    // `disabledGroups` untouched — the snippets moved to the new
    // slug but the mute state stayed pinned to the old (now-dead)
    // slug, so (a) the renamed group silently re-enabled and (b) the
    // stale old slug lingered, ready to mis-disable some future
    // unrelated group that happened to slugify to the same name.
    it("renaming a disabled group carries the disabled state to the new slug", async () => {
        mountWithDisabled({ "work/sig": "Best" }, ["work"]);

        const header = groupHeaderFor("Work");
        const renameBtn = header.querySelector(
            '[aria-label^="Rename group Work"]',
        ) as HTMLButtonElement;
        renameBtn.click();

        const modalInput = document.body.querySelector(
            ".snipsidian-prompt input",
        ) as HTMLInputElement;
        modalInput.value = "Office";
        modalInput.dispatchEvent(new Event("input"));
        const submitBtn = Array.from(
            document.body.querySelectorAll(".modal-button-container button"),
        ).find((b) => b.textContent === "Rename") as HTMLButtonElement;
        submitBtn.click();
        await flush();

        expect(plugin.settings.snippets["office/sig"]).toBe("Best");
        expect(plugin.settings.disabledGroups).toEqual(["office"]);
    });
});

// ---- B-142: bulk delete + bulk move wiring ----
//
// `SnippetsTab.ts` is coverage-excluded (vitest.config.ts) — the pure
// helpers underneath (`bulkMoveKeys`, `safeRenameKey`) are tested in
// `ui/utils/group-utils.test.ts`, but the wiring from the bulk-bar
// buttons through the confirm/picker modals to `saveSettings` had no
// mount test. Precedent for exactly this class of bug: B-118
// (PackagePreviewModal DOM duplication) shipped and was only caught
// manually. These tests drive the real selection-mode UI end to end.
describe("SnippetsTab — bulk delete + bulk move (B-142)", () => {
    async function flush(): Promise<void> {
        await Promise.resolve();
        await Promise.resolve();
    }

    function enterSelectionMode(): void {
        const selectBtn = root.querySelector(
            '.snipsy-snippet-toolbar [aria-label="Select snippets"]',
        ) as HTMLButtonElement;
        selectBtn.click();
    }

    function checkboxFor(triggerName: string): HTMLInputElement {
        const row = findRow(triggerName);
        if (!row) throw new Error(`Row "${triggerName}" not found`);
        const cb = row.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
        if (!cb) throw new Error(`Checkbox for "${triggerName}" not found`);
        return cb;
    }

    function selectRows(triggerNames: string[]): void {
        for (const name of triggerNames) {
            const cb = checkboxFor(name);
            cb.checked = true;
            cb.dispatchEvent(new Event("change"));
        }
    }

    function bulkBarButton(text: string): HTMLButtonElement {
        const btn = Array.from(root.querySelectorAll(".snipsy-bulk-bar button")).find(
            (b) => b.textContent === text,
        ) as HTMLButtonElement | undefined;
        if (!btn) throw new Error(`Bulk bar button "${text}" not found`);
        return btn;
    }

    function modalConfirmButton(text: string): HTMLButtonElement {
        // Scoped to `.modal-button-container` (not all of
        // `document.body`) — the bulk bar's own "Delete" button has
        // the same text and lives in `root`, which is also a
        // `document.body` descendant; an unscoped query would find
        // that button again instead of the modal's.
        const btn = Array.from(
            document.body.querySelectorAll(".modal-button-container button"),
        ).find((b) => b.textContent === text) as HTMLButtonElement | undefined;
        if (!btn) throw new Error(`Modal button "${text}" not found`);
        return btn;
    }

    it("selecting 2 of 3 snippets then bulk-deleting removes exactly the selected keys and saves", async () => {
        mount({ a: "1", b: "2", c: "3" });
        expandGroup("Ungrouped");
        enterSelectionMode();
        selectRows(["a", "c"]);

        bulkBarButton("Delete").click();
        modalConfirmButton("Delete").click();
        await flush();

        expect(plugin.settings.snippets).toEqual({ b: "2" });
        expect(plugin._saveCalls.length).toBe(1);
    });

    it("bulk delete leaves unselected snippets untouched", async () => {
        mount({ a: "1", b: "2", c: "3" });
        expandGroup("Ungrouped");
        enterSelectionMode();
        selectRows(["b"]);

        bulkBarButton("Delete").click();
        modalConfirmButton("Delete").click();
        await flush();

        expect(plugin.settings.snippets.a).toBe("1");
        expect(plugin.settings.snippets.c).toBe("3");
        expect(plugin.settings.snippets.b).toBeUndefined();
    });

    it("cancelling the bulk-delete confirm modal writes nothing", () => {
        mount({ a: "1", b: "2", c: "3" });
        expandGroup("Ungrouped");
        enterSelectionMode();
        selectRows(["a", "c"]);

        bulkBarButton("Delete").click();
        modalConfirmButton("Cancel").click();

        expect(plugin.settings.snippets).toEqual({ a: "1", b: "2", c: "3" });
        expect(plugin._saveCalls.length).toBe(0);
    });

    it("selecting 2 of 3 snippets then bulk-moving them lands under the target group; the rest stay put", async () => {
        mount({ a: "1", b: "2", c: "3" });
        expandGroup("Ungrouped");
        enterSelectionMode();
        selectRows(["a", "c"]);

        bulkBarButton("Move to group").click();
        const select = document.body.querySelector(
            ".snipsidian-move-form select",
        ) as HTMLSelectElement;
        select.value = "__new__";
        select.dispatchEvent(new Event("change"));
        const input = document.body.querySelector(
            ".snipsidian-newgroup-wrap input",
        ) as HTMLInputElement;
        input.value = "Archive";
        modalConfirmButton("Move").click();
        await flush();

        expect(plugin.settings.snippets["archive/a"]).toBe("1");
        expect(plugin.settings.snippets["archive/c"]).toBe("3");
        expect(plugin.settings.snippets.a).toBeUndefined();
        expect(plugin.settings.snippets.c).toBeUndefined();
        // Untouched.
        expect(plugin.settings.snippets.b).toBe("2");
        expect(plugin._saveCalls.length).toBe(1);
    });
});

// ---- F5a/F5b: group header layout ----
//
// F5a: the mute toggle is always visible, right of the group name —
// NOT inside `.group-actions` (Rename/Delete stay hover-revealed on
// devices that have hover; the mute control is exempt).
// F5b: in selection mode, a select-all checkbox sits at the header's
// left edge (same edge as row checkboxes), with an indeterminate
// state when some-but-not-all of the group's rows are selected.
describe("SnippetsTab — group header layout (F5a/F5b)", () => {
    function groupHeaderFor(groupTitle: string): HTMLElement {
        const headers = root.querySelectorAll(".group-header");
        for (const header of headers) {
            const title = header.querySelector(".group-title");
            if (title?.textContent === groupTitle) return header as HTMLElement;
        }
        throw new Error(`Group "${groupTitle}" not found`);
    }

    function enterSelectionMode(): void {
        const selectBtn = root.querySelector(
            '.snipsy-snippet-toolbar [aria-label="Select snippets"]',
        ) as HTMLButtonElement;
        selectBtn.click();
    }

    it("the mute toggle lives outside .group-actions, right of the name/count", () => {
        mount({ "work/a": "1", "work/b": "2" });
        const header = groupHeaderFor("Work");
        const muteWrap = header.querySelector(".group-mute") as HTMLElement;
        const actions = header.querySelector(".group-actions") as HTMLElement;
        expect(muteWrap).toBeTruthy();
        expect(muteWrap.querySelector(".snipsy-group-enable-toggle")).toBeTruthy();
        expect(actions.contains(muteWrap)).toBe(false);
        expect(muteWrap.contains(actions)).toBe(false);
        // Comes before the (hover-hidden) actions wrapper in the header.
        expect(Boolean(muteWrap.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(
            true,
        );
    });

    it("selection mode adds a select-all checkbox at the header's left edge, before the chevron", () => {
        mount({ "work/a": "1", "work/b": "2" });
        enterSelectionMode();
        const header = groupHeaderFor("Work");
        const cb = header.querySelector(".group-select-all") as HTMLInputElement;
        const chevron = header.querySelector(".group-toggle") as HTMLElement;
        expect(cb).toBeTruthy();
        expect(cb.getAttribute("aria-label")).toBe("Select all in group Work");
        expect(Boolean(cb.compareDocumentPosition(chevron) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(
            true,
        );
    });

    it("select-all is unchecked with none selected, checked with all selected, indeterminate with some", () => {
        mount({ "work/a": "1", "work/b": "2" });
        expandGroup("Work");
        enterSelectionMode();

        let cb = groupHeaderFor("Work").querySelector(".group-select-all") as HTMLInputElement;
        expect(cb.checked).toBe(false);
        expect(cb.indeterminate).toBe(false);

        const rowCb = findRow("a")!.querySelector('input[type="checkbox"]') as HTMLInputElement;
        rowCb.checked = true;
        rowCb.dispatchEvent(new Event("change"));

        cb = groupHeaderFor("Work").querySelector(".group-select-all") as HTMLInputElement;
        expect(cb.checked).toBe(false);
        expect(cb.indeterminate).toBe(true);
    });

    it("checking select-all selects every row in the group (and only that group); unchecking clears them", () => {
        mount({ "work/a": "1", "work/b": "2", "other/c": "3" });
        expandGroup("Work");
        expandGroup("Other");
        enterSelectionMode();

        let cb = groupHeaderFor("Work").querySelector(".group-select-all") as HTMLInputElement;
        cb.checked = true;
        cb.dispatchEvent(new Event("change"));

        cb = groupHeaderFor("Work").querySelector(".group-select-all") as HTMLInputElement;
        expect(cb.checked).toBe(true);
        expect(cb.indeterminate).toBe(false);
        expect(
            (findRow("a")!.querySelector('input[type="checkbox"]') as HTMLInputElement).checked,
        ).toBe(true);
        expect(
            (findRow("b")!.querySelector('input[type="checkbox"]') as HTMLInputElement).checked,
        ).toBe(true);
        // The other group's row is untouched.
        expect(
            (findRow("c")!.querySelector('input[type="checkbox"]') as HTMLInputElement).checked,
        ).toBe(false);

        cb = groupHeaderFor("Work").querySelector(".group-select-all") as HTMLInputElement;
        cb.checked = false;
        cb.dispatchEvent(new Event("change"));
        expect(
            (findRow("a")!.querySelector('input[type="checkbox"]') as HTMLInputElement).checked,
        ).toBe(false);
    });

    it("clicking select-all does not also collapse/expand the group (stops propagation to the header)", () => {
        mount({ "work/a": "1", "work/b": "2" });
        expandGroup("Work");
        enterSelectionMode();

        const groupEl = groupHeaderFor("Work").closest(".snippet-group") as HTMLElement;
        expect(groupEl.querySelector(".group-content")).toBeTruthy();

        const cb = groupHeaderFor("Work").querySelector(".group-select-all") as HTMLInputElement;
        cb.dispatchEvent(new Event("click", { bubbles: true }));

        // Still open — the header's own click-to-toggle listener never
        // fired from the checkbox's bubbled click.
        expect(groupHeaderFor("Work").closest(".snippet-group")?.querySelector(".group-content")).toBeTruthy();
    });
});
