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

    // ---- Boundary tests per ADR-0005 (B-080) ----
    //
    // The existing tests cover the happy paths. These pin contracts
    // at edge inputs where bugs have historically slipped through.

    describe("getDict — first-wins collision behaviour (boundary)", () => {
        it("pins alphabetical-by-full-key order as the tie-breaker", () => {
            // The function sorts entries by full key, then iterates and
            // only assigns a trigger name on first sight. Add a third
            // colliding entry to make sure the order is by full key,
            // not insertion order or group name alone.
            const settings = {
                snippets: {
                    "zeta/sig": "Z",
                    "alpha/sig": "A",
                    "middle/sig": "M",
                },
            } as unknown as SnipSidianSettings;
            // localeCompare orders 'a' < 'm' < 'z'. `alpha/sig` wins.
            expect(getDict(settings)).toEqual({ sig: "A" });
        });

        it("treats an ungrouped trigger as having an empty group prefix", () => {
            // `splitKey("sig")` returns `{ group: "", name: "sig" }`.
            // Ungrouped triggers sort against grouped ones via full
            // key — `"sig"` vs `"work/sig"`. `"sig" < "work/sig"` so
            // ungrouped wins.
            const settings = {
                snippets: {
                    "work/sig": "from-group",
                    "sig": "ungrouped",
                },
            } as unknown as SnipSidianSettings;
            expect(getDict(settings)).toEqual({ sig: "ungrouped" });
        });

        it("survives a `__proto__` key without polluting Object.prototype", () => {
            // Defensive: a malicious import or hand-crafted settings
            // file could include `__proto__` as a key. `getDict` walks
            // entries safely via `Object.entries` and writes through
            // bracket access. Pin the assertion so a refactor using
            // unsafe property-style access (`out[name] = …` with name
            // being `__proto__`) gets caught.
            const settings = {
                snippets: {
                    "__proto__": "attacker",
                    "ok": "valid",
                },
            } as unknown as SnipSidianSettings;
            const dict = getDict(settings);
            expect(dict.ok).toBe("valid");
            // Object.prototype must not have been polluted.
            expect(({} as Record<string, unknown>).polluted).toBeUndefined();
        });
    });

    describe("hasTriggerCollision — exclusion semantics (boundary)", () => {
        it("excludeFullKey only skips that exact key, not other rows with same trigger name", () => {
            // The `excludeFullKey` is the row being edited — the
            // function must skip ONLY that row, but still detect
            // collisions on other rows. Pin the contract because
            // getting this wrong allows a user to rename a snippet
            // into another snippet's trigger (data loss).
            const settings = {
                snippets: {
                    "work/sig": "Best",
                    "personal/sig": "Cheers",
                    "shared/sig": "Yo",
                },
            } as unknown as SnipSidianSettings;
            // Editing `work/sig` — there are still two OTHER rows with
            // trigger "sig", so collision must be true.
            expect(hasTriggerCollision(settings, "sig", "work/sig")).toBe(true);
            // Editing `work/sig` to a new name `unique` — no other row
            // has that name, so no collision.
            expect(hasTriggerCollision(settings, "unique", "work/sig")).toBe(false);
        });
    });

    describe("hasReplacementCollision — content-difference semantics (boundary)", () => {
        it("returns false when the same trigger has the same replacement (no conflict)", () => {
            // Same trigger, same replacement — that's not a conflict,
            // it's a duplicate. The function must distinguish.
            const settings = {
                snippets: {
                    "work/sig": "Best",
                    "personal/sig": "Best",
                },
            } as unknown as SnipSidianSettings;
            expect(hasReplacementCollision(settings, "sig", "Best")).toBe(false);
        });

        it("returns true when an existing trigger has a different replacement", () => {
            const settings = {
                snippets: {
                    "work/sig": "Best",
                },
            } as unknown as SnipSidianSettings;
            expect(hasReplacementCollision(settings, "sig", "Different")).toBe(true);
        });
    });

    // ---- B-138: per-group enable/disable ----
    describe("getDict — disabledGroups (B-138)", () => {
        it("a disabled group's entries are absent from the dict entirely", () => {
            const settings = {
                snippets: { "work/sig": "Best", "personal/todo": "- [ ] " },
                disabledGroups: ["work"],
            } as unknown as SnipSidianSettings;
            const dict = getDict(settings);
            expect(dict.sig).toBeUndefined();
            expect(dict.todo).toBe("- [ ] ");
        });

        it("a present (non-disabled) group is unaffected", () => {
            const settings = {
                snippets: { "work/sig": "Best" },
                disabledGroups: ["other-group"],
            } as unknown as SnipSidianSettings;
            expect(getDict(settings)).toEqual({ sig: "Best" });
        });

        it("collision resolution falls through to the next candidate when the winner's group is disabled", () => {
            // Without disabling, "alpha/sig" wins (alphabetically
            // first). Disabling "alpha" must NOT just delete the
            // trigger — "zeta/sig" should become the winner.
            const settings = {
                snippets: { "alpha/sig": "A", "zeta/sig": "Z" },
                disabledGroups: ["alpha"],
            } as unknown as SnipSidianSettings;
            expect(getDict(settings)).toEqual({ sig: "Z" });
        });

        it("unknown group names in disabledGroups are harmless (no matching entries, no crash)", () => {
            const settings = {
                snippets: { "work/sig": "Best" },
                disabledGroups: ["a-group-that-was-deleted-long-ago"],
            } as unknown as SnipSidianSettings;
            expect(getDict(settings)).toEqual({ sig: "Best" });
        });

        it("an empty disabledGroups array means everything is enabled", () => {
            const settings = {
                snippets: { "work/sig": "Best" },
                disabledGroups: [],
            } as unknown as SnipSidianSettings;
            expect(getDict(settings)).toEqual({ sig: "Best" });
        });

        it("undefined disabledGroups (field never set) means everything is enabled", () => {
            const settings = {
                snippets: { "work/sig": "Best" },
            } as unknown as SnipSidianSettings;
            expect(getDict(settings)).toEqual({ sig: "Best" });
        });

        it("disabling ALL groups containing a trigger removes it from the dict, not just demotes it", () => {
            const settings = {
                snippets: { "a/sig": "A", "b/sig": "B" },
                disabledGroups: ["a", "b"],
            } as unknown as SnipSidianSettings;
            expect(getDict(settings)).toEqual({});
        });
    });

    describe("getAllSnippetsFlat — disabledGroups (B-138)", () => {
        it("excludes a disabled group's entries from the picker feed", () => {
            const settings = {
                snippets: { "work/sig": "Best", "personal/todo": "- [ ] " },
                disabledGroups: ["work"],
            } as unknown as SnipSidianSettings;
            const result = getAllSnippetsFlat(settings);
            expect(result.find((s) => s.id === "user:work/sig")).toBeUndefined();
            expect(result.find((s) => s.id === "user:personal/todo")).toBeDefined();
        });

        it("an unrelated disabled group name has no effect", () => {
            const settings = {
                snippets: { "work/sig": "Best" },
                disabledGroups: ["other"],
            } as unknown as SnipSidianSettings;
            expect(getAllSnippetsFlat(settings)).toHaveLength(1);
        });
    });
});
