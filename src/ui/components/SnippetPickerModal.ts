import { Modal, App, MarkdownView, Notice } from "obsidian";
import type { SnippetItem, SnippetSearchQuery } from "../../types";
import type { SnippetPickerAPI } from "../../core/snippet-picker";
import { insertSnippetAtCursor, wrapSelectionWithSnippet } from "../../adapters/obsidian-editor";

/**
 * Snippet picker — command-palette-style modal that lets the user
 * filter and insert (or wrap a selection with) one of their snippets.
 *
 * Implements the WAI-ARIA combobox-with-listbox pattern (A-006):
 *   - search input has `role="combobox"`, `aria-controls`, and
 *     `aria-activedescendant` pointing at the currently selected row
 *   - results container has `role="listbox"`
 *   - each row has `role="option"` and `aria-selected`
 * That's what makes arrow-key navigation announce something useful to
 * screen readers (otherwise SR users just hear "edit, blank" and have
 * no way to discover what's in the list).
 */
export class SnippetPickerModal extends Modal {
    private static readonly LISTBOX_ID = "snipsy-picker-listbox";
    private static readonly OPTION_ID_PREFIX = "snipsy-picker-option-";
    private static readonly DEFAULT_LIMIT = 100;

    private api: SnippetPickerAPI;
    private searchInput!: HTMLInputElement;
    private resultsList!: HTMLDivElement;
    private previewDiv!: HTMLDivElement;
    private resultCountEl!: HTMLSpanElement;
    private selectedIndex: number = 0;
    private searchResults: SnippetItem[] = [];
    private totalMatches: number = 0;
    private searchTimeout: number | null = null;
    private debounceMs: number = 200;
    private isInserting: boolean = false;
    /** Captured at open(): tells us whether the active editor has a
     *  non-empty selection. Drives the title ("Insert" vs "Wrap
     *  selection") so the user sees what's about to happen. */
    private hasInitialSelection: boolean = false;

    constructor(app: App, api: SnippetPickerAPI) {
        super(app);
        this.api = api;
    }

    onOpen(): void {
        const { contentEl, titleEl } = this;
        contentEl.empty();
        contentEl.addClass("snippet-picker-modal");

        // Title differentiates Insert vs Wrap-selection (B-040 / U-002).
        // Using Obsidian's `titleEl` instead of a manual <h2> closes the
        // duplicate-heading half of B-091 — `titleEl` is already a real
        // heading element wired up to the modal's a11y tree.
        this.hasInitialSelection = this.detectInitialSelection();
        titleEl.setText(this.hasInitialSelection ? "Wrap selection" : "Insert snippet");

        // Search field. `role="combobox"` + `aria-controls` is what the
        // screen reader needs to announce the listbox; `aria-expanded`
        // stays "true" because the list is always rendered.
        contentEl.createEl("label", {
            text: "Search snippet",
            attr: { for: "snipsy-picker-search" },
        });
        this.searchInput = contentEl.createEl("input", {
            type: "text",
            placeholder: "Type to search snippets…",
            cls: "search-input",
            attr: {
                id: "snipsy-picker-search",
                role: "combobox",
                autocomplete: "off",
                "aria-controls": SnippetPickerModal.LISTBOX_ID,
                "aria-expanded": "true",
                "aria-autocomplete": "list",
            },
        });

        // Live count for truncated results — "Showing X of Y" only when
        // the limit cuts results, otherwise hidden. Closes B-040 / U-003.
        this.resultCountEl = contentEl.createSpan({
            cls: "snipsy-picker-count is-hidden",
            attr: { "aria-live": "polite" },
        });

        // Results listbox. The picker treats this as the live region
        // for "search returned N rows" announcements (aria-live polite).
        this.resultsList = contentEl.createDiv({
            cls: "snippet-results",
            attr: {
                id: SnippetPickerModal.LISTBOX_ID,
                role: "listbox",
                "aria-label": "Snippet search results",
            },
        });

        // Preview heading is a real <h3>, not an orphan <label>. The
        // legacy `<label>` here was a misuse — it wasn't tied to an
        // input, so SR users heard "edit, blank" with no context.
        contentEl.createEl("h3", { text: "Preview", cls: "preview-label" });
        this.previewDiv = contentEl.createDiv("snippet-preview");

        // Hints. The "directly" in the old hint was redundant fluff
        // (B-040 / U-005) — every click is direct.
        const hints = contentEl.createDiv("snippet-hints");
        hints.createEl("strong", { text: "Navigation:" });
        hints.appendChild(activeDocument.createTextNode(" ↑/↓ to navigate, "));
        hints.createEl("strong", { text: "Enter" });
        hints.appendChild(activeDocument.createTextNode(" to insert, "));
        hints.createEl("strong", { text: "Esc" });
        hints.appendChild(activeDocument.createTextNode(" to close"));
        hints.createEl("br");
        hints.createEl("strong", { text: "Click" });
        hints.appendChild(activeDocument.createTextNode(" any snippet to insert."));

        this.setupEventHandlers();
        this.performSearch("");
        this.searchInput.focus();
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
        if (this.searchTimeout) window.clearTimeout(this.searchTimeout);
    }

