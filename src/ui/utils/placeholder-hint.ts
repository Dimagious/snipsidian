const PLACEHOLDERS_DOC_URL = "https://github.com/Dimagious/snipsidian#placeholders";

/** B-195: terse placeholder cheat-line shown under the Replacement field. */
export const PLACEHOLDER_HINT_TEXT =
    "Placeholders: $| cursor · $1 selection or cursor · $date · $time · {{date:FORMAT}} · $filename · $clipboard · ";

export function renderPlaceholderHint(parent: HTMLElement): HTMLElement {
    const hint = parent.createDiv({ cls: "snipsy-hint snipsidian-placeholder-hint" });
    hint.appendText(PLACEHOLDER_HINT_TEXT);
    hint.createEl("a", {
        text: "Docs",
        href: PLACEHOLDERS_DOC_URL,
        attr: { target: "_blank", rel: "noopener" },
    });
    return hint;
}
