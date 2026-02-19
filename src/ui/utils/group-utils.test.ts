import { describe, it, expect } from "vitest";
import { GroupManager } from "./group-utils";

describe("GroupManager.allGroupsFrom", () => {
    it("uses empty key for ungrouped snippets", () => {
        const manager = new GroupManager({});
        const groups = manager.allGroupsFrom({
            hello: "world",
            "dev/fn": "snippet",
            "Ungrouped/tool": "actual group",
        });

        expect(groups).toEqual(["", "dev", "Ungrouped"]);
    });

    it("returns empty list for empty snippet map", () => {
        const manager = new GroupManager({});
        expect(manager.allGroupsFrom({})).toEqual([]);
    });
});