    /** Checks the active Markdown view at open time for a non-empty
     *  selection. If yes, the picker frames the action as "Wrap
     *  selection". Read once at open — re-checking during typing
     *  doesn't help because the modal owns focus, so the selection
     *  state under the modal can't change. */
    private detectInitialSelection(): boolean {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        return Boolean(view?.editor?.getSelection?.());
    }

    private setupEventHandlers(): void {
        this.searchInput.addEventListener("input", () => {
            if (this.searchTimeout) window.clearTimeout(this.searchTimeout);
            this.searchTimeout = window.setTimeout(() => {
                this.performSearch(this.searchInput.value);
            }, this.debounceMs);
        });

        this.searchInput.addEventListener("keydown", (e) => {
            switch (e.key) {
                case "ArrowDown":
                    e.preventDefault();
                    this.navigateResults(1);
                    break;
                case "ArrowUp":
                    e.preventDefault();
                    this.navigateResults(-1);
                    break;
                case "Home":
                    e.preventDefault();
                    this.selectIndex(0);
                    break;
                case "End":
                    e.preventDefault();
                    this.selectIndex(this.searchResults.length - 1);
                    break;
                case "Enter":
                    e.preventDefault();
                    this.insertSelectedSnippet();
                    break;
                case "Escape":
                    e.preventDefault();
                    this.close();
                    break;
            }
        });

        // Single click handler per row (set in `renderResults()`).
        // The previous code had a list-level click handler AND a
        // per-item handler — both fired on row click and raced on
        // double-click (B-040 / U-006). Now: per-item only.
    }

    private performSearch(query: string): void {
        const searchQuery: SnippetSearchQuery = {
            text: query,
            limit: SnippetPickerModal.DEFAULT_LIMIT,
        };
        const result = this.api.search(searchQuery);
        this.searchResults = result.items;
        this.totalMatches = result.total;
        this.selectedIndex = 0;
        this.renderResults();
        this.updateCount();
        this.updatePreview();
    }

    private updateCount(): void {
        const shown = this.searchResults.length;
        if (this.totalMatches > shown) {
            this.resultCountEl.textContent = `Showing ${shown} of ${this.totalMatches}`;
            this.resultCountEl.removeClass("is-hidden");
        } else {
            this.resultCountEl.textContent = "";
            this.resultCountEl.addClass("is-hidden");
        }
    }

