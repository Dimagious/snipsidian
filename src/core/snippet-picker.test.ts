import { describe, it, expect, beforeEach } from "vitest";
import { SnippetPickerService } from "./snippet-picker";
import type { SnippetItem } from "../types";

describe("SnippetPickerService", () => {
    const mockSnippets: SnippetItem[] = [
        {
            id: "1",
            folder: "arrows",
            trigger: "->",
            replacement: "→"
        },
        {
            id: "2", 
            folder: "callouts",
            trigger: ":note",
            replacement: "> [!note] $|"
        },
        {
            id: "3",
            folder: "user",
            trigger: "h1",
            replacement: "# $|",
            keywords: ["heading", "title"]
        },
        {
            id: "4",
            folder: "math",
            trigger: "alpha",
            replacement: "α"
        }
    ];

    let service: SnippetPickerService;

    beforeEach(() => {
        service = new SnippetPickerService(mockSnippets);
    });

    describe("listAll", () => {
        it("should return all snippets", () => {
            const result = service.listAll();
            expect(result).toHaveLength(4);
            expect(result).toEqual(mockSnippets);
        });
    });

    describe("search", () => {
        it("should return all snippets when query is empty", () => {
            const result = service.search({ text: "" });
            expect(result.items).toHaveLength(4);
            expect(result.total).toBe(4);
        });

        it("should return all snippets when query is whitespace", () => {
            const result = service.search({ text: "   " });
            expect(result.items).toHaveLength(4);
            expect(result.total).toBe(4);
        });

        it("should search by trigger", () => {
            const result = service.search({ text: "->" });
            expect(result.items).toHaveLength(1);
            expect(result.items[0].trigger).toBe("->");
            expect(result.total).toBe(1);
        });

        it("should search by replacement", () => {
            const result = service.search({ text: "→" });
            expect(result.items).toHaveLength(1);
            expect(result.items[0].replacement).toBe("→");
        });

        it("should search by folder", () => {
            const result = service.search({ text: "arrows" });
            expect(result.items).toHaveLength(1);
            expect(result.items[0].folder).toBe("arrows");
        });

        it("should search by keywords", () => {
            const result = service.search({ text: "heading" });
            expect(result.items).toHaveLength(1);
            expect(result.items[0].trigger).toBe("h1");
        });

        it("should be case insensitive", () => {
            const result = service.search({ text: "ARROW" });
            expect(result.items).toHaveLength(1);
            expect(result.items[0].folder).toBe("arrows");
        });

        it("should filter by folder when specified", () => {
            const result = service.search({ text: "note", folder: "callouts" });
            expect(result.items).toHaveLength(1);
            expect(result.items[0].trigger).toBe(":note");
            expect(result.total).toBe(1);
        });

        it("should return empty when folder filter doesn't match", () => {
            const result = service.search({ text: "note", folder: "arrows" });
            expect(result.items).toHaveLength(0);
            expect(result.total).toBe(0);
        });

        it("should respect limit", () => {
            const result = service.search({ text: "", limit: 2 });
            expect(result.items).toHaveLength(2);
        });

        it("should return partial matches", () => {
            const result = service.search({ text: "note" });
            expect(result.items).toHaveLength(1);
            expect(result.items[0].trigger).toBe(":note");
        });

        // -------- Truncation contract (B-040 / U-003) --------
        // The load-bearing assertion: when results > limit, `total`
        // reports the pre-truncation count so the UI can show
        // "Showing X of Y" instead of silently dropping matches.

        it("reports total > items.length when the limit truncates the empty-query result", () => {
            // 4 snippets, limit 2 → items=2, total=4. Without `total`
            // the picker would silently hide 2 matches and the user
            // couldn't tell.
            const result = service.search({ text: "", limit: 2 });
            expect(result.items).toHaveLength(2);
            expect(result.total).toBe(4);
        });

        it("reports total > items.length when the limit truncates a filtered result", () => {
            // Pad the fixture to 5 matching snippets, search-by-folder
            // for that group, limit 3.
            const padded: SnippetItem[] = [
                ...mockSnippets,
                { id: "5", folder: "arrows", trigger: "=>", replacement: "⇒" },
                { id: "6", folder: "arrows", trigger: "<=", replacement: "⇐" },
                { id: "7", folder: "arrows", trigger: "<->", replacement: "↔" },
                { id: "8", folder: "arrows", trigger: "<=>", replacement: "⇔" },
            ];
            const padded_service = new SnippetPickerService(padded);
            const result = padded_service.search({ text: "arrows", limit: 3 });
            expect(result.items).toHaveLength(3);
            expect(result.total).toBe(5);
        });

        it("reports total === items.length when no truncation happens", () => {
            // The boundary case: matched count equals limit exactly.
            // The UI hint must NOT fire here ("Showing 4 of 4" is
            // noise). Pin the contract.
            const result = service.search({ text: "", limit: 4 });
            expect(result.items).toHaveLength(4);
            expect(result.total).toBe(4);
        });
    });

    describe("preview", () => {
        it("should return text without modification", () => {
            const result = service.preview(mockSnippets[0]);
            expect(result.text).toBe("→");
            expect(result.cursorIdx).toBeUndefined();
            expect(result.tabstops).toBeUndefined();
        });

        it("should find cursor position", () => {
            const result = service.preview(mockSnippets[1]);
            expect(result.text).toBe("> [!note] $|");
            expect(result.cursorIdx).toBe(10);
        });

        it("should find tabstops", () => {
            const snippet: SnippetItem = {
                id: "test",
                folder: "test",
                trigger: "test",
                replacement: "Hello $1 world $2 end"
            };
            const result = service.preview(snippet);
            expect(result.text).toBe("Hello $1 world $2 end");
            expect(result.tabstops).toEqual([1, 2]);
        });

        it("should find both cursor and tabstops", () => {
            const snippet: SnippetItem = {
                id: "test",
                folder: "test", 
                trigger: "test",
                replacement: "Start $1 $| end $2"
            };
            const result = service.preview(snippet);
            expect(result.text).toBe("Start $1 $| end $2");
            expect(result.cursorIdx).toBe(9);
            expect(result.tabstops).toEqual([1, 2]);
        });

        it("should sort tabstops numerically", () => {
            const snippet: SnippetItem = {
                id: "test",
                folder: "test",
                trigger: "test", 
                replacement: "$3 first $1 second $2 third"
            };
            const result = service.preview(snippet);
            expect(result.tabstops).toEqual([1, 2, 3]);
        });
    });
});
