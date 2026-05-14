import { describe, it, expect } from "vitest";
import {
    getDict,
    mergeDefaults,
    getAllSnippetsFlat,
    hasTriggerCollision,
    hasReplacementCollision
} from "./snippets";
import type { SnipSidianSettings } from "../types";

describe("store/snippets", () => {
    it("getDict returns settings.snippets or {}", () => {
        expect(getDict({ snippets: { a: "1" } } as any)).toEqual({ a: "1" });
        expect(getDict({ snippets: undefined } as any)).toEqual({});
    });

    it("getDict keeps first trigger when the same trigger exists in multiple groups", () => {
        const settings = {
            snippets: {
                "zeta/dup": "z",
                "alpha/dup": "a"
            }
        } as any;
        expect(getDict(settings)).toEqual({ dup: "a" });
    });

    it("mergeDefaults prefers current over defaults", () => {
        const defs = { a: "A", b: "B" };
        const cur = { b: "b-cur", c: "C" };
        expect(mergeDefaults(cur, defs)).toEqual({ a: "A", b: "b-cur", c: "C" });
    });

    it("hasTriggerCollision detects the same trigger name across groups", () => {
        const settings = {
            snippets: {
                "work/sig": "Best",
                "personal/sig": "Cheers",
                "hello": "Hello"
            }
        } as any;

        expect(hasTriggerCollision(settings, "sig")).toBe(true);
        expect(hasTriggerCollision(settings, "sig", "work/sig")).toBe(true);
        expect(hasTriggerCollision(settings, "hello", "hello")).toBe(false);
        expect(hasTriggerCollision(settings, "missing")).toBe(false);
    });

    it("hasReplacementCollision detects conflicting replacement for same trigger", () => {
        const settings = {
            snippets: {
                "work/sig": "Best",
                "personal/sig": "Cheers",
                "hello": "Hello"
            }
        } as any;

        expect(hasReplacementCollision(settings, "sig", "Best")).toBe(true);
        expect(hasReplacementCollision(settings, "sig", "Best", "personal/sig")).toBe(false);
        expect(hasReplacementCollision(settings, "hello", "Hello")).toBe(false);
        expect(hasReplacementCollision(settings, "missing", "x")).toBe(false);
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
            
            // Should have user snippets
            const userSnippets = result.filter(s => s.folder === "user");
            expect(userSnippets).toHaveLength(2);
            
            const helloSnippet = userSnippets.find(s => s.trigger === "hello");
            expect(helloSnippet).toBeDefined();
            expect(helloSnippet?.replacement).toBe("Hello World");
            expect(helloSnippet?.id).toBe("user:hello");
        });

        it("should return only user snippets", () => {
            const result = getAllSnippetsFlat(mockSettings);
            
            // Should only have user snippets
            const userSnippets = result.filter(s => s.folder === "user");
            expect(userSnippets).toHaveLength(2);
            
            // Should not have any package snippets
            const packageSnippets = result.filter(s => s.folder.startsWith("builtin-"));
            expect(packageSnippets.length).toBe(0);
        });

        it("should preserve group and trigger name for grouped keys", () => {
            const groupedSettings: SnipSidianSettings = {
                snippets: {
                    "work/sig": "Best regards",
                    "sig": "Cheers"
                }
            };
            const result = getAllSnippetsFlat(groupedSettings);

            const grouped = result.find(s => s.id === "user:work/sig");
            expect(grouped?.folder).toBe("work");
            expect(grouped?.trigger).toBe("sig");

            const ungrouped = result.find(s => s.id === "user:sig");
            expect(ungrouped?.folder).toBe("user");
            expect(ungrouped?.trigger).toBe("sig");
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
            
            // Should not have any package snippets
            const packageSnippets = result.filter(s => s.folder.startsWith("builtin-"));
            expect(packageSnippets.length).toBe(0);
        });
    });
});
