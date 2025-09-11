import { Modal, App, Editor, MarkdownView } from "obsidian";
import type { SnippetItem, SnippetSearchQuery } from "../../types";
import type { SnippetPickerAPI } from "../../core/snippet-picker";
import { insertSnippetAtCursor, wrapSelectionWithSnippet } from "../../adapters/obsidian-editor";

export class SnippetPickerModal extends Modal {
    private api: SnippetPickerAPI;
    private searchInput!: HTMLInputElement;
    private resultsList!: HTMLDivElement;
    private previewDiv!: HTMLDivElement;
    private selectedIndex: number = 0;
    private searchResults: SnippetItem[] = [];
    private searchTimeout: number | null = null;
    private debounceMs: number = 200;
    private isInserting: boolean = false;

    constructor(app: App, api: SnippetPickerAPI) {
        super(app);
        this.api = api;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();

        // Title
        const title = contentEl.createEl("h2", { text: "Insert Snippet" });
        title.style.marginTop = "0";

        // Search field with label
        const searchLabel = contentEl.createEl("label", { text: "Search Snippet" });
        searchLabel.style.display = "block";
        searchLabel.style.marginBottom = "4px";
        searchLabel.style.fontWeight = "500";
        searchLabel.style.fontSize = "12px";
        searchLabel.style.color = "var(--text-normal)";

        this.searchInput = contentEl.createEl("input", {
            type: "text",
            placeholder: "Type to search snippets...",
            cls: "prompt-input"
        });
        this.searchInput.style.width = "100%";
        this.searchInput.style.marginBottom = "10px";

        // Results list
        this.resultsList = contentEl.createDiv("snippet-results");
        this.resultsList.style.maxHeight = "300px";
        this.resultsList.style.overflowY = "auto";
        this.resultsList.style.border = "1px solid var(--background-modifier-border)";
        this.resultsList.style.borderRadius = "4px";
        this.resultsList.style.padding = "8px";

        // Preview with label
        const previewLabel = contentEl.createEl("label", { text: "Preview" });
        previewLabel.style.display = "block";
        previewLabel.style.marginTop = "10px";
        previewLabel.style.marginBottom = "4px";
        previewLabel.style.fontWeight = "500";
        previewLabel.style.fontSize = "12px";
        previewLabel.style.color = "var(--text-normal)";

        this.previewDiv = contentEl.createDiv("snippet-preview");
        this.previewDiv.style.padding = "8px";
        this.previewDiv.style.backgroundColor = "var(--background-secondary)";
        this.previewDiv.style.borderRadius = "4px";
        this.previewDiv.style.fontFamily = "var(--font-monospace)";
        this.previewDiv.style.fontSize = "12px";
        this.previewDiv.style.minHeight = "40px";
        this.previewDiv.style.border = "1px solid var(--background-modifier-border)";

        // Hints
        const hints = contentEl.createDiv("snippet-hints");
        hints.style.marginTop = "10px";
        hints.style.padding = "8px";
        hints.style.backgroundColor = "var(--background-secondary)";
        hints.style.borderRadius = "4px";
        hints.style.fontSize = "11px";
        hints.style.color = "var(--text-muted)";
        hints.innerHTML = `
            <strong>Navigation:</strong> ↑/↓ to navigate, <strong>Enter</strong> to insert, <strong>Esc</strong> to close<br>
            <strong>Click</strong> any snippet to insert it directly
        `;

        // Event handlers
        this.setupEventHandlers();

        // Load all snippets
        this.performSearch("");

        // Focus on search field
        this.searchInput.focus();
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
        
        if (this.searchTimeout) {
            clearTimeout(this.searchTimeout);
        }
    }

    private setupEventHandlers(): void {
        // Search with debounce
        this.searchInput.addEventListener("input", () => {
            if (this.searchTimeout) {
                clearTimeout(this.searchTimeout);
            }
            
            this.searchTimeout = window.setTimeout(() => {
                this.performSearch(this.searchInput.value);
            }, this.debounceMs);
        });

        // Keyboard navigation
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

        // Click on results
        this.resultsList.addEventListener("click", (e) => {
            const target = e.target as HTMLElement;
            const item = target.closest(".snippet-item");
            if (item) {
                const index = parseInt(item.getAttribute("data-index") || "0");
                this.selectedIndex = index;
                this.updateSelection();
                this.insertSelectedSnippet();
            }
        });
    }

    private performSearch(query: string): void {
        const searchQuery: SnippetSearchQuery = {
            text: query,
            limit: 100
        };

        this.searchResults = this.api.search(searchQuery);
        this.selectedIndex = 0;
        this.renderResults();
        this.updatePreview();
    }

