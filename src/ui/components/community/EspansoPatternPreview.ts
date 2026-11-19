import type { PatternImportPlan } from "../../../core/espanso-pattern-plan";
import type { EspansoSkip } from "../../../packages/espanso";
import { sanitizeForNotice } from "../../../shared/notice-text";

/** Rows shown per list; the rest are counted ("and 40 more"). A hostile file can hold thousands of entries. */
export const PREVIEW_ROW_LIMIT = 50;

const MODE_NAME = { instant: "Instant", separator: "After a separator" } as const;

/** One sentence: the reason as given, with a closing period when it has none. */
function sentence(reason: string): string {
    const text = sanitizeForNotice(reason, 200);
    return /[.!?]$/.test(text) ? text : `${text}.`;
}

/**
 * ADR-0008, Imports: the pattern rules of an Espanso import, as their own section of the preview. Every string here
 * comes out of pasted YAML, so it is set as text (never as HTML), stripped of control characters and cut short.
 *
 * `parserSkips` are the regex matches `espansoYamlToSnippets` refused (the gate, `vars`, forms ...); the plan's own
 * skips (a duplicate, past the cap) come after them. Nothing is rendered when there is nothing to say.
 */
export function renderPatternPreview(
    parent: HTMLElement,
    plan: PatternImportPlan,
    parserSkips: readonly EspansoSkip[],
    groupLabel: string,
    groupOff = false,
): HTMLElement | null {
    const skipped = [
        ...parserSkips.filter((s) => s.kind === "regex").map((s) => ({ label: s.trigger, reason: s.reason })),
        ...plan.skipped,
    ];
    if (plan.rows.length === 0 && skipped.length === 0) return null;

    const section = parent.createDiv({ cls: "snipsy-espanso-patterns" });
    section.createEl("h3", { text: "Pattern rules" });
    if (plan.rows.length > 0) {
        const count = plan.rows.length;
        const group = `in the group "${sanitizeForNotice(groupLabel, 60)}"`;
        // A rule of a group that is off is stored switched on but does not fire until the group is turned on.
        const state = groupOff ? `${group}. That group is switched off, so they will not fire until you turn it on.` : `switched on, ${group}.`;
        section.createEl("p", { text: `${count} rule${count === 1 ? "" : "s"} will be added to the end of the Patterns list, ${state}` });
        const list = section.createEl("ul", { cls: "snipsy-espanso-pattern-rows" });
        for (const row of plan.rows.slice(0, PREVIEW_ROW_LIMIT)) {
            const item = list.createEl("li");
            item.createEl("code", { text: sanitizeForNotice(row.source, 220) });
            item.appendText(` → ${sanitizeForNotice(row.replacement, 80)} `);
            item.createEl("small", { text: `(${MODE_NAME[row.mode]})` });
            if (row.note !== undefined) item.createDiv({ text: sanitizeForNotice(row.note, 240) });
        }
        if (plan.rows.length > PREVIEW_ROW_LIMIT) {
            list.createEl("li", { text: `and ${plan.rows.length - PREVIEW_ROW_LIMIT} more` });
        }
    }
    if (skipped.length > 0) {
        section.createEl("p", { text: `${skipped.length} regex match${skipped.length === 1 ? "" : "es"} left out:` });
        const list = section.createEl("ul", { cls: "snipsy-espanso-pattern-skips" });
        for (const s of skipped.slice(0, PREVIEW_ROW_LIMIT)) {
            const item = list.createEl("li");
            item.createEl("code", { text: sanitizeForNotice(s.label, 120) });
            item.appendText(` Skipped: ${sentence(s.reason)}`);
        }
        if (skipped.length > PREVIEW_ROW_LIMIT) {
            list.createEl("li", { text: `and ${skipped.length - PREVIEW_ROW_LIMIT} more` });
        }
    }
    return section;
}
