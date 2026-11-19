import { describe, it, expect } from "vitest";
import {
    IMPORT_GROUP_MAX,
    planPatternImport,
    REASON_DUPLICATE,
    REASON_GROUP_EMPTY,
    REASON_GROUP_TOO_LONG,
    REASON_OVER_LIMIT,
    REASON_UNREADABLE,
} from "./espanso-pattern-plan";
import type { EspansoPatternCandidate } from "./espanso-regex";
import { MAX_PATTERN_RULES } from "../engine/patterns";
import type { PatternRule } from "../engine/types";
import type { SnipSidianSettings } from "../types";

/** ADR-0008, Imports: the duplicate check, the 100-rule cap, the group and the gate, decided before any write. */

function candidate(n: number, extra: Partial<EspansoPatternCandidate> = {}): EspansoPatternCandidate {
    return { label: `regex:r${n}`, source: `/r${n}$/`, replacement: `R${n}`, mode: "instant", ...extra };
}

function existingRule(n: number, extra: Partial<PatternRule> = {}): PatternRule {
    return { id: `old${n}`, source: `/old${n}$/`, replacement: `O${n}`, enabled: true, mode: "instant", ...extra };
}

function settingsWith(patterns: unknown): Pick<SnipSidianSettings, "patterns"> {
    return { patterns: patterns as PatternRule[] | undefined };
}

let counter = 0;
const nextId = (): string => `id${++counter}`;