    private renderResults(): void {
        this.resultsList.empty();

        if (this.searchResults.length === 0) {
            const emptyState = this.resultsList.createDiv("empty-state");
            emptyState.textContent = "No snippets found";
            emptyState.style.textAlign = "center";
            emptyState.style.padding = "20px";
            emptyState.style.color = "var(--text-muted)";
            return;
        }

        this.searchResults.forEach((snippet, index) => {
            const item = this.resultsList.createDiv("snippet-item");
            item.setAttribute("data-index", index.toString());
            item.style.padding = "6px 8px";
            item.style.cursor = "pointer";
            item.style.borderRadius = "3px";
            item.style.marginBottom = "2px";

            // Name (trigger)
            const name = item.createDiv("snippet-name");
            name.textContent = snippet.trigger;
            name.style.fontWeight = "500";

            // Folder
            const folder = item.createDiv("snippet-folder");
            folder.textContent = `(${snippet.folder})`;
            folder.style.fontSize = "11px";
            folder.style.color = "var(--text-muted)";
            folder.style.marginTop = "2px";

            // Preview (first characters)
            const preview = item.createDiv("snippet-preview-text");
            const previewText = snippet.replacement.length > 50 
                ? snippet.replacement.substring(0, 50) + "..." 
                : snippet.replacement;
            preview.textContent = previewText;
            preview.style.fontSize = "11px";
            preview.style.color = "var(--text-muted)";
            preview.style.marginTop = "2px";
            preview.style.fontFamily = "var(--font-monospace)";

            // Click to select
            item.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                if (this.isInserting) return;
                
                this.selectedIndex = index;
                this.updateSelection();
                this.updatePreview();
                this.insertSelectedSnippet();
            });

            // Hover effect
            item.addEventListener("mouseenter", () => {
                (item as HTMLElement).style.backgroundColor = "var(--background-modifier-hover)";
            });
            item.addEventListener("mouseleave", () => {
                if (index !== this.selectedIndex) {
                    (item as HTMLElement).style.backgroundColor = "";
                }
            });
        });

        this.updateSelection();
    }

    private navigateResults(direction: number): void {
        if (this.searchResults.length === 0) return;

        this.selectedIndex = Math.max(0, Math.min(
            this.searchResults.length - 1,
            this.selectedIndex + direction
        ));

        this.updateSelection();
        this.updatePreview();
        this.scrollToSelected();
    }

    private updateSelection(): void {
        const items = this.resultsList.querySelectorAll(".snippet-item");
        items.forEach((item, index) => {
            if (index === this.selectedIndex) {
                (item as HTMLElement).style.backgroundColor = "var(--interactive-accent)";
                (item as HTMLElement).style.color = "var(--text-on-accent)";
            } else {
                (item as HTMLElement).style.backgroundColor = "";
                (item as HTMLElement).style.color = "";
            }
        });
    }

    private updatePreview(): void {
        if (this.selectedIndex >= 0 && this.selectedIndex < this.searchResults.length) {
            const selectedSnippet = this.searchResults[this.selectedIndex];
            if (!selectedSnippet) return;
            
            const preview = this.api.preview(selectedSnippet);
            
            // Create informative preview
            let previewHTML = `<div style="margin-bottom: 8px; font-size: 11px; color: var(--text-muted);">`;
            previewHTML += `<strong>Trigger:</strong> ${selectedSnippet.trigger} | <strong>Folder:</strong> ${selectedSnippet.folder}`;
            previewHTML += `</div>`;
            
            // Highlight placeholders
            let displayText = preview.text;
            if (preview.cursorIdx !== undefined) {
                displayText = displayText.replace(/\$\|/g, '<span style="background: var(--text-accent); color: var(--text-on-accent); padding: 1px 2px; border-radius: 2px;">$|</span>');
            }
            
            // Highlight tabstops
            if (preview.tabstops) {
                preview.tabstops.forEach(tabstop => {
                    const regex = new RegExp(`\\$${tabstop}`, 'g');
                    displayText = displayText.replace(regex, `<span style="background: var(--background-modifier-border); padding: 1px 2px; border-radius: 2px;">$${tabstop}</span>`);
                });
            }

            previewHTML += `<div style="white-space: pre-wrap; word-break: break-all;">${displayText}</div>`;
            this.previewDiv.innerHTML = previewHTML;
        } else {
            this.previewDiv.innerHTML = '<div style="color: var(--text-muted); font-style: italic;">Select a snippet to preview</div>';
        }
    }

    private scrollToSelected(): void {
        const selectedItem = this.resultsList.querySelector(`[data-index="${this.selectedIndex}"]`);
        if (selectedItem) {
            selectedItem.scrollIntoView({ block: "nearest" });
        }
    }

    private insertSelectedSnippet(): void {
        if (this.isInserting) return; // Protection against repeated calls
        
        if (this.selectedIndex >= 0 && this.selectedIndex < this.searchResults.length) {
            const selectedSnippet = this.searchResults[this.selectedIndex];
            if (!selectedSnippet) return;
            
            const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
            
            if (activeView?.editor) {
                this.isInserting = true;
                
                const editor = activeView.editor;
                const selection = editor.getSelection();
                
                console.log('Inserting snippet:', selectedSnippet.trigger);
                console.log('Replacement:', selectedSnippet.replacement);
                console.log('Selection:', selection);
                
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
    }
}

/**
 * Opens the snippet picker modal
 */
export function openSnippetPickerModal(app: App, api: SnippetPickerAPI): void {
    const modal = new SnippetPickerModal(app, api);
    modal.open();
}
