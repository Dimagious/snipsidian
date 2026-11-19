import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { makeMockApp } from "../../test/factories/plugin";
import { ImportPreviewModal } from "./Modals";
import type { App } from "obsidian";
import { planJsonPatternImport } from "../../core/json-backup";
import type { PatternRule } from "../../engine/types";

/**
 * Mount tests for ImportPreviewModal — the user-facing fix for B-038
 * (silent JSON import wiping the library).
 *
 * The modal's contract is small but load-bearing:
 *   1. Open the modal with `current` + `incoming` + `onConfirm`
 *   2. User picks merge (safe) or replace (destructive)
 *   3. On Apply, `onConfirm(mode)` fires with the chosen mode
 *   4. Caller does the merge / replace math, modal stays out of data
 *
 * If the picker UI desyncs from the call to `onConfirm`, the user
 * sees "merge" but the import does "replace" (or vice versa) — a
 * destructive bug. These tests pin the contract.
 *
 * What's intentionally NOT tested here:
 *   - The pure diff math: covered by `services/import-diff.test.ts`
 *     (10 boundary tests). Don't double-cover.
 *   - The notice strings the caller emits after onConfirm: that's
 *     caller-side concern (BasicTab.startImport).
 */

let app: App;
beforeEach(() => {
    document.body.innerHTML = "";
    app = makeMockApp() as unknown as App;
});

type ImportConfirm = (mode: "replace" | "merge") => void;
type ConfirmMock = Mock<ImportConfirm>;

function mount(opts: {
    current?: Record<string, string>;
    incoming: Record<string, string>;
    onConfirm?: ConfirmMock;
}): { modal: ImportPreviewModal; onConfirm: ConfirmMock } {
    const onConfirm = opts.onConfirm ?? vi.fn<ImportConfirm>();
    const modal = new ImportPreviewModal(app, {
        current: opts.current ?? {},
        incoming: opts.incoming,
        onConfirm,
    });
    modal.open();
    return { modal, onConfirm };
}

/** Click the modal's Apply button. The Apply label changes between
 *  "Apply merge (N)" and "Replace all (N)" depending on mode, so we
 *  match by class rather than label text. */
function clickApply(modal: ImportPreviewModal): void {
    const apply = modal.contentEl
        .querySelector<HTMLButtonElement>(".modal-button-container .mod-cta");
    if (!apply) throw new Error("Apply button not found in modal");
    apply.click();
}

function pickMode(modal: ImportPreviewModal, value: "merge" | "replace"): void {
    const radio = modal.contentEl.querySelector<HTMLInputElement>(`input[name="snipsy-import-mode"][value="${value}"]`);
    if (!radio) throw new Error(`mode radio "${value}" not found`);
    radio.checked = true;
    radio.dispatchEvent(new Event("change"));
}

describe("ImportPreviewModal — Apply forwards the chosen mode", () => {
    it("calls onConfirm('merge') by default (safe pick)", () => {
        const { modal, onConfirm } = mount({
            current: { a: "1" },
            incoming: { b: "2" },
        });
        clickApply(modal);
        expect(onConfirm).toHaveBeenCalledTimes(1);
        expect(onConfirm).toHaveBeenCalledWith("merge");
    });

    it("calls onConfirm('replace') after the user switches to replace mode", () => {
        const { modal, onConfirm } = mount({
            current: { a: "1" },
            incoming: { b: "2" },
        });
        pickMode(modal, "replace");
        clickApply(modal);
        expect(onConfirm).toHaveBeenCalledWith("replace");
    });

    it("does NOT call onConfirm when the user clicks Cancel", () => {
        const { modal, onConfirm } = mount({
            current: { a: "1" },
            incoming: { b: "2" },
        });
        const cancel = modal.contentEl
            .querySelector(".modal-button-container button:not(.mod-cta)") as HTMLButtonElement;
        cancel.click();
        expect(onConfirm).not.toHaveBeenCalled();
    });
});

