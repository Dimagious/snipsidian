import { describe, it, expect } from "vitest";
import { GroupManager } from "./group-utils";

describe("GroupManager.allGroupsFrom", () => {
    it("uses empty key for ungrouped snippets", () => {
        const manager = new GroupManager();
        const groups = manager.allGroupsFrom({
            hello: "world",
            "dev/fn": "snippet",
            "Ungrouped/tool": "actual group",
        });

        expect(groups).toEqual(["", "dev", "Ungrouped"]);
    });

    it("returns empty list for empty snippet map", () => {
        const manager = new GroupManager();
        expect(manager.allGroupsFrom({})).toEqual([]);
    });
});

describe("GroupManager.bulkMoveKeys", () => {
    it("moves keys in provided snippet map", () => {
        const manager = new GroupManager();
        const snippets = {
            "alpha/a": "1",
            "alpha/b": "2",
            c: "3",
        };

        const result = manager.bulkMoveKeys(snippets, "beta", ["alpha/a", "c"]);

        expect(result).toEqual({ moved: 2, skipped: 0 });
        expect(snippets).toEqual({
            "alpha/b": "2",
            "beta/a": "1",
            "beta/c": "3",
        });
    });
});

// Regression: security S-004 — `in` operator walks the prototype chain,
// so `"toString" in {}` returns true. Renaming to a name that matches an
// inherited prototype member would false-positive a collision. After the
// `hasOwnProperty.call` fix this passes cleanly.
describe("GroupManager — prototype-chain ghost-collision (S-004)", () => {
    it("safeRenameKey allows renaming to a prototype-name like 'toString'", () => {
        const manager = new GroupManager();
        const snippets: Record<string, string> = { ":a": "value" };
        const r = manager.safeRenameKey(snippets, ":a", "toString");
        expect(r.ok).toBe(true);
        expect(snippets.toString).toBe("value");
        expect(snippets[":a"]).toBeUndefined();
    });

    it("bulkMoveKeys does not skip an own key just because it matches a prototype name", () => {
        const manager = new GroupManager();
        const snippets: Record<string, string> = { "alpha/toString": "shadow" };
        const r = manager.bulkMoveKeys(snippets, "beta", ["alpha/toString"]);
        expect(r).toEqual({ moved: 1, skipped: 0 });
        expect(snippets["beta/toString"]).toBe("shadow");
    });

    it("bulkMoveKeys SKIPS keys whose target already exists outside the source set", () => {
        // Pre-seed a non-source key at the proposed target. bulkMoveKeys
        // must not overwrite — that's the data-loss path the S-004 defence
        // guards against. Source stays in place; `skipped` counts it.
        const manager = new GroupManager();
        const snippets: Record<string, string> = {
            "alpha/dup": "from-alpha",
            "beta/dup": "already-there",
        };
        const r = manager.bulkMoveKeys(snippets, "beta", ["alpha/dup"]);
        expect(r).toEqual({ moved: 0, skipped: 1 });
        expect(snippets["beta/dup"]).toBe("already-there");
        expect(snippets["alpha/dup"]).toBe("from-alpha");
    });

    it("displayGroupTitle on the class delegates to the standalone helper", () => {
        const manager = new GroupManager();
        expect(manager.displayGroupTitle("my-group-name")).toBe("My Group Name");
        expect(manager.displayGroupTitle("dev/fn")).toBe("Dev");
    });
});