describe("planPatternImport", () => {
    it("an empty group slug is refused as empty, not as too long", () => {
        const plan = planPatternImport([candidate(1)], "", settingsWith([]), nextId);
        expect(plan.add).toEqual([]);
        expect(plan.skipped).toEqual([{ label: "regex:r1", reason: REASON_GROUP_EMPTY }]);
        expect(REASON_GROUP_EMPTY).not.toContain("50");
    });

    it("adds each candidate as an enabled rule of the import's group, in file order, with its own unique id", () => {
        const plan = planPatternImport([candidate(1), candidate(2, { mode: "separator" })], "my-pack", settingsWith(undefined), nextId);
        expect(plan.skipped).toEqual([]);
        expect(plan.add.map((r) => [r.source, r.replacement, r.mode, r.enabled, r.group])).toEqual([
            ["/r1$/", "R1", "instant", true, "my-pack"],
            ["/r2$/", "R2", "separator", true, "my-pack"],
        ]);
        expect(new Set(plan.add.map((r) => r.id)).size).toBe(2);
        expect(plan.rows.map((r) => r.label)).toEqual(["regex:r1", "regex:r2"]);
    });

    it("carries the fallback note of a candidate into its preview row, and only there", () => {
        const plan = planPatternImport([candidate(1, { note: "Imported as After a separator: x." }), candidate(2)], "g", settingsWith([]), nextId);
        expect(plan.rows[0]?.note).toBe("Imported as After a separator: x.");
        expect(plan.rows[1]).not.toHaveProperty("note");
        expect(plan.add[0]).not.toHaveProperty("note");
    });

    it("does nothing for no candidates", () => {
        expect(planPatternImport([], "g", settingsWith(undefined))).toEqual({ add: [], rows: [], skipped: [] });
    });

    it("skips a rule with the same source and replacement that is already there, whatever its group or switch", () => {
        const have = [existingRule(1, { source: "/r1$/", replacement: "R1", group: "other", enabled: false })];
        const plan = planPatternImport([candidate(1), candidate(2)], "g", settingsWith(have), nextId);
        expect(plan.add.map((r) => r.source)).toEqual(["/r2$/"]);
        expect(plan.skipped).toEqual([{ label: "regex:r1", reason: REASON_DUPLICATE }]);
    });

    it("same source with another replacement is not a duplicate", () => {
        const have = [existingRule(1, { source: "/r1$/", replacement: "different" })];
        const plan = planPatternImport([candidate(1)], "g", settingsWith(have), nextId);
        expect(plan.add).toHaveLength(1);
    });

    it("the second of two identical entries of one file is the duplicate", () => {
        const plan = planPatternImport([candidate(1), candidate(1, { label: "regex:again" })], "g", settingsWith([]), nextId);
        expect(plan.add).toHaveLength(1);
        expect(plan.skipped).toEqual([{ label: "regex:again", reason: REASON_DUPLICATE }]);
    });

    it("a duplicate does not use up a slot of the cap", () => {
        const have = Array.from({ length: MAX_PATTERN_RULES - 1 }, (_, i) => existingRule(i));
        const plan = planPatternImport([candidate(1, { source: "/old0$/", replacement: "O0" }), candidate(2)], "g", settingsWith(have), nextId);
        expect(plan.add.map((r) => r.source)).toEqual(["/r2$/"]);
        expect(plan.skipped.map((s) => s.reason)).toEqual([REASON_DUPLICATE]);
    });

    it("stops at the 100 rule cap counting the rules already there, and names the rest", () => {
        const have = Array.from({ length: 98 }, (_, i) => existingRule(i));
        const plan = planPatternImport([candidate(1), candidate(2), candidate(3), candidate(4)], "g", settingsWith(have), nextId);
        expect(plan.add.map((r) => r.source)).toEqual(["/r1$/", "/r2$/"]);
        expect(plan.skipped).toEqual([
            { label: "regex:r3", reason: "over the 100 rule limit." },
            { label: "regex:r4", reason: "over the 100 rule limit." },
        ]);
        expect(REASON_OVER_LIMIT).toBe("over the 100 rule limit.");
        expect(98 + plan.add.length).toBe(MAX_PATTERN_RULES);
    });

    it("a full list takes nothing", () => {
        const have = Array.from({ length: MAX_PATTERN_RULES }, (_, i) => existingRule(i));
        const plan = planPatternImport([candidate(1)], "g", settingsWith(have), nextId);
        expect(plan.add).toEqual([]);
        expect(plan.skipped).toEqual([{ label: "regex:r1", reason: REASON_OVER_LIMIT }]);
    });

    it("exactly the last free slot is used", () => {
        const have = Array.from({ length: MAX_PATTERN_RULES - 1 }, (_, i) => existingRule(i));
        const plan = planPatternImport([candidate(1)], "g", settingsWith(have), nextId);
        expect(plan.add).toHaveLength(1);
    });

    it("runs the gate again: a candidate that would not compile is skipped, never added", () => {
        const bad = candidate(1, { source: "/(a+)+$/" });
        const plan = planPatternImport([bad, candidate(2)], "g", settingsWith([]), nextId);
        expect(plan.add.map((r) => r.source)).toEqual(["/r2$/"]);
        expect(plan.skipped[0]?.label).toBe("regex:r1");
        expect(plan.skipped[0]?.reason).toContain("repeated group");
    });

    it("the gate also covers the replacement (over the cap, half an emoji) and the mode", () => {
        const plan = planPatternImport(
            [candidate(1, { replacement: "x".repeat(10_001) }), candidate(2, { replacement: "\ud83d" }), candidate(3, { source: "/a+b+c+$/", mode: "instant" })],
            "g",
            settingsWith([]),
            nextId,
        );
        expect(plan.add).toEqual([]);
        expect(plan.skipped).toHaveLength(3);
    });

    it("never reuses an id that is already taken, even if the id source repeats itself", () => {
        const have = [existingRule(1, { id: "id1" })];
        counter = 0;
        const plan = planPatternImport([candidate(1), candidate(2)], "g", settingsWith(have), nextId);
        expect(plan.add.map((r) => r.id)).toEqual(["id2", "id3"]);
    });

    it("refuses everything for a group name over the limit", () => {
        const long = "g".repeat(IMPORT_GROUP_MAX + 1);
        const plan = planPatternImport([candidate(1)], long, settingsWith([]), nextId);
        expect(plan.add).toEqual([]);
        expect(plan.skipped).toEqual([{ label: "regex:r1", reason: REASON_GROUP_TOO_LONG }]);
        expect(planPatternImport([candidate(1)], "g".repeat(IMPORT_GROUP_MAX), settingsWith([]), nextId).add).toHaveLength(1);
    });

    it("an unreadable stored value is not overwritten: nothing is added", () => {
        for (const stored of ["junk", 42, { a: 1 }]) {
            const plan = planPatternImport([candidate(1)], "g", settingsWith(stored), nextId);
            expect(plan.add).toEqual([]);
            expect(plan.skipped).toEqual([{ label: "regex:r1", reason: REASON_UNREADABLE }]);
        }
    });

    it("copes with damaged stored entries: they count toward the cap but never crash the check", () => {
        const have = [null, "x", 3, { source: 5 }, existingRule(1)];
        const plan = planPatternImport([candidate(1)], "g", settingsWith(have), nextId);
        expect(plan.add).toHaveLength(1);
    });

    it("does not touch the settings it reads", () => {
        const have = [existingRule(1)];
        const before = JSON.stringify(have);
        planPatternImport([candidate(1)], "g", settingsWith(have), nextId);
        expect(JSON.stringify(have)).toBe(before);
    });
});
