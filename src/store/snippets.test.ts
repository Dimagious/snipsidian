import { describe, it, expect, beforeEach } from "vitest";
import { getDict, mergeDefaults, replaceAllSnippets, getAllSnippetsFlat } from "./snippets";
import type { SnipSidianSettings } from "../types";

describe("store/snippets", () => {
    it("getDict returns settings.snippets or {}", () => {
        expect(getDict({ snippets: { a: "1" } } as any)).toEqual({ a: "1" });
        expect(getDict({ snippets: undefined } as any)).toEqual({});
    });

    it("mergeDefaults prefers current over defaults", () => {
        const defs = { a: "A", b: "B" };
        const cur = { b: "b-cur", c: "C" };
        expect(mergeDefaults(cur, defs)).toEqual({ a: "A", b: "b-cur", c: "C" });
    });

    it("replaceAllSnippets accepts valid input and rejects invalid", () => {
        const settings = { snippets: { a: "1" } } as any;
        const ok = replaceAllSnippets(settings, { x: "X" });
        expect(ok).toEqual({ snippets: { x: "X" } });

        const bad = replaceAllSnippets(settings, { x: 1 } as any);
        expect(bad).toBeNull();
    });

    describe("getAllSnippetsFlat", () => {
        const mockSettings: SnipSidianSettings = {
            snippets: {
                "hello": "Hello World",
                "test": "Test $|"
            }
        };

        it("should return user snippets with correct structure", () => {
            const result = getAllSnippetsFlat(mockSettings);
            
            // Должны быть пользовательские сниппеты
            const userSnippets = result.filter(s => s.folder === "user");
            expect(userSnippets).toHaveLength(2);
            
            const helloSnippet = userSnippets.find(s => s.trigger === "hello");
            expect(helloSnippet).toBeDefined();
            expect(helloSnippet?.replacement).toBe("Hello World");
            expect(helloSnippet?.id).toBe("user:hello");
        });

        it("should include builtin package snippets", () => {
            const result = getAllSnippetsFlat(mockSettings);
            
            // Должны быть сниппеты из пакетов
            const packageSnippets = result.filter(s => s.folder.startsWith("builtin-"));
            expect(packageSnippets.length).toBeGreaterThan(0);
            
            // Проверяем, что есть сниппеты из разных пакетов
            const folders = new Set(packageSnippets.map(s => s.folder));
            expect(folders.size).toBeGreaterThan(1);
        });

        it("should have unique IDs", () => {
            const result = getAllSnippetsFlat(mockSettings);
            const ids = result.map(s => s.id);
            const uniqueIds = new Set(ids);
            expect(ids.length).toBe(uniqueIds.size);
        });

        it("should handle empty user snippets", () => {
            const emptySettings: SnipSidianSettings = { snippets: {} };
            const result = getAllSnippetsFlat(emptySettings);
            
            const userSnippets = result.filter(s => s.folder === "user");
            expect(userSnippets).toHaveLength(0);
            
            // Но должны быть пакетные сниппеты
            const packageSnippets = result.filter(s => s.folder.startsWith("builtin-"));
            expect(packageSnippets.length).toBeGreaterThan(0);
        });
    });
});
