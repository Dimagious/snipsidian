const PLACEHOLDERS_DOC_URL = "https://github.com/Dimagious/snipsidian#placeholders";

/** B-195: terse placeholder cheat-line shown under the Replacement field. */
export const PLACEHOLDER_HINT_TEXT =
    "Placeholders: $| cursor · $1 selection or cursor · $date · $time · {{date:FORMAT}} · $filename · {{title}} · {{notedate:FORMAT}} · $clipboard · ";

/**
 * The Patterns page: `$1` is a Tab stop there (a capture is `{{1}}`), and its own hint line says so, so the
 * "selection or cursor" meaning of `$1` is left out.
 */
export const PATTERN_PLACEHOLDER_HINT_TEXT =
    "Placeholders: $| cursor · $date · $time · {{date:FORMAT}} · $filename · {{title}} · {{notedate:FORMAT}} · $clipboard · ";

export function renderPlaceholderHint(parent: HTMLElement, text: string = PLACEHOLDER_HINT_TEXT): HTMLElement {
    const hint = parent.createDiv({ cls: "snipsy-hint snipsidian-placeholder-hint" });
    hint.appendText(text);
    hint.createEl("a", {
        text: "Docs",
        href: PLACEHOLDERS_DOC_URL,
        attr: { target: "_blank", rel: "noopener" },
    });
    return hint;
}