    private renderResults(): void {
        this.resultsList.empty();
        // Detach activedescendant pointer until we know which row exists.
        this.searchInput.removeAttribute("aria-activedescendant");

        if (this.searchResults.length === 0) {
            const emptyState = this.resultsList.createDiv("empty-state");
            emptyState.createSpan({ text: "No snippets found" });
            return;
        }

        this.searchResults.forEach((snippet, index) => {
            const item = this.resultsList.createDiv({
                cls: "snippet-item",
                attr: {
                    "data-index": index.toString(),
                    id: `${SnippetPickerModal.OPTION_ID_PREFIX}${index}`,
                    role: "option",
                    "aria-selected": "false",
                },
            });

            // Trigger name
            const name = item.createDiv("snippet-name");
            name.createSpan({ text: snippet.trigger });

            // Group label — "Folder" was inconsistent with every other
            // surface in the plugin (B-040 / U-004). The data shape
            // still uses `folder`; only the UI label changed.
            const groupEl = item.createDiv("snippet-folder");
            groupEl.createSpan({ text: `(${snippet.folder})` });

            // Preview (first 50 chars)
            const preview = item.createDiv("snippet-preview-text");
            const previewText = snippet.replacement.length > 50
                ? snippet.replacement.substring(0, 50) + "…"
                : snippet.replacement;
            preview.createSpan({ text: previewText });

            // Single click handler per row (B-040 / U-006 race fix).
            // `mousedown` instead of `click` prevents the focus loss on
            // input → row click that briefly removed activedescendant.
            item.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (this.isInserting) return;
                this.selectIndex(index);
                this.insertSelectedSnippet();
            });
        });

        this.updateSelection();
    }

    private navigateResults(direction: number): void {
        if (this.searchResults.length === 0) return;
        const next = Math.max(
            0,
            Math.min(this.searchResults.length - 1, this.selectedIndex + direction),
        );
        this.selectIndex(next);
    }

    private selectIndex(index: number): void {
        if (this.searchResults.length === 0) return;
        const clamped = Math.max(0, Math.min(this.searchResults.length - 1, index));
        this.selectedIndex = clamped;
        this.updateSelection();
        this.updatePreview();
        this.scrollToSelected();
    }

    private updateSelection(): void {
        const items = this.resultsList.querySelectorAll(".snippet-item");
        items.forEach((item, index) => {
            const isActive = index === this.selectedIndex;
            item.toggleClass("selected", isActive);
            item.setAttribute("aria-selected", isActive ? "true" : "false");
        });
        if (this.searchResults.length > 0) {
            this.searchInput.setAttribute(
                "aria-activedescendant",
                `${SnippetPickerModal.OPTION_ID_PREFIX}${this.selectedIndex}`,
            );
        }
    }

    private updatePreview(): void {
        this.previewDiv.empty();

        if (this.selectedIndex >= 0 && this.selectedIndex < this.searchResults.length) {
            const selectedSnippet = this.searchResults[this.selectedIndex];
            if (!selectedSnippet) return;

            const preview = this.api.preview(selectedSnippet);

            // Meta line — "Group" instead of "Folder" for naming
            // consistency (B-040 / U-004).
            const metaDiv = this.previewDiv.createDiv("snippet-preview-meta");
            metaDiv.createEl("strong", { text: "Trigger:" });
            metaDiv.appendChild(activeDocument.createTextNode(` ${selectedSnippet.trigger} | `));
            metaDiv.createEl("strong", { text: "Group:" });
            metaDiv.appendChild(activeDocument.createTextNode(` ${selectedSnippet.folder}`));

            const previewTextDiv = this.previewDiv.createDiv("snippet-preview-text-container");
            const text = preview.text;

            interface Marker {
                index: number;
                length: number;
                type: 'cursor' | 'tabstop';
                text: string;
            }

            const markers: Marker[] = [];

            if (preview.cursorIdx !== undefined) {
                const cursorRegex = /\$\|/g;
                let match;
                while ((match = cursorRegex.exec(text)) !== null) {
                    markers.push({
                        index: match.index,
                        length: match[0].length,
                        type: 'cursor',
                        text: match[0],
                    });
                }
            }

            if (preview.tabstops && preview.tabstops.length > 0) {
                for (const tabstop of preview.tabstops) {
                    const regex = new RegExp(`\\$${tabstop}`, 'g');
                    let match;
                    while ((match = regex.exec(text)) !== null) {
                        markers.push({
                            index: match.index,
                            length: match[0].length,
                            type: 'tabstop',
                            text: match[0],
                        });
                    }
                }
            }

            markers.sort((a, b) => a.index - b.index);

            let lastIndex = 0;
            for (const marker of markers) {
                if (marker.index > lastIndex) {
                    previewTextDiv.appendChild(
                        activeDocument.createTextNode(text.substring(lastIndex, marker.index)),
                    );
                }
                previewTextDiv.createSpan({
                    cls: marker.type === 'cursor' ? "snippet-highlight-cursor" : "snippet-highlight-tabstop",
                    text: marker.text,
                });
                lastIndex = marker.index + marker.length;
            }

            if (lastIndex < text.length) {
                previewTextDiv.appendChild(
                    activeDocument.createTextNode(text.substring(lastIndex)),
                );
            }
        } else {
            const emptyDiv = this.previewDiv.createDiv("snippet-preview-empty");
            emptyDiv.createSpan({ text: "Select a snippet to preview" });
        }
    }

    private scrollToSelected(): void {
        const selectedItem = this.resultsList.querySelector(
            `[data-index="${this.selectedIndex}"]`,
        );
        if (selectedItem) {
            selectedItem.scrollIntoView({ block: "nearest" });
        }
    }

    private insertSelectedSnippet(): void {
        if (this.isInserting) return;
        if (this.selectedIndex < 0 || this.selectedIndex >= this.searchResults.length) return;

        const selectedSnippet = this.searchResults[this.selectedIndex];
        if (!selectedSnippet) return;

        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeView?.editor) {
            // No editable Markdown view focused — Enter / click used to
            // silently no-op; tell the user explicitly and keep the
            // picker open so they can switch views and retry.
            new Notice("Open a Markdown note to insert a snippet");
            return;
        }

        this.isInserting = true;
        const editor = activeView.editor;
        const selection = editor.getSelection();

        try {
            if (selection) {
                wrapSelectionWithSnippet(editor, selectedSnippet.replacement);
            } else {
                insertSnippetAtCursor(editor, selectedSnippet.replacement);
            }
        } catch (error) {
            console.error('Error inserting snippet:', error);
        } finally {
            this.isInserting = false;
            this.close();
        }
    }
}

/**
 * Opens the snippet picker modal.
 */
export function openSnippetPickerModal(app: App, api: SnippetPickerAPI): void {
    const modal = new SnippetPickerModal(app, api);
    modal.open();
}
