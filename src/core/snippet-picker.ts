import type { SnippetItem, SnippetSearchQuery } from "../types";

/** Result of a picker search. `items` is truncated to `q.limit`;
 *  `total` is the full matched count before truncation. The split is
 *  what lets the UI show "showing X of Y" only when truncation
 *  actually happened (B-040 / U-003). */
export interface SnippetSearchResult {
    items: SnippetItem[];
    total: number;
}

export interface SnippetPickerAPI {
    listAll(): SnippetItem[];
    search(q: SnippetSearchQuery): SnippetSearchResult;
    preview(item: SnippetItem): { text: string; cursorIdx?: number; tabstops?: number[] };
}

export interface SnippetPreview {
    text: string;
    cursorIdx?: number;
    tabstops?: number[];
}

/**
 * Facade for working with snippets in Snippet Picker
 * Doesn't know about Obsidian API and DOM - only business logic
 */
export class SnippetPickerService implements SnippetPickerAPI {
    private snippets: SnippetItem[] = [];

    constructor(snippets: SnippetItem[]) {
        this.snippets = snippets;
    }

    /**
     * Returns all available snippets
     */
    listAll(): SnippetItem[] {
        return [...this.snippets];
    }

    /**
     * Search snippets by query.
     *
     * Returns `{ items, total }` where `items` is at most `limit` long
     * and `total` is the full pre-truncation match count. The UI uses
     * `total > items.length` to show a "showing X of Y" hint instead
     * of silently dropping results past the limit (B-040 / U-003).
     */
    search(q: SnippetSearchQuery): SnippetSearchResult {
        const normalizedQuery = q.text.trim().toLowerCase();
        const limit = q.limit ?? 100;

        if (!normalizedQuery) {
            return {
                items: this.snippets.slice(0, limit),
                total: this.snippets.length,
            };
        }

        const results = this.snippets.filter(item => {
            // Filter by folder
            if (q.folder && item.folder !== q.folder) {
                return false;
            }

            // Search by trigger, replacement, folder and keywords
            const searchFields = [
                item.trigger.toLowerCase(),
                item.replacement.toLowerCase(),
                item.folder.toLowerCase(),
                ...(item.keywords || [])
            ];

            return searchFields.some(field => field.includes(normalizedQuery));
        });

        return {
            items: results.slice(0, limit),
            total: results.length,
        };
    }

    /**
     * Generates snippet preview with placeholder highlighting
     */
    preview(item: SnippetItem): SnippetPreview {
        const text = item.replacement;
        let cursorIdx: number | undefined;
        const tabstops: number[] = [];

        // Find $| (cursor)
        const cursorMatch = text.indexOf('$|');
        if (cursorMatch !== -1) {
            cursorIdx = cursorMatch;
        }

        // Find $1, $2, ... $n (tabstops)
        const tabstopRegex = /\$(\d+)/g;
        let match;
        while ((match = tabstopRegex.exec(text)) !== null) {
            const tabstopNum = parseInt(match[1] || "0", 10);
            if (!tabstops.includes(tabstopNum)) {
                tabstops.push(tabstopNum);
            }
        }

        // Sort tabstops in order
        tabstops.sort((a, b) => a - b);

        return {
            text,
            cursorIdx,
            tabstops: tabstops.length > 0 ? tabstops : undefined
        };
    }
}
