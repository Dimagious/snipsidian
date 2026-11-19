import type { JsonPatternPlan } from "../../core/json-backup";
import { sanitizeForNotice } from "../../shared/notice-text";
import { PREVIEW_ROW_LIMIT } from "./community/EspansoPatternPreview";

const MODE_NAME = { instant: "Instant", separator: "After a separator" } as const;

/** One sentence: the reason as given, with a closing period when it has none. */
function sentence(reason: string): string {
    const text = sanitizeForNotice(reason, 200);
    return /[.!?]$/.test(text) ? text : `${text}.`;
}

/**
 * ADR-0008, JSON backup: the pattern rules of an import file, as their own section of the import preview. Every
 * string comes out of the file, so it is set as text, stripped of control characters and cut short. The rows are the
 * rules that will be stored for the chosen mode; the skipped list names each rule left out, with the page's sentence.
 * Nothing is rendered when the file holds no rules and the plan has nothing to say.
 */
export function renderJsonPatternPreview(parent: HTMLElement, plan: JsonPatternPlan, mode: "merge" | "replace"): HTMLElement | null {
    if (plan.rows.length === 0 && plan.skipped.length === 0 && plan.unchanged === 0 && plan.removed === 0) return null;

    const section = parent.createDiv({ cls: "snipsy-espanso-patterns snipsy-import-patterns" });
    section.createEl("h3", { text: "Pattern rules" });
    const count = plan.rows.length;
    const rules = (n: number): string => `${n} rule${n === 1 ? "" : "s"}`;
    if (mode === "replace") {
        const removed = plan.removed > 0 ? ` The ${rules(plan.removed)} you have now will be deleted.` : "";
        section.createEl("p", { text: `${rules(count)} will replace the Patterns list.${removed}` });
    } else {
        const same = plan.unchanged > 0 ? ` ${plan.unchanged} already there.` : "";
        section.createEl("p", { text: `${rules(count)} will be added to the end of the Patterns list.${same}` });
    }
    if (count > 0) {
        const list = section.createEl("ul", { cls: "snipsy-espanso-pattern-rows" });
        for (const row of plan.rows.slice(0, PREVIEW_ROW_LIMIT)) {
            const item = list.createEl("li");
            item.createEl("code", { text: sanitizeForNotice(row.source, 220) });
            item.appendText(` → ${sanitizeForNotice(row.replacement, 80)} `);
            item.createEl("small", { text: `(${MODE_NAME[row.mode]})` });
        }
        if (count > PREVIEW_ROW_LIMIT) list.createEl("li", { text: `and ${count - PREVIEW_ROW_LIMIT} more` });
    }
    if (plan.skipped.length > 0) {
        section.createEl("p", { text: `${rules(plan.skipped.length)} left out:` });
        const list = section.createEl("ul", { cls: "snipsy-espanso-pattern-skips" });
        for (const s of plan.skipped.slice(0, PREVIEW_ROW_LIMIT)) {
            const item = list.createEl("li");
            item.createEl("code", { text: sanitizeForNotice(s.label, 120) });
            item.appendText(` Skipped: ${sentence(s.reason)}`);
        }
        if (plan.skipped.length > PREVIEW_ROW_LIMIT) list.createEl("li", { text: `and ${plan.skipped.length - PREVIEW_ROW_LIMIT} more` });
    }
    return section;
}
