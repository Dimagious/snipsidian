import { describe, it, expect } from "vitest";
import {
    buildBackupObject,
    INVALID_FILE_MESSAGE,
    INVALID_PATTERNS_MESSAGE,
    MAX_INCOMING_PATTERNS_EXAMINED,
    PATTERNS_EXPORT_KEY,
    planJsonPatternImport,
    readBackupFile,
} from "./json-backup";
import { filterImportKeys } from "../services/import-diff";
import { isRecordOfString } from "../shared/guards";
import { MAX_PATTERN_RULES } from "../engine/patterns";
import type { PatternRule } from "../engine/types";
import { REASON_OVER_LIMIT, REASON_UNREADABLE } from "./espanso-pattern-plan";
import { PATTERN_REASON_MESSAGES } from "./pattern-reasons";

const rule = (n: number, extra: Record<string, unknown> = {}): PatternRule => ({
    id: `r${n}`,
    source: `/x${n}$/`,
    replacement: `y${n}`,
    enabled: true,
    mode: "instant",
    ...extra,
});

let counter = 0;
const makeId = (): string => `new${++counter}`;

describe("buildBackupObject", () => {
    it("keeps the snippets flat and adds the rules as ONE string entry, exactly as stored", () => {
        const rules = [rule(1, { futureField: { a: 1 } }), rule(2, { enabled: false })];
        const backup = buildBackupObject({ snippets: { a: "1", "g/b": "2" }, patterns: rules });
        expect(Object.keys(backup)).toEqual(["a", "g/b", PATTERNS_EXPORT_KEY]);
        expect(JSON.parse(backup[PATTERNS_EXPORT_KEY] ?? "")).toEqual(rules);
    });

    it("is exactly the snippet map when no rules are stored (the file older Snipsy wrote)", () => {
        expect(buildBackupObject({ snippets: { a: "1" } })).toEqual({ a: "1" });
        expect(buildBackupObject({ snippets: { a: "1" }, patterns: [] })).toEqual({ a: "1" });
    });

    it("B-217: the applied-upgrades marker is settings state, never part of a backup", () => {
        const settings = { snippets: { a: "1" }, defaultsUpgraded: ["table@1.11.0"] };
        expect(buildBackupObject(settings)).toEqual({ a: "1" });
    });

    it("a stale snippet under the rules key is dropped when no rules are stored", () => {
        const backup = buildBackupObject({ snippets: { a: "1", [PATTERNS_EXPORT_KEY]: "stale text" } });
        expect(backup).toEqual({ a: "1" });
    });

    it("a stale snippet under the rules key never stands in for the rules", () => {
        const backup = buildBackupObject({ snippets: { a: "1", [PATTERNS_EXPORT_KEY]: "stale text" }, patterns: [rule(1)] });
        expect(JSON.parse(backup[PATTERNS_EXPORT_KEY] ?? "")).toEqual([rule(1)]);
        expect(readBackupFile(JSON.parse(JSON.stringify(backup)))).toEqual({ ok: true, snippets: { a: "1" }, patterns: [rule(1)] });
    });

    it("leaves out a stored value that is not a list", () => {
        const settings = { snippets: { a: "1" }, patterns: "junk" as unknown as PatternRule[] };
        expect(buildBackupObject(settings)).toEqual({ a: "1" });
    });

    it("an older Snipsy reads the file: still a record of strings, and the key is refused, not stored", () => {
        const backup = buildBackupObject({ snippets: { a: "1" }, patterns: [rule(1)] });
        // The released importer (1.7.0+): `isRecordOfString`, then `filterImportKeys`.
        expect(isRecordOfString(JSON.parse(JSON.stringify(backup)))).toBe(true);
        const { accepted, rejected } = filterImportKeys(backup);
        expect(accepted).toEqual({ a: "1" });
        expect(rejected.map((r) => r.key)).toEqual([PATTERNS_EXPORT_KEY]);
    });
});

