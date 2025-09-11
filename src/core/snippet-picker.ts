import type { SnippetItem, SnippetSearchQuery } from "../types";

export interface SnippetPickerAPI {
    listAll(): SnippetItem[];
    search(q: SnippetSearchQuery): SnippetItem[];
    preview(item: SnippetItem): { text: string; cursorIdx?: number; tabstops?: number[] };
}

export interface SnippetPreview {
    text: string;
    cursorIdx?: number;
    tabstops?: number[];
}

/**
 * Фасад для работы с сниппетами в Snippet Picker
 * Не знает про Obsidian API и DOM - только бизнес-логика
 */
export class SnippetPickerService implements SnippetPickerAPI {
    private snippets: SnippetItem[] = [];

    constructor(snippets: SnippetItem[]) {
        this.snippets = snippets;
    }

    /**
     * Возвращает все доступные сниппеты
     */
    listAll(): SnippetItem[] {
        return [...this.snippets];
    }

    /**
     * Поиск сниппетов по запросу
     */
    search(q: SnippetSearchQuery): SnippetItem[] {
        const normalizedQuery = q.text.trim().toLowerCase();
        const limit = q.limit ?? 100;

        if (!normalizedQuery) {
            return this.snippets.slice(0, limit);
        }

        let results = this.snippets.filter(item => {
            // Фильтр по папке
            if (q.folder && item.folder !== q.folder) {
                return false;
            }

            // Поиск по trigger, replacement, folder и keywords
            const searchFields = [
                item.trigger.toLowerCase(),
                item.replacement.toLowerCase(),
                item.folder.toLowerCase(),
                ...(item.keywords || [])
            ];

            return searchFields.some(field => field.includes(normalizedQuery));
        });

        return results.slice(0, limit);
    }

    /**
     * Генерирует превью сниппета с подсветкой плейсхолдеров
     */
    preview(item: SnippetItem): SnippetPreview {
        const text = item.replacement;
        let cursorIdx: number | undefined;
        const tabstops: number[] = [];

        // Находим $| (курсор)
        const cursorMatch = text.indexOf('$|');
        if (cursorMatch !== -1) {
            cursorIdx = cursorMatch;
        }

        // Находим $1, $2, ... $n (tabstops)
        const tabstopRegex = /\$(\d+)/g;
        let match;
        while ((match = tabstopRegex.exec(text)) !== null) {
            const tabstopNum = parseInt(match[1], 10);
            if (!tabstops.includes(tabstopNum)) {
                tabstops.push(tabstopNum);
            }
        }

        // Сортируем tabstops по порядку
        tabstops.sort((a, b) => a - b);

        return {
            text,
            cursorIdx,
            tabstops: tabstops.length > 0 ? tabstops : undefined
        };
    }
}