describe("ImportPreviewModal — diff list reflects the mode", () => {
    it("does NOT render `removed` rows in merge mode", () => {
        // current has 2 keys; incoming overlaps only on `a`. The `b`
        // key only in `current` would be DELETED on replace but
        // KEPT on merge. Merge mode must not show it as a removal
        // — otherwise the user would think clicking Apply is going
        // to delete it.
        const { modal } = mount({
            current: { a: "1", b: "2" },
            incoming: { a: "1-new" },
        });
        const removeRows = modal.contentEl.querySelectorAll(
            ".snipsy-import-tag-remove",
        );
        expect(removeRows.length).toBe(0);
    });

    it("renders `removed` rows in replace mode (the destructive affordance)", () => {
        // Per designer Q5: the removed list is itself the warning
        // for replace mode. No second-confirm dialog. If this list
        // doesn't populate, users can't see what they're about to
        // delete — silent data loss.
        const { modal } = mount({
            current: { a: "1", b: "2" },
            incoming: { a: "1-new" },
        });
        pickMode(modal, "replace");
        const removeRows = modal.contentEl.querySelectorAll(
            ".snipsy-import-tag-remove",
        );
        expect(removeRows.length).toBe(1);
        // The remove row's neighbor cell should contain the
        // disappearing key.
        const row = removeRows[0]?.parentElement;
        expect(row?.textContent).toContain("b");
    });

    it("renders `added` rows in both modes (always present)", () => {
        const { modal } = mount({
            current: { a: "1" },
            incoming: { a: "1", new1: "x", new2: "y" },
        });
        let addRows = modal.contentEl.querySelectorAll(
            ".snipsy-import-tag-new",
        );
        expect(addRows.length).toBe(2);
        pickMode(modal, "replace");
        addRows = modal.contentEl.querySelectorAll(".snipsy-import-tag-new");
        expect(addRows.length).toBe(2);
    });

    it("renders `update` rows for keys whose value changed", () => {
        const { modal } = mount({
            current: { a: "old" },
            incoming: { a: "new" },
        });
        const updateRows = modal.contentEl.querySelectorAll(
            ".snipsy-import-tag-update",
        );
        expect(updateRows.length).toBe(1);
    });
});

describe("ImportPreviewModal — Apply button label", () => {
    it("reads `Apply merge (N)` in merge mode where N is added+updated count", () => {
        const { modal } = mount({
            current: { unchanged: "x", existing: "old" },
            incoming: { unchanged: "x", existing: "new", brand: "new" },
        });
        const apply = modal.contentEl.querySelector(
            ".modal-button-container .mod-cta",
        ) as HTMLButtonElement;
        // 1 added + 1 conflict = 2 changes.
        expect(apply.textContent).toBe("Apply merge (2)");
    });

    it("reads `Replace all (N)` and gains `.mod-warning` class after switching", () => {
        const { modal } = mount({
            current: { x: "y" },
            incoming: { a: "1", b: "2", c: "3" },
        });
        pickMode(modal, "replace");
        const apply = modal.contentEl.querySelector(
            ".modal-button-container .mod-cta",
        ) as HTMLButtonElement;
        // Replace label counts ALL incoming entries (the post-replace size).
        expect(apply.textContent).toBe("Replace all (3)");
        expect(apply.classList.contains("mod-warning")).toBe(true);
    });

    it("drops `.mod-warning` when switching back from replace to merge", () => {
        const { modal } = mount({
            current: { x: "y" },
            incoming: { a: "1" },
        });
        pickMode(modal, "replace");
        pickMode(modal, "merge");
        const apply = modal.contentEl.querySelector(
            ".modal-button-container .mod-cta",
        ) as HTMLButtonElement;
        expect(apply.classList.contains("mod-warning")).toBe(false);
    });
});