describe("readBackupFile", () => {
    it("splits the rules out of the snippets", () => {
        const file = readBackupFile({ a: "1", [PATTERNS_EXPORT_KEY]: JSON.stringify([rule(1)]) });
        expect(file).toEqual({ ok: true, snippets: { a: "1" }, patterns: [rule(1)] });
    });

    it("a file without rules has patterns null (existing behaviour)", () => {
        expect(readBackupFile({ a: "1" })).toEqual({ ok: true, snippets: { a: "1" }, patterns: null });
    });

    it("reads a hand-written top-level patterns array", () => {
        expect(readBackupFile({ a: "1", patterns: [rule(1)] })).toEqual({ ok: true, snippets: { a: "1" }, patterns: [rule(1)] });
    });

    it("the snipsy patterns entry wins over a top-level patterns array, in either order", () => {
        const text = JSON.stringify([rule(1)]);
        const keyFirst = readBackupFile({ [PATTERNS_EXPORT_KEY]: text, patterns: [rule(2)] });
        const arrayFirst = readBackupFile({ patterns: [rule(2)], [PATTERNS_EXPORT_KEY]: text });
        expect(keyFirst).toEqual({ ok: true, snippets: {}, patterns: [rule(1)] });
        expect(arrayFirst).toEqual({ ok: true, snippets: {}, patterns: [rule(1)] });
    });

    it("a string under patterns is a snippet, not a rule list", () => {
        expect(readBackupFile({ patterns: "text" })).toEqual({ ok: true, snippets: { patterns: "text" }, patterns: null });
    });

    it.each([
        ["not JSON", "{oops"],
        ["not a list", '{"a":1}'],
    ])("refuses a rule entry that is %s, writing nothing", (_name, text) => {
        expect(readBackupFile({ a: "1", [PATTERNS_EXPORT_KEY]: text })).toEqual({ ok: false, message: INVALID_PATTERNS_MESSAGE });
    });

    it("refuses a rule entry that is not a string", () => {
        expect(readBackupFile({ [PATTERNS_EXPORT_KEY]: [rule(1)] })).toEqual({ ok: false, message: INVALID_PATTERNS_MESSAGE });
    });

    it("refuses what the old importer refused (a non-string value, null, an array of numbers is not special-cased)", () => {
        expect(readBackupFile({ a: 1 })).toEqual({ ok: false, message: INVALID_FILE_MESSAGE });
        expect(readBackupFile(null)).toEqual({ ok: false, message: INVALID_FILE_MESSAGE });
        expect(readBackupFile("x")).toEqual({ ok: false, message: INVALID_FILE_MESSAGE });
    });

    it("keeps a __proto__ key as a plain key (S-004)", () => {
        const parsed: unknown = JSON.parse('{"__proto__":"x","a":"1"}');
        const file = readBackupFile(parsed);
        expect(file.ok && Object.keys(file.snippets)).toEqual(["__proto__", "a"]);
        expect(Object.getPrototypeOf(file.ok ? file.snippets : null)).toBe(Object.prototype);
    });
});

describe("planJsonPatternImport: Merge", () => {
    it("appends rules the list lacks, keeps existing ones untouched, same order", () => {
        const existing = [rule(1), rule(2)];
        const plan = planJsonPatternImport([rule(3), rule(4)], "merge", { patterns: existing }, makeId);
        expect(plan.next).toEqual([rule(1), rule(2), rule(3), rule(4)]);
        expect(plan.next?.slice(0, 2)).toEqual(existing);
        expect(plan.rows.map((r) => r.source)).toEqual(["/x3$/", "/x4$/"]);
        expect(plan.skipped).toEqual([]);
    });

    it("leaves out a rule with the same source and replacement (counted, not an error), also twice in the file", () => {
        const dupOfExisting = { ...rule(9), source: "/x1$/", replacement: "y1" };
        const plan = planJsonPatternImport([dupOfExisting, rule(5), rule(6, { source: "/x5$/", replacement: "y5" })], "merge", { patterns: [rule(1)] }, makeId);
        expect(plan.next?.map((r) => r.id)).toEqual(["r1", "r5"]);
        expect(plan.unchanged).toBe(2);
    });

    it("same source with another replacement is a different rule", () => {
        const plan = planJsonPatternImport([{ ...rule(2), source: "/x1$/", replacement: "other" }], "merge", { patterns: [rule(1)] }, makeId);
        expect(plan.next).toHaveLength(2);
    });

    it("an incoming id that an existing rule has gets a fresh unique id; the existing rule keeps its own", () => {
        const plan = planJsonPatternImport([{ ...rule(2), id: "r1" }], "merge", { patterns: [rule(1)] }, makeId);
        expect(plan.next?.[0]).toEqual(rule(1));
        const added = plan.next?.[1];
        expect(added?.id).not.toBe("r1");
        expect(added?.id).toMatch(/^new/);
        expect(added?.enabled).toBe(true);
    });

    it("works when nothing is stored yet", () => {
        expect(planJsonPatternImport([rule(1)], "merge", {}, makeId).next).toEqual([rule(1)]);
    });
});

describe("planJsonPatternImport: Replace", () => {
    it("swaps the whole list and says how many rules go", () => {
        const plan = planJsonPatternImport([rule(7)], "replace", { patterns: [rule(1), rule(2)] }, makeId);
        expect(plan.next).toEqual([rule(7)]);
        expect(plan.removed).toBe(2);
    });

    it("a file with an empty list clears the rules", () => {
        expect(planJsonPatternImport([], "replace", { patterns: [rule(1)] }, makeId).next).toEqual([]);
    });

    it("keeps repeated rules of the file as written (a round trip is identical)", () => {
        const twin = { ...rule(2), source: "/x1$/", replacement: "y1" };
        expect(planJsonPatternImport([rule(1), twin], "replace", {}, makeId).next).toHaveLength(2);
    });
});

