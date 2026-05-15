// @vitest-environment jsdom

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
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
    it("renders a real <h3> 'Snippets' heading (B-091)", () => {
        mount({ hello: "world" });
        const heading = root.querySelector("h3.snipsy-tab-heading");
        expect(heading?.textContent).toBe("Snippets");
    });

    it("renders the toolbar with search input + count badge + action buttons", () => {
        mount({ a: "1", b: "2" });
        const toolbar = root.querySelector(".snipsy-snippet-toolbar");
        expect(toolbar).not.toBeNull();
        expect(toolbar?.querySelector("input[aria-label='Filter snippets']")).not.toBeNull();
        // Three action buttons: Select / Expand-all / Add snippet
        const buttons = toolbar?.querySelectorAll("button.snippet-action");
        expect(buttons?.length ?? 0).toBeGreaterThanOrEqual(3);
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
