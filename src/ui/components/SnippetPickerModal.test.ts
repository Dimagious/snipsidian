// @vitest-environment jsdom

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { installObsidianDomHelpers } from "../../test/dom-polyfill";
import { SnippetPickerService } from "../../core/snippet-picker";
import { makeMockApp, makeMockEditor } from "../../test/factories/plugin";
import { makeSnippet, makeSnippetCollection } from "../../test/factories/snippet";
import { SnippetPickerModal } from "./SnippetPickerModal";
import type { App } from "obsidian";
import type { SnippetItem } from "../../types";

/**
 * Mount tests for SnippetPickerModal — covers the surface that
 * shipped in 1.1.1 (B-040 UX cluster + A-006 WAI-ARIA combobox).
 *
 * What's pinned:
 *   - Title flips Insert ↔ Wrap selection based on initial selection
 *     (U-002 contract — surfaces "wrap" framing for selection users)
 *   - Result count badge shows up only when truncation happened
 *     (U-003 contract — exact-limit boundary stays silent)
 *   - WAI-ARIA combobox/listbox/option attributes are wired (A-006)
 *   - aria-activedescendant tracks the selected row as the user navigates
 *   - Single-click-handler-per-row (U-006 double-click race fix)
 *   - "Group" label replaced "Folder" everywhere (U-004)
 *
 * What's NOT here:
 *   - Snippet insertion into the editor: that's the adapter's
 *     responsibility, already covered by adapter unit tests and
 *     the integration suite. Mocking out `getActiveViewOfType` and
 *     re-testing the adapter would be double-coverage.
 *   - Picker search algorithm: covered in core/snippet-picker.test.ts.
 */

beforeAll(() => {
    installObsidianDomHelpers();
});

let app: App;
beforeEach(() => {
    document.body.innerHTML = "";
});

function mount(opts: {
    snippets: SnippetItem[];
    selection?: string;
}) {
    const editor = opts.selection !== undefined
        ? makeMockEditor({ text: "hello world", selection: opts.selection })
        : makeMockEditor({ text: "hello world" });
    app = makeMockApp({ activeEditor: editor }) as unknown as App;
    const api = new SnippetPickerService(opts.snippets);
    const modal = new SnippetPickerModal(app, api);
    modal.open();
    return { modal, api, editor };
}

describe("SnippetPickerModal — title differentiates Insert vs Wrap (U-002)", () => {
    it("renders 'Insert snippet' when there is no editor selection", () => {
        const { modal } = mount({
            snippets: [makeSnippet({ trigger: ":hi", replacement: "hello" })],
        });
        expect(modal.titleEl.textContent).toBe("Insert snippet");
    });

    it("renders 'Wrap selection' when the active editor has a selection", () => {
        const { modal } = mount({
            snippets: [makeSnippet({ trigger: ":hi", replacement: "hello" })],
            selection: "selected text",
        });
        expect(modal.titleEl.textContent).toBe("Wrap selection");
    });
});

describe("SnippetPickerModal — WAI-ARIA combobox/listbox pattern (A-006)", () => {
    it("wires role=combobox on the search input with aria-controls and aria-expanded", () => {
        const { modal } = mount({
            snippets: [makeSnippet({ trigger: ":hi", replacement: "hello" })],
        });
        const input = modal.contentEl.querySelector(
            "input[role=\"combobox\"]",
        ) as HTMLInputElement;
        expect(input).not.toBeNull();
        expect(input.getAttribute("aria-expanded")).toBe("true");
        expect(input.getAttribute("aria-autocomplete")).toBe("list");
        const listboxId = input.getAttribute("aria-controls");
        expect(listboxId).toBeTruthy();
        const listbox = modal.contentEl.querySelector(`#${listboxId}`);
        expect(listbox?.getAttribute("role")).toBe("listbox");
    });

    it("renders each row with role=option and tracks aria-selected on the active row", () => {
        const { modal } = mount({
            snippets: [
                makeSnippet({ trigger: ":one", replacement: "1" }),
                makeSnippet({ trigger: ":two", replacement: "2" }),
                makeSnippet({ trigger: ":three", replacement: "3" }),
            ],
        });
        const rows = modal.contentEl.querySelectorAll(".snippet-item");
        expect(rows.length).toBe(3);
        rows.forEach((row) => {
            expect(row.getAttribute("role")).toBe("option");
        });
        // First row is selected by default.
        expect(rows[0].getAttribute("aria-selected")).toBe("true");
        expect(rows[1].getAttribute("aria-selected")).toBe("false");
    });

    it("points aria-activedescendant at the currently selected row", () => {
        const { modal } = mount({
            snippets: [
                makeSnippet({ trigger: ":one", replacement: "1" }),
                makeSnippet({ trigger: ":two", replacement: "2" }),
            ],
        });
        const input = modal.contentEl.querySelector(
            "input[role=\"combobox\"]",
        ) as HTMLInputElement;
        const initialActive = input.getAttribute("aria-activedescendant");
        expect(initialActive).toBeTruthy();
        const initialRow = modal.contentEl.querySelector(`#${initialActive}`);
        expect(initialRow?.getAttribute("aria-selected")).toBe("true");

        // ArrowDown advances activedescendant to the next row.
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
        const nextActive = input.getAttribute("aria-activedescendant");
        expect(nextActive).not.toBe(initialActive);
        expect(modal.contentEl.querySelector(`#${nextActive}`)?.getAttribute("aria-selected"))
            .toBe("true");
    });

    it("supports Home / End keys to jump first / last (per A-006 keyboard nav)", () => {
        const { modal } = mount({
            snippets: makeSnippetCollection(5),
        });
        const input = modal.contentEl.querySelector(
            "input[role=\"combobox\"]",
        ) as HTMLInputElement;
        const rows = modal.contentEl.querySelectorAll(".snippet-item");

        input.dispatchEvent(new KeyboardEvent("keydown", { key: "End" }));
        expect(rows[rows.length - 1].getAttribute("aria-selected")).toBe("true");

        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Home" }));
        expect(rows[0].getAttribute("aria-selected")).toBe("true");
    });
});

