import { describe, it, expect } from "vitest";
import { forgetDeletedGroup, GroupManager, hasPatternRulesIn, renameGroupInSettings, type GroupSettings } from "./group-utils";

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

// B-265: snippet groups and pattern rules share one group namespace and one `disabledGroups` list.
describe("group helpers with pattern rules (B-265)", () => {
    const rule = (id: string, group?: string) => ({
        id,
        source: "/a/",
        replacement: "b",
        enabled: true,
        mode: "instant" as const,
        ...(group !== undefined ? { group } : {}),
    });

    describe("hasPatternRulesIn", () => {
        it("finds a rule filed under the group, and only that group", () => {
            const settings: GroupSettings = { patterns: [rule("1", "typo"), rule("2")] };
            expect(hasPatternRulesIn(settings, "typo")).toBe(true);
            expect(hasPatternRulesIn(settings, "other")).toBe(false);
        });

        it("is false with no patterns, for the empty (Ungrouped) slug, and ignores junk entries", () => {
            expect(hasPatternRulesIn({}, "typo")).toBe(false);
            expect(hasPatternRulesIn({ patterns: [rule("1")] }, "")).toBe(false);
            const junk = { patterns: [null, 5, "typo", rule("1", "typo")] } as unknown as GroupSettings;
            expect(hasPatternRulesIn(junk, "typo")).toBe(true);
            expect(hasPatternRulesIn({ patterns: [null] } as unknown as GroupSettings, "typo")).toBe(false);
        });
    });

    describe("forgetDeletedGroup", () => {
        it("drops the slug of a deleted group that has no pattern rules", () => {
            const settings: GroupSettings = { disabledGroups: ["work", "typo"], patterns: [rule("1", "other")] };
            forgetDeletedGroup(settings, "typo");
            expect(settings.disabledGroups).toEqual(["work"]);
        });

        it("keeps the slug while a pattern rule is still filed under the group (the rules stay off)", () => {
            const settings: GroupSettings = { disabledGroups: ["typo"], patterns: [rule("1", "typo")] };
            forgetDeletedGroup(settings, "typo");
            expect(settings.disabledGroups).toEqual(["typo"]);
            expect(settings.patterns).toHaveLength(1);
        });

        it("leaves the list alone when the group was not off", () => {
            const settings: GroupSettings = { disabledGroups: ["work"], patterns: [rule("1", "typo")] };
            forgetDeletedGroup(settings, "typo");
            expect(settings.disabledGroups).toEqual(["work"]);
            expect(() => forgetDeletedGroup({}, "typo")).not.toThrow();
        });
    });

    describe("renameGroupInSettings", () => {
        it("moves the off state to the new slug and renames the rules filed under the group", () => {
            const keep = rule("2", "other");
            const settings: GroupSettings = { disabledGroups: ["typo", "work"], patterns: [rule("1", "typo"), keep, rule("3")] };
            renameGroupInSettings(settings, "typo", "fixes");
            expect(settings.disabledGroups).toEqual(["work", "fixes"]);
            expect(settings.patterns?.map((r) => r.group)).toEqual(["fixes", "other", undefined]);
            // the untouched rules are the same objects, the renamed one is a new object (identity-based caches see it)
            expect(settings.patterns?.[1]).toBe(keep);
        });

        it("renames the rules of an enabled group without touching disabledGroups", () => {
            const settings: GroupSettings = { disabledGroups: ["work"], patterns: [rule("1", "typo")] };
            renameGroupInSettings(settings, "typo", "fixes");
            expect(settings.disabledGroups).toEqual(["work"]);
            expect(settings.patterns?.[0]?.group).toBe("fixes");
        });

        it("a disabled group with no pattern rules still carries its off state (B-138)", () => {
            const settings: GroupSettings = { disabledGroups: ["work"] };
            renameGroupInSettings(settings, "work", "office");
            expect(settings.disabledGroups).toEqual(["office"]);
            expect(settings.patterns).toBeUndefined();
        });

        it("does not duplicate the slug when the target group was already off", () => {
            const settings: GroupSettings = { disabledGroups: ["a", "b"], patterns: [rule("1", "a")] };
            renameGroupInSettings(settings, "a", "b");
            expect(settings.disabledGroups).toEqual(["b"]);
        });

        it("keeps the array when no rule is in the group", () => {
            const patterns = [rule("1", "other")];
            const settings: GroupSettings = { patterns };
            renameGroupInSettings(settings, "typo", "fixes");
            expect(settings.patterns).toBe(patterns);
        });

        it("renaming into Ungrouped keeps the rules under the old slug, and an off group stays off", () => {
            const patterns = [rule("1", "typo"), rule("2", "other")];
            const settings: GroupSettings = { disabledGroups: ["typo"], patterns };
            renameGroupInSettings(settings, "typo", "");
            // a rule with no group is always on: turning them out of the group would switch them on
            expect(settings.patterns).toBe(patterns);
            expect(settings.patterns?.[0]).toHaveProperty("group", "typo");
            expect(settings.disabledGroups).toEqual(["typo"]);
        });

        it("renaming into Ungrouped does not file the empty slug as off", () => {
            const settings: GroupSettings = { disabledGroups: ["typo"], patterns: [rule("1", "typo")] };
            renameGroupInSettings(settings, "typo", "");
            expect(settings.disabledGroups).not.toContain("");
        });

        it("renaming into Ungrouped with no rules left drops the stale off slug (as a delete does)", () => {
            const settings: GroupSettings = { disabledGroups: ["typo", "x"], patterns: [rule("1", "other")] };
            renameGroupInSettings(settings, "typo", "");
            expect(settings.disabledGroups).toEqual(["x"]);
        });
    });
});
