import { describe, it, expect } from "vitest";
import { MAX_PATTERN_RULES } from "../engine/patterns";
import type { PatternRule } from "../engine/types";
import {
    addMissingStarter,
    appendRule,
    canAddRules,
    commitPatterns,
    formatPatternsSummary,
    freeSlots,
    describeUnreadable,
    locateRule,
    missingStarterRules,
    patternsUnreadable,
    readPatterns,
    moveRule,
    withUniqueIds,
    moveRuleTo,
    newPatternId,
    removeRule,
    replaceRule,
} from "./pattern-list";
import { STARTER_RULES } from "./pattern-starter";

const rule = (id: string, extra: Partial<PatternRule> = {}): PatternRule => ({
    id,
    source: `/${id}$/`,
    replacement: id.toUpperCase(),
    enabled: true,
    mode: "instant",
    ...extra,
});
const ids = (list: readonly PatternRule[] | null): string[] => (list ?? []).map((r) => r.id);
const many = (n: number): PatternRule[] => Array.from({ length: n }, (_, i) => rule(`r${i}`));

describe("pattern list operations", () => {
    it("newPatternId is stable text and differs between calls", () => {
        const a = newPatternId(() => 0.1, () => 1000);
        const b = newPatternId(() => 0.2, () => 1000);
        expect(a).toMatch(/^p[0-9a-z]+$/);
        expect(a).not.toBe(b);
    });

    it("appends at the end, up to the cap, and not past it", () => {
        expect(ids(appendRule([rule("a")], rule("b")))).toEqual(["a", "b"]);
        expect(appendRule(many(MAX_PATTERN_RULES - 1), rule("x"))).toHaveLength(MAX_PATTERN_RULES);
        expect(appendRule(many(MAX_PATTERN_RULES), rule("x"))).toBeNull();
        expect(freeSlots(many(MAX_PATTERN_RULES))).toBe(0);
        expect(freeSlots(many(120))).toBe(0);
        expect(canAddRules(many(98), 2)).toBe(true);
        expect(canAddRules(many(98), 3)).toBe(false);
    });

    it("replaces and removes the slot at an index without touching the others", () => {
        const list = [rule("a"), rule("b"), rule("c")];
        expect(replaceRule(list, 1, rule("b", { replacement: "new" }))?.map((r) => r.replacement)).toEqual(["A", "new", "C"]);
        expect(replaceRule(list, 3, rule("z"))).toBeNull();
        expect(replaceRule(list, -1, rule("z"))).toBeNull();
        expect(ids(removeRule(list, 1))).toEqual(["a", "c"]);
        expect(ids(removeRule(list, 9))).toEqual(["a", "b", "c"]);
    });

    it("replaceRule changes only the slot, not every entry with the same id (sync and hand edits can duplicate ids)", () => {
        const list = [rule("a", { replacement: "first" }), rule("a", { replacement: "second" })];
        expect(replaceRule(list, 1, rule("a", { replacement: "edited" }))?.map((r) => r.replacement)).toEqual(["first", "edited"]);
    });

    it("moves one place and refuses at the edges", () => {
        const list = [rule("a"), rule("b"), rule("c")];
        expect(ids(moveRule(list, 1, -1))).toEqual(["b", "a", "c"]);
        expect(ids(moveRule(list, 1, 1))).toEqual(["a", "c", "b"]);
        expect(moveRule(list, 0, -1)).toBeNull();
        expect(moveRule(list, 2, 1)).toBeNull();
        expect(moveRule(list, 7, 1)).toBeNull();
    });

    it("moves to an index for drag and drop, clamped, null when nothing changes", () => {
        const list = [rule("a"), rule("b"), rule("c")];
        expect(ids(moveRuleTo(list, 0, 2))).toEqual(["b", "c", "a"]);
        expect(ids(moveRuleTo(list, 2, 0))).toEqual(["c", "a", "b"]);
        expect(ids(moveRuleTo(list, 0, 99))).toEqual(["b", "c", "a"]);
        expect(moveRuleTo(list, 1, 1)).toBeNull();
        expect(moveRuleTo(list, 9, 0)).toBeNull();
    });

    it("locateRule finds an entry by its id, skipping entries that are not objects; -1 when absent", () => {
        const list: unknown[] = [null, rule("a"), "x", rule("b")];
        expect(locateRule(list, "a")).toBe(1);
        expect(locateRule(list, "b")).toBe(3);
        expect(locateRule(list, "nope")).toBe(-1);
        expect(locateRule(list, "")).toBe(-1);
    });

    it("withUniqueIds gives id-less and repeated ids a fresh unique id on a copy and leaves the rest alone", () => {
        const first = rule("a");
        const twin = rule("a", { source: "/t$/" });
        const noId = { source: "/x$/" };
        const numeric = { id: 5, source: "/n$/" };
        const input: unknown[] = [first, twin, noId, null, "s", numeric, rule("b")];
        let n = 0;
        const out = withUniqueIds(input, () => `f${n++}`) as unknown[];
        expect(out[0]).toBe(first);
        expect(out[1]).toEqual({ ...twin, id: "f0" });
        // No string id: the engine skipped it, so the copy is off. A twin keeps its `enabled`.
        expect(out[2]).toEqual({ source: "/x$/", id: "f1", enabled: false });
        expect(out[3]).toBeNull();
        expect(out[4]).toBe("s");
        expect(out[5]).toEqual({ id: "f2", source: "/n$/", enabled: false });
        expect(out[6]).toBe(input[6]);
        // The stored entries are not touched.
        expect(twin.id).toBe("a");
        expect(noId).toEqual({ source: "/x$/" });
        const ids = (out as Array<{ id?: string } | null | string>).flatMap((e) => (typeof e === "object" && e !== null ? [e.id] : []));
        expect(new Set(ids).size).toBe(ids.length);
    });

    it("withUniqueIds turns an id-less rule off even when it was on, and leaves a twin's enabled alone", () => {
        const input: unknown[] = [{ source: "/x$/", enabled: true }, { id: "", source: "/y$/", enabled: true }, rule("a"), rule("a", { enabled: true })];
        const out = withUniqueIds(input) as Array<{ enabled: boolean }>;
        expect(out.map((e) => e.enabled)).toEqual([false, false, true, true]);
    });

    it("withUniqueIds never hands out an id a later entry already has", () => {
        const input: unknown[] = [{ source: "/x$/" }, rule("f0")];
        let n = 0;
        const out = withUniqueIds(input, () => `f${n++}`) as Array<{ id: string }>;
        expect(out.map((e) => e.id)).toEqual(["f1", "f0"]);
    });

    it("describeUnreadable stringifies, cuts long values and survives what JSON cannot hold", () => {
        expect(describeUnreadable({ a: 1 })).toBe('{"a":1}');
        expect(describeUnreadable("x".repeat(600), 10)).toBe(`"xxxxxxxxx... (602 characters)`);
        const circular: Record<string, unknown> = {};
        circular.self = circular;
        expect(describeUnreadable(circular)).toBe("[object Object]");
        expect(describeUnreadable(undefined)).toBe("undefined");
    });

    it("readPatterns reads anything but an array as empty; patternsUnreadable flags it", () => {
        const odd: unknown[] = [{}, "x", 5, true];
        for (const value of odd) {
            const settings = { patterns: value } as unknown as { patterns?: PatternRule[] };
            expect(readPatterns(settings)).toEqual([]);
            expect(patternsUnreadable(settings)).toBe(true);
        }
        const list = [rule("a")];
        expect(readPatterns({ patterns: list })).toBe(list);
        for (const patterns of [undefined, null, list]) {
            expect(patternsUnreadable({ patterns } as { patterns?: PatternRule[] })).toBe(false);
        }
        expect(readPatterns({})).toEqual([]);
    });

    it("lists the starter rules a list lacks, by pattern", () => {
        expect(missingStarterRules([])).toHaveLength(32);
        const first = STARTER_RULES[0]!;
        // An edited replacement still counts as having the rule.
        const have = [rule("x", { source: first.source, replacement: "mine" })];
        expect(missingStarterRules(have)).toHaveLength(31);
        expect(missingStarterRules(have).some((r) => r.source === first.source)).toBe(false);
    });

    it("adds only the missing starter rules, enabled, in order, with new ids", () => {
        let n = 0;
        const next = addMissingStarter([rule("mine")], () => `id${n++}`);
        expect(next).toHaveLength(33);
        expect(next?.[1]).toMatchObject({ id: "id0", enabled: true, group: "typography", source: STARTER_RULES[0]!.source });
        expect(addMissingStarter(next ?? [], () => "again")).toBeNull();
    });

    it("does not add the starter set when it does not fit (the button is disabled)", () => {
        expect(addMissingStarter(many(70), () => "x")).toBeNull();
        expect(addMissingStarter(many(68), () => "x")).toHaveLength(100);
    });

    it("formats the page entry value", () => {
        expect(formatPatternsSummary(0, 0)).toBe("No rules");
        expect(formatPatternsSummary(1, 0)).toBe("1 rule");
        expect(formatPatternsSummary(12, 0)).toBe("12 rules");
        expect(formatPatternsSummary(12, 1)).toBe("12 rules, 1 with an error");
        expect(formatPatternsSummary(3, 3)).toBe("3 rules, 3 with an error");
    });
});

describe("commitPatterns", () => {
    it("assigns and saves", async () => {
        const settings: { patterns?: PatternRule[] } = {};
        let saved: PatternRule[] | undefined;
        await commitPatterns(settings, [rule("a")], () => {
            saved = settings.patterns;
            return Promise.resolve();
        });
        expect(ids(settings.patterns ?? null)).toEqual(["a"]);
        expect(ids(saved ?? null)).toEqual(["a"]);
    });

    it("puts the previous list back when the save rejects, and rethrows", async () => {
        const before = [rule("old")];
        const settings: { patterns?: PatternRule[] } = { patterns: before };
        await expect(commitPatterns(settings, [rule("new")], () => Promise.reject(new Error("disk full")))).rejects.toThrow("disk full");
        expect(settings.patterns).toBe(before);
    });

    it("does not undo a newer list when its own save rejects", async () => {
        const settings: { patterns?: PatternRule[] } = { patterns: [rule("old")] };
        const newer = [rule("newer")];
        await expect(
            commitPatterns(settings, [rule("new")], () => {
                settings.patterns = newer;
                return Promise.reject(new Error("disk full"));
            }),
        ).rejects.toThrow("disk full");
        expect(settings.patterns).toBe(newer);
    });
});
