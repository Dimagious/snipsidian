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
