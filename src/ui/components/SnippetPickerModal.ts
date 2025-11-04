import { Modal, App, MarkdownView } from "obsidian";
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
        contentEl.addClass("snippet-picker-modal");

        // Title
        contentEl.createEl("h2", { text: "Insert snippet" });

        // Search field with label
        contentEl.createEl("label", { text: "Search snippet" });

        this.searchInput = contentEl.createEl("input", {
            type: "text",
            placeholder: "Type to search snippets...",
            cls: "search-input"
        });

        // Results list
        this.resultsList = contentEl.createDiv("snippet-results");

        // Preview with label
        contentEl.createEl("label", { text: "Preview", cls: "preview-label" });

        this.previewDiv = contentEl.createDiv("snippet-preview");

        // Hints
        const hints = contentEl.createDiv("snippet-hints");
        
        hints.createEl("strong", { text: "Navigation:" });
        hints.appendChild(document.createTextNode(" ↑/↓ to navigate, "));
        hints.createEl("strong", { text: "Enter" });
        hints.appendChild(document.createTextNode(" to insert, "));
        hints.createEl("strong", { text: "Esc" });
        hints.appendChild(document.createTextNode(" to close"));
        hints.createEl("br");
        hints.createEl("strong", { text: "Click" });
        hints.appendChild(document.createTextNode(" any snippet to insert it directly"));

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
            emptyState.createEl("span", { text: "No snippets found" });
            return;
        }

        this.searchResults.forEach((snippet, index) => {
            const item = this.resultsList.createDiv("snippet-item");
            item.setAttribute("data-index", index.toString());

            // Name (trigger)
            const name = item.createDiv("snippet-name");
            name.createEl("span", { text: snippet.trigger });

            // Folder
            const folder = item.createDiv("snippet-folder");
            folder.createEl("span", { text: `(${snippet.folder})` });

            // Preview (first characters)
            const preview = item.createDiv("snippet-preview-text");
            const previewText = snippet.replacement.length > 50 
                ? snippet.replacement.substring(0, 50) + "..." 
                : snippet.replacement;
            preview.createEl("span", { text: previewText });

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

            // Hover effect is handled by CSS
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
                item.addClass("selected");
            } else {
                item.removeClass("selected");
            }
        });
    }

    private updatePreview(): void {
        this.previewDiv.empty();
        
        if (this.selectedIndex >= 0 && this.selectedIndex < this.searchResults.length) {
            const selectedSnippet = this.searchResults[this.selectedIndex];
            if (!selectedSnippet) return;
            
            const preview = this.api.preview(selectedSnippet);
            
            // Create informative preview
            const metaDiv = this.previewDiv.createDiv("snippet-preview-meta");
            
            metaDiv.createEl("strong", { text: "Trigger:" });
            metaDiv.appendChild(document.createTextNode(` ${selectedSnippet.trigger} | `));
            metaDiv.createEl("strong", { text: "Folder:" });
            metaDiv.appendChild(document.createTextNode(` ${selectedSnippet.folder}`));
            
            // Create preview text with highlighting
            const previewTextDiv = this.previewDiv.createDiv("snippet-preview-text-container");
            
            // Process text with placeholders and tabstops
            const text = preview.text;
            
            // Collect all markers (cursor and tabstops) with their positions
            interface Marker {
                index: number;
                length: number;
                type: 'cursor' | 'tabstop';
                text: string;
            }
            
            const markers: Marker[] = [];
            
            // Find cursor placeholder
            if (preview.cursorIdx !== undefined) {
                const cursorRegex = /\$\|/g;
                let match;
                while ((match = cursorRegex.exec(text)) !== null) {
                    markers.push({
                        index: match.index,
                        length: match[0].length,
                        type: 'cursor',
                        text: match[0]
                    });
                }
            }
            
            // Find tabstops
            if (preview.tabstops && preview.tabstops.length > 0) {
                for (const tabstop of preview.tabstops) {
                    const regex = new RegExp(`\\$${tabstop}`, 'g');
                    let match;
                    while ((match = regex.exec(text)) !== null) {
                        markers.push({
                            index: match.index,
                            length: match[0].length,
                            type: 'tabstop',
                            text: match[0]
                        });
                    }
                }
            }
            
            // Sort markers by position
            markers.sort((a, b) => a.index - b.index);
            
            // Build DOM elements sequentially
            let lastIndex = 0;
            for (const marker of markers) {
                // Add text before marker
                if (marker.index > lastIndex) {
                    previewTextDiv.appendChild(document.createTextNode(text.substring(lastIndex, marker.index)));
                }
                
                // Add highlighted marker
                previewTextDiv.createEl("span", {
                    cls: marker.type === 'cursor' ? "snippet-highlight-cursor" : "snippet-highlight-tabstop",
                    text: marker.text
                });
                
                lastIndex = marker.index + marker.length;
            }
            
            // Add remaining text
            if (lastIndex < text.length) {
                previewTextDiv.appendChild(document.createTextNode(text.substring(lastIndex)));
            }
        } else {
            const emptyDiv = this.previewDiv.createDiv("snippet-preview-empty");
            emptyDiv.createEl("span", { text: "Select a snippet to preview" });
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