describe("ImportPreviewModal — summary line", () => {
    it("shows 'Nothing will change.' for an empty import against an empty library", () => {
        // The "nothing" message only fires when EVERY diff bucket is
        // empty: no added, no conflicts, no unchanged, no removed
        // (replace mode only). With even a single unchanged entry,
        // the summary surfaces "1 unchanged" instead — which is
        // arguably the more useful signal, but pin both behaviours
        // explicitly so a refactor can't silently drop the empty
        // message.
        const { modal } = mount({ current: {}, incoming: {} });
        const summary = modal.contentEl.querySelector(".snipsy-import-summary");
        expect(summary?.textContent).toBe("Nothing will change.");
    });

    it("surfaces unchanged count when current === incoming (non-empty)", () => {
        // Sibling assertion to the empty-case: when current is an
        // exact match of incoming, the user should still see
        // "N unchanged" so they understand the import didn't fail
        // silently.
        const { modal } = mount({
            current: { a: "1", b: "2" },
            incoming: { a: "1", b: "2" },
        });
        const summary = modal.contentEl.querySelector(".snipsy-import-summary");
        expect(summary?.textContent).toBe("2 unchanged");
    });

    it("includes 'N removed' only in replace mode", () => {
        const { modal } = mount({
            current: { a: "1", b: "2" },
            incoming: { a: "1" },
        });
        let summary = modal.contentEl.querySelector(".snipsy-import-summary");
        expect(summary?.textContent ?? "").not.toContain("removed");
        pickMode(modal, "replace");
        summary = modal.contentEl.querySelector(".snipsy-import-summary");
        expect(summary?.textContent ?? "").toContain("1 removed");
    });
});

describe("ImportPreviewModal — truncation", () => {
    it("renders `…and N more` for very long diffs (>50 rows)", () => {
        // 60 added rows. Modal caps the rendered list at 50 to keep
        // it scannable; the rest are summarised by a single line.
        const incoming: Record<string, string> = {};
        for (let i = 0; i < 60; i++) incoming[`new${i}`] = `v${i}`;
        const { modal } = mount({ current: {}, incoming });
        const more = modal.contentEl.querySelector(".snipsy-import-more");
        expect(more).not.toBeNull();
        expect(more?.textContent).toBe("…and 10 more");
    });
});

describe("ImportPreviewModal: rejected keys (B-177)", () => {
    const incoming = { "-": "bullet", "a$b": "x", ok: "fine" };

    it("lists each rejected key with its reason in merge mode", () => {
        const { modal } = mount({ incoming });
        const rows = modal.contentEl.querySelectorAll(".snipsy-import-rejected .snipsy-import-row");
        expect(rows.length).toBe(2);
        const text = modal.contentEl.querySelector(".snipsy-import-rejected")?.textContent ?? "";
        expect(text).toContain("-");
        expect(text).toContain("would rewrite Markdown lists");
        expect(text).toContain("a$b");
        expect(text).toContain("characters Snipsy can't use");
    });

    it("keeps listing them in replace mode and counts only writable keys on the button", () => {
        const { modal } = mount({ incoming });
        pickMode(modal, "replace");
        expect(modal.contentEl.querySelectorAll(".snipsy-import-rejected .snipsy-import-row").length).toBe(2);
        const apply = modal.contentEl.querySelector(".modal-button-container .mod-cta");
        expect(apply?.textContent).toBe("Replace all (1)");
    });

    it("does not render a rejected section when every key is valid", () => {
        const { modal } = mount({ incoming: { ok: "fine" } });
        expect(modal.contentEl.querySelector(".snipsy-import-rejected")).toBeNull();
    });
});