describe("SnippetPickerModal — result count badge (U-003)", () => {
    it("hides the badge when the result count is below the limit", () => {
        const { modal } = mount({
            snippets: makeSnippetCollection(5),
        });
        const badge = modal.contentEl.querySelector(".snipsy-picker-count");
        expect(badge?.classList.contains("is-hidden")).toBe(true);
    });

    it("shows 'Showing 100 of N' when more matches exist than fit", () => {
        const { modal } = mount({
            snippets: makeSnippetCollection(150),
        });
        const badge = modal.contentEl.querySelector(".snipsy-picker-count");
        expect(badge?.classList.contains("is-hidden")).toBe(false);
        expect(badge?.textContent).toBe("Showing 100 of 150");
    });

    it("hides the badge again at the exact-limit boundary (no 'Showing 100 of 100' noise)", () => {
        // The boundary the picker explicitly silences: when the
        // limit equals the match count, "Showing N of N" would
        // surface as anxiety-inducing noise. Pin the silence so a
        // future refactor (e.g. `>=` instead of `>`) gets caught.
        const { modal } = mount({
            snippets: makeSnippetCollection(100),
        });
        const badge = modal.contentEl.querySelector(".snipsy-picker-count");
        expect(badge?.classList.contains("is-hidden")).toBe(true);
    });
});

describe("SnippetPickerModal — naming + microcopy (U-004 / U-005)", () => {
    it("labels the group meta as 'Group:' in the preview (not 'Folder:')", () => {
        // U-004 fix: "Folder" was inconsistent with every other
        // surface in the plugin where the concept is called Group.
        // Pin the lexicon so it doesn't drift.
        const { modal } = mount({
            snippets: [makeSnippet({
                trigger: ":hi",
                replacement: "hello",
                folder: "greetings",
            })],
        });
        const meta = modal.contentEl.querySelector(".snippet-preview-meta");
        expect(meta?.textContent).toContain("Group:");
        expect(meta?.textContent).not.toContain("Folder:");
    });

    it("drops the 'directly' filler from the click-to-insert hint (U-005)", () => {
        // The old hint read 'Click any snippet to insert it
        // **directly**'. The qualifier was filler; every click is
        // direct. Pin the new wording so it can't regress.
        const { modal } = mount({
            snippets: [makeSnippet({ trigger: ":hi", replacement: "hello" })],
        });
        const hints = modal.contentEl.querySelector(".snippet-hints");
        expect(hints?.textContent).not.toContain("directly");
        expect(hints?.textContent).toContain("Click");
        expect(hints?.textContent).toContain("any snippet to insert");
    });
});

describe("SnippetPickerModal — search filters live", () => {
    it("re-renders the results list when the user types (after the debounce)", async () => {
        const { modal } = mount({
            snippets: [
                makeSnippet({ trigger: ":hello", replacement: "Hi" }),
                makeSnippet({ trigger: ":bye", replacement: "Cya" }),
            ],
        });
        expect(modal.contentEl.querySelectorAll(".snippet-item").length).toBe(2);

        const input = modal.contentEl.querySelector(
            "input[role=\"combobox\"]",
        ) as HTMLInputElement;
        input.value = "hello";
        input.dispatchEvent(new Event("input"));

        // 200ms debounce — wait it out.
        await new Promise((r) => setTimeout(r, 250));

        const rows = modal.contentEl.querySelectorAll(".snippet-item");
        expect(rows.length).toBe(1);
        expect(rows[0].textContent).toContain(":hello");
    });

    it("renders an empty state when the query matches nothing", async () => {
        const { modal } = mount({
            snippets: [makeSnippet({ trigger: ":hello", replacement: "Hi" })],
        });
        const input = modal.contentEl.querySelector(
            "input[role=\"combobox\"]",
        ) as HTMLInputElement;
        input.value = "no-such-trigger";
        input.dispatchEvent(new Event("input"));
        await new Promise((r) => setTimeout(r, 250));

        expect(modal.contentEl.querySelector(".empty-state")).not.toBeNull();
        expect(modal.contentEl.querySelectorAll(".snippet-item").length).toBe(0);
    });
});