describe("planJsonPatternImport: the gate (S-009, S-015)", () => {
    it("names a refused rule with the sentence the Patterns page shows, and stores the others", () => {
        const redos = rule(2, { source: "/(a+)+$/" });
        const plan = planJsonPatternImport([rule(1), redos], "replace", {}, makeId);
        expect(plan.next).toEqual([rule(1)]);
        expect(plan.skipped).toEqual([
            {
                label: "/(a+)+$/",
                reason: PATTERN_REASON_MESSAGES.repeated_group({}),
            },
        ]);
        expect(plan.skipped[0]?.reason).toBe("A repeated group can't hold a repeat or a choice, like (a+)+. This can freeze typing. Use a class like [ab] instead.");
    });

    it.each([
        ["no end anchor", rule(1, { source: "/abc/" })],
        ["a flag the engine does not take", rule(1, { source: "/abc$/g" })],
        ["a backreference", rule(1, { source: "/(a)\\1$/" })],
        ["no replacement", { id: "r1", source: "/a$/", enabled: true }],
        ["a replacement over the limit", rule(1, { replacement: "x".repeat(10_001) })],
        ["a mode the engine does not know", rule(1, { mode: "sometimes" })],
        ["a non-object entry", "text"],
        ["null", null],
    ])("refuses %s and writes nothing for it", (_name, entry) => {
        const plan = planJsonPatternImport([entry], "replace", {}, makeId);
        expect(plan.next).toEqual([]);
        expect(plan.skipped).toHaveLength(1);
        expect(plan.skipped[0]?.reason).not.toBe("");
    });

    it("a rule without an id is stored switched OFF with a fresh id; one with an id keeps its enabled", () => {
        const { id: _drop, ...noId } = rule(1);
        const plan = planJsonPatternImport([noId, rule(2)], "replace", {}, makeId);
        expect(plan.next?.[0]).toMatchObject({ source: "/x1$/", enabled: false });
        expect(plan.next?.[0]?.id).toMatch(/^new/);
        expect(plan.next?.[1]).toEqual(rule(2));
    });

    it("two incoming rules with one id: the twin gets a fresh id", () => {
        const plan = planJsonPatternImport([rule(1), { ...rule(2), id: "r1" }], "replace", {}, makeId);
        expect(new Set(plan.next?.map((r) => r.id)).size).toBe(2);
    });

    it("500 rules: only 100 are stored (Replace), the rest are named over the limit", () => {
        const many = Array.from({ length: 500 }, (_, i) => rule(i));
        const plan = planJsonPatternImport(many, "replace", {}, makeId);
        expect(plan.next).toHaveLength(MAX_PATTERN_RULES);
        expect(plan.skipped).toHaveLength(400);
        expect(plan.skipped.every((s) => s.reason === REASON_OVER_LIMIT)).toBe(true);
    });

    it("Merge counts the rules you already have against the cap", () => {
        const existing = Array.from({ length: 95 }, (_, i) => rule(i));
        const incoming = Array.from({ length: 10 }, (_, i) => rule(1000 + i));
        const plan = planJsonPatternImport(incoming, "merge", { patterns: existing }, makeId);
        expect(plan.next).toHaveLength(MAX_PATTERN_RULES);
        expect(plan.rows).toHaveLength(5);
        expect(plan.skipped).toHaveLength(5);
    });

    it("a hostile file does not compile past the examined limit (a million refused rules)", () => {
        const bad = rule(0, { source: "/(a+)+$/" });
        const plan = planJsonPatternImport(Array.from({ length: 5_000 }, () => bad), "replace", {}, makeId);
        expect(plan.next).toEqual([]);
        expect(plan.skipped).toHaveLength(5_000);
        expect(plan.skipped.filter((s) => s.reason === REASON_OVER_LIMIT)).toHaveLength(5_000 - MAX_INCOMING_PATTERNS_EXAMINED);
    });

    it("a stored value that is not a list is never overwritten: next is null, every rule is named", () => {
        for (const mode of ["merge", "replace"] as const) {
            const plan = planJsonPatternImport([rule(1)], mode, { patterns: { a: 1 } as unknown as PatternRule[] }, makeId);
            expect(plan.next).toBeNull();
            expect(plan.skipped).toEqual([{ label: "/x1$/", reason: REASON_UNREADABLE }]);
        }
    });

    it("labels an entry with no pattern by its position", () => {
        const plan = planJsonPatternImport([rule(1), 5], "replace", {}, makeId);
        expect(plan.skipped[0]?.label).toBe("Entry 2");
    });
});

describe("export then import (Replace) gives back identical rules", () => {
    it("including unknown fields, enabled: false, mode and group", () => {
        const rules = [
            rule(1, { futureField: [1, 2, { x: "y" }], group: "typography" }),
            rule(2, { enabled: false, mode: "separator" }),
        ];
        const backup = JSON.parse(JSON.stringify(buildBackupObject({ snippets: { a: "1" }, patterns: rules }))) as unknown;
        const file = readBackupFile(backup);
        if (!file.ok || file.patterns === null) throw new Error("expected a readable file with rules");
        const plan = planJsonPatternImport(file.patterns, "replace", { patterns: [rule(9)] }, makeId);
        expect(plan.next).toEqual(rules);
        expect(plan.skipped).toEqual([]);
    });
});