describe("ImportPreviewModal: pattern rules of a JSON backup", () => {
    const rule = (n: number): PatternRule => ({ id: `r${n}`, source: `/x${n}$/`, replacement: `y${n}`, enabled: true, mode: "instant" });

    function mountWithRules(incoming: unknown[], existing: PatternRule[] = []): { modal: ImportPreviewModal; onConfirm: ConfirmMock } {
        const onConfirm = vi.fn<ImportConfirm>();
        const modal = new ImportPreviewModal(app, {
            current: { a: "1" },
            incoming: { a: "1" },
            patterns: { plan: (mode) => planJsonPatternImport(incoming, mode, { patterns: existing }) },
            onConfirm,
        });
        modal.open();
        return { modal, onConfirm };
    }
    const section = (modal: ImportPreviewModal): HTMLElement | null => modal.contentEl.querySelector(".snipsy-import-patterns");
    const hint = (modal: ImportPreviewModal): string | undefined =>
        modal.contentEl.querySelector(".snipsy-import-mode-hint-danger")?.textContent ?? undefined;
    const applyLabel = (modal: ImportPreviewModal): string | undefined =>
        modal.contentEl.querySelector(".modal-button-container .mod-cta")?.textContent ?? undefined;

    it("lists the rules that will be added (Merge) with the existing ones counted as already there", () => {
        const { modal } = mountWithRules([rule(1), rule(2)], [rule(1)]);
        const el = section(modal);
        expect(el?.querySelector("h3")?.textContent).toBe("Pattern rules");
        expect(el?.querySelector("p")?.textContent).toBe("1 rule will be added to the end of the Patterns list. 1 already there.");
        expect(el?.querySelectorAll(".snipsy-espanso-pattern-rows li")).toHaveLength(1);
        expect(el?.querySelector(".snipsy-espanso-pattern-rows code")?.textContent).toBe("/x2$/");
        expect(applyLabel(modal)).toBe("Apply merge (1)");
    });

    it("re-plans when the mode flips: Replace names what it deletes, in the hint, the section and the button", () => {
        const { modal } = mountWithRules([rule(5)], [rule(1), rule(2)]);
        expect(hint(modal)).toBe("Delete 2 pattern rules, then import.");
        pickMode(modal, "replace");
        expect(section(modal)?.querySelector("p")?.textContent).toBe("1 rule will replace the Patterns list. The 2 rules you have now will be deleted.");
        expect(section(modal)?.querySelector(".snipsy-espanso-pattern-rows code")?.textContent).toBe("/x5$/");
        expect(applyLabel(modal)).toBe("Replace all (2)");
        pickMode(modal, "merge");
        expect(section(modal)?.querySelector("p")?.textContent).toContain("will be added to the end");
    });

    it("names a rule left out with its reason", () => {
        const { modal } = mountWithRules([rule(1), { ...rule(2), source: "/(a+)+$/" }]);
        const skips = section(modal)?.querySelector(".snipsy-espanso-pattern-skips");
        expect(skips?.textContent).toContain("/(a+)+$/ Skipped: A repeated group can't hold a repeat or a choice");
        expect(section(modal)?.textContent).toContain("1 rule left out:");
    });

    it("shows at most 50 rows and counts the rest; text from the file is never HTML", () => {
        const many = Array.from({ length: 100 }, (_, i) => ({ ...rule(i), replacement: "<b>x</b>" }));
        const { modal } = mountWithRules(many);
        const rows = section(modal)?.querySelectorAll(".snipsy-espanso-pattern-rows li") ?? [];
        expect(rows).toHaveLength(51);
        expect(rows[50]?.textContent).toBe("and 50 more");
        expect(section(modal)?.querySelector("b")).toBeNull();
    });

    it("a file without rules shows no pattern section and the old Replace hint", () => {
        const { modal } = mount({ current: { a: "1", b: "2" }, incoming: { a: "1" } });
        expect(section(modal)).toBeNull();
        expect(hint(modal)).toBe("Delete 1 existing snippet, then import.");
    });

    it("with rules in the file the Replace hint names both when nothing is deleted", () => {
        const { modal } = mountWithRules([rule(1)]);
        expect(hint(modal)).toBe("Replace existing snippets and pattern rules with the import.");
    });
});
