// @vitest-environment jsdom

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { installObsidianDomHelpers } from "../../test/dom-polyfill";
import { makeMockPlugin } from "../../test/factories/plugin";
import { PackagePreviewModal } from "./Modals";
import type { DiffResult } from "../../store/diff";
import type SnipSidianPlugin from "../../../main";

/**
 * Mount tests for PackagePreviewModal — the conflict-resolution UI
 * that the install / Reinstall flow opens after `buildPackageDiff`.
 *
 * Pins the bulk-action contract that used to break visibly in
 * production (PR #40, post-1.1.5): clicking "Keep all current" or
 * "Overwrite all" was implemented as `close(); open();`, which in
 * the real Obsidian Modal lifecycle re-runs `onOpen` without first
 * emptying `contentEl` — every bulk click appended a duplicate
 * summary + conflicts table + footer.
 *
 * The fix mutates each conflict's `<select>` element in place
 * (no close+open). These tests pin the new behaviour.
 */

beforeAll(() => {
    installObsidianDomHelpers();
});

let plugin: ReturnType<typeof makeMockPlugin>;
beforeEach(() => {
    document.body.innerHTML = "";
    plugin = makeMockPlugin();
});

function mount(diff: DiffResult): PackagePreviewModal {
    const modal = new PackagePreviewModal(
        plugin.app,
        plugin as unknown as SnipSidianPlugin,
        "Markdown Essentials",
        diff,
    );
    modal.open();
    return modal;
}

function makeDiff(conflictCount: number, added = 0): DiffResult {
    return {
        added: Array.from({ length: added }, (_, i) => ({
            key: `Pack/new${i}`,
            value: `v${i}`,
        })),
        conflicts: Array.from({ length: conflictCount }, (_, i) => ({
            key: `Pack/c${i}`,
            current: `local-${i}`,
            incoming: `upstream-${i}`,
        })),
    };
}

describe("PackagePreviewModal — bulk actions update selects in place", () => {
    it("'Overwrite all' sets every <select>.value to 'overwrite' without re-rendering", () => {
        const modal = mount(makeDiff(3));

        const summariesBefore =
            modal.contentEl.querySelectorAll(".modal-button-container").length;
        const selectsBefore = modal.contentEl.querySelectorAll(
            ".conflict-action select",
        );
        expect(selectsBefore.length).toBe(3);
        // Initial state: all default to "keep"
        for (const s of selectsBefore) {
            expect((s as HTMLSelectElement).value).toBe("keep");
        }

        const overwriteAll = Array.from(
            modal.contentEl.querySelectorAll<HTMLButtonElement>(
                ".snipsidian-bulk-actions button",
            ),
        ).find((b) => b.textContent === "Overwrite all");
        if (!overwriteAll) throw new Error("'Overwrite all' button not found");
        overwriteAll.click();

        // Selects updated to "overwrite"
        const selectsAfter = modal.contentEl.querySelectorAll(
            ".conflict-action select",
        );
        for (const s of selectsAfter) {
            expect((s as HTMLSelectElement).value).toBe("overwrite");
        }

        // No DOM duplication: still exactly one footer (the regression
        // against the close()+open() bug — that path appended a second
        // footer / table / summary line on every bulk click).
        const summariesAfter =
            modal.contentEl.querySelectorAll(".modal-button-container").length;
        expect(summariesAfter).toBe(summariesBefore);
        expect(summariesAfter).toBe(1);

        // Still exactly one conflicts table.
        expect(
            modal.contentEl.querySelectorAll(".snipsidian-preview-table").length,
        ).toBe(1);
    });

    it("'Keep all current' sets every <select>.value to 'keep' without re-rendering", () => {
        const modal = mount(makeDiff(2));

        // Flip one to overwrite manually so the "keep all" action has
        // something to undo.
        const selects = modal.contentEl.querySelectorAll<HTMLSelectElement>(
            ".conflict-action select",
        );
        selects[0].value = "overwrite";
        selects[0].dispatchEvent(new Event("change"));
        expect(selects[0].value).toBe("overwrite");

        const keepAll = Array.from(
            modal.contentEl.querySelectorAll<HTMLButtonElement>(
                ".snipsidian-bulk-actions button",
            ),
        ).find((b) => b.textContent === "Keep all current");
        if (!keepAll) throw new Error("'Keep all current' button not found");
        keepAll.click();

        const selectsAfter = modal.contentEl.querySelectorAll<HTMLSelectElement>(
            ".conflict-action select",
        );
        for (const s of selectsAfter) {
            expect(s.value).toBe("keep");
        }
        // No DOM duplication.
        expect(
            modal.contentEl.querySelectorAll(".modal-button-container").length,
        ).toBe(1);
    });

    it("repeated bulk clicks do NOT accumulate DOM (regression for close+open bug)", () => {
        const modal = mount(makeDiff(2));

        const overwriteAll = Array.from(
            modal.contentEl.querySelectorAll<HTMLButtonElement>(
                ".snipsidian-bulk-actions button",
            ),
        ).find((b) => b.textContent === "Overwrite all")!;
        const keepAll = Array.from(
            modal.contentEl.querySelectorAll<HTMLButtonElement>(
                ".snipsidian-bulk-actions button",
            ),
        ).find((b) => b.textContent === "Keep all current")!;

        // Click bulk actions several times.
        overwriteAll.click();
        keepAll.click();
        overwriteAll.click();
        keepAll.click();

        // Tables, button bars, and footers should all still be singleton.
        expect(
            modal.contentEl.querySelectorAll(".snipsidian-preview-table").length,
        ).toBe(1);
        expect(
            modal.contentEl.querySelectorAll(".snipsidian-bulk-actions").length,
        ).toBe(1);
        expect(
            modal.contentEl.querySelectorAll(".modal-button-container").length,
        ).toBe(1);
        // Final state: all "keep" (last click was Keep all).
        for (const s of modal.contentEl.querySelectorAll<HTMLSelectElement>(
            ".conflict-action select",
        )) {
            expect(s.value).toBe("keep");
        }
    });
});
