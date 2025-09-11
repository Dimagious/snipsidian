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
            expect(result).toHaveLength(4);
        });

        it("should return all snippets when query is whitespace", () => {
            const result = service.search({ text: "   " });
            expect(result).toHaveLength(4);
        });

        it("should search by trigger", () => {
            const result = service.search({ text: "->" });
            expect(result).toHaveLength(1);
            expect(result[0].trigger).toBe("->");
        });

        it("should search by replacement", () => {
            const result = service.search({ text: "→" });
            expect(result).toHaveLength(1);
            expect(result[0].replacement).toBe("→");
        });

        it("should search by folder", () => {
            const result = service.search({ text: "arrows" });
            expect(result).toHaveLength(1);
            expect(result[0].folder).toBe("arrows");
        });

        it("should search by keywords", () => {
            const result = service.search({ text: "heading" });
            expect(result).toHaveLength(1);
            expect(result[0].trigger).toBe("h1");
        });

        it("should be case insensitive", () => {
            const result = service.search({ text: "ARROW" });
            expect(result).toHaveLength(1);
            expect(result[0].folder).toBe("arrows");
        });

        it("should filter by folder when specified", () => {
            const result = service.search({ text: "note", folder: "callouts" });
            expect(result).toHaveLength(1);
            expect(result[0].trigger).toBe(":note");
        });

        it("should return empty when folder filter doesn't match", () => {
            const result = service.search({ text: "note", folder: "arrows" });
            expect(result).toHaveLength(0);
        });

        it("should respect limit", () => {
            const result = service.search({ text: "", limit: 2 });
            expect(result).toHaveLength(2);
        });

        it("should return partial matches", () => {
            const result = service.search({ text: "note" });
            expect(result).toHaveLength(1);
            expect(result[0].trigger).toBe(":note");
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
