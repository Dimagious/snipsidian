import { describe, it, expect } from "vitest";
import { computeImportDiff, currentValuesForRejected, filterImportKeys } from "./import-diff";

/**
 * ADR-0005: tests pin the contract that `ImportPreviewModal` relies on
 * to show the user what merge vs replace will actually do. The
 * load-bearing assertion is the `removed` list — that's the difference
 * between merge (safe) and replace (destructive).
 */

describe("computeImportDiff", () => {
    it("classifies a new key as added", () => {
        const diff = computeImportDiff({}, { ":hi": "Hello" });
        expect(diff.added).toEqual([{ key: ":hi", value: "Hello" }]);
        expect(diff.conflicts).toEqual([]);
        expect(diff.removed).toEqual([]);
        expect(diff.unchangedCount).toBe(0);
    });

    it("classifies a same-value key as unchanged (not a conflict)", () => {
        const diff = computeImportDiff({ ":hi": "Hello" }, { ":hi": "Hello" });
        expect(diff.added).toEqual([]);
        expect(diff.conflicts).toEqual([]);
        expect(diff.removed).toEqual([]);
        expect(diff.unchangedCount).toBe(1);
    });

    it("classifies a different-value key as a conflict with both sides", () => {
        const diff = computeImportDiff({ ":hi": "Hello" }, { ":hi": "Hi" });
        expect(diff.added).toEqual([]);
        expect(diff.conflicts).toEqual([
            { key: ":hi", current: "Hello", incoming: "Hi" },
        ]);
        expect(diff.removed).toEqual([]);
    });

    it("flags current-only keys as removed (the replace-mode warning surface)", () => {
        // This is the load-bearing assertion: without `removed`, a user
        // who picks "Replace all" has no way to see they're about to
        // delete N snippets. This was the B-038 silent-wipe bug.
        const diff = computeImportDiff(
            { ":a": "1", ":b": "2", ":c": "3" },
            { ":a": "1" },
        );
        expect(diff.removed).toEqual([
            { key: ":b", value: "2" },
            { key: ":c", value: "3" },
        ]);
    });

    it("treats empty-string values as real values, not absence", () => {
        // The `in` operator differentiates {a:""} from {}, but
        // `current[key] !== value` could mishandle empties if we used
        // truthy checks. Pin the boundary.
        const diff = computeImportDiff({ ":x": "" }, { ":x": "" });
        expect(diff.unchangedCount).toBe(1);
        expect(diff.conflicts).toEqual([]);
    });

    it("handles a clean replace (no overlap)", () => {
        const diff = computeImportDiff(
            { ":a": "A", ":b": "B" },
            { ":c": "C", ":d": "D" },
        );
        expect(diff.added.map((x) => x.key)).toEqual([":c", ":d"]);
        expect(diff.removed.map((x) => x.key)).toEqual([":a", ":b"]);
        expect(diff.conflicts).toEqual([]);
        expect(diff.unchangedCount).toBe(0);
    });

    it("returns results sorted by key (deterministic for snapshot tests)", () => {
        const diff = computeImportDiff(
            { "z/c": "C", "a/b": "B" },
            { "z/c": "C2", "a/b": "B2", "m/x": "X" },
        );
        expect(diff.conflicts.map((x) => x.key)).toEqual(["a/b", "z/c"]);
        expect(diff.added.map((x) => x.key)).toEqual(["m/x"]);
    });

    it("treats the empty-import edge case as a full delete", () => {
        // A user dropping in `{}` should see every current snippet
        // listed as removed — they're about to wipe everything.
        const diff = computeImportDiff({ ":a": "A", ":b": "B" }, {});
        expect(diff.added).toEqual([]);
        expect(diff.removed.map((x) => x.key)).toEqual([":a", ":b"]);
        expect(diff.unchangedCount).toBe(0);
    });

    it("treats the empty-current edge case as a fresh install", () => {
        const diff = computeImportDiff({}, { ":a": "A", ":b": "B" });
        expect(diff.added.map((x) => x.key)).toEqual([":a", ":b"]);
        expect(diff.removed).toEqual([]);
        expect(diff.conflicts).toEqual([]);
    });

    it("does not mutate either input", () => {
        const current = { ":a": "A" };
        const incoming = { ":a": "B" };
        const currentSnapshot = JSON.stringify(current);
        const incomingSnapshot = JSON.stringify(incoming);
        computeImportDiff(current, incoming);
        expect(JSON.stringify(current)).toBe(currentSnapshot);
        expect(JSON.stringify(incoming)).toBe(incomingSnapshot);
    });
});

describe("filterImportKeys / computeImportDiff trigger checks (B-177)", () => {
    it.each(["-", "+", ">", "*", "|"])("rejects the bare structural trigger %s", (t) => {
        const { accepted, rejected } = filterImportKeys({ [t]: "x" });
        expect(accepted).toEqual({});
        expect(rejected).toEqual([
            { key: t, reason: expect.stringContaining("would rewrite Markdown") },
        ]);
    });

    it.each(["--", "->", ">=", "g/->"])("accepts %s", (k) => {
        expect(filterImportKeys({ [k]: "x" }).accepted).toEqual({ [k]: "x" });
    });

    it("checks the trigger part of a grouped key (g/- is rejected)", () => {
        expect(Object.keys(filterImportKeys({ "g/-": "x" }).accepted)).toEqual([]);
    });

    it("rejects `$`, spaces, nested `/` and an empty trigger", () => {
        const { accepted, rejected } = filterImportKeys({
            "a$b": "x",
            "a b": "x",
            "g/a/b": "x",
            "g/": "x",
        });
        expect(accepted).toEqual({});
        expect(rejected.map((r) => r.key).sort()).toEqual(["a b", "a$b", "g/", "g/a/b"]);
        expect(rejected.find((r) => r.key === "g/")?.reason).toBe("empty trigger");
    });

    it("rejects a replacement over 10000 characters and accepts exactly 10000", () => {
        const { accepted, rejected } = filterImportKeys({
            over: "a".repeat(10001),
            edge: "a".repeat(10000),
        });
        expect(Object.keys(accepted)).toEqual(["edge"]);
        expect(rejected[0]?.reason).toContain("10,001");
    });

    it("[S-014] accepts a 50 character trigger and rejects 51 (grouped key too)", () => {
        const { accepted, rejected } = filterImportKeys({
            ["a".repeat(50)]: "x",
            ["g/" + "b".repeat(51)]: "x",
        });
        expect(Object.keys(accepted)).toEqual(["a".repeat(50)]);
        expect(rejected.map((r) => r.reason)).toEqual(["trigger is longer than 50 characters"]);
    });

    it("imports keys with colons as-is (dead per B-183, but fixable there)", () => {
        const { accepted } = filterImportKeys({ ":smile:": "x", "emoji/:wave:": "y" });
        expect(Object.keys(accepted).sort()).toEqual([":smile:", "emoji/:wave:"]);
    });

    it("rejects a colon in the middle (the fixer cannot repair it)", () => {
        const { accepted, rejected } = filterImportKeys({ "a:b": "x", ":a:b:": "y", "g/a:b": "z" });
        expect(accepted).toEqual({});
        expect(rejected.length).toBe(3);
    });

    it("replace: an existing key rejected in the file is not listed as removed and keeps its current value", () => {
        const current = { "+": "old", gone: "g" };
        const diff = computeImportDiff(current, { "+": "new" });
        expect(diff.removed.map((r) => r.key)).toEqual(["gone"]);
        expect(currentValuesForRejected(current, diff.rejected)).toEqual({ "+": "old" });
    });

    it("a rejected key that is not in current is not carried over", () => {
        const diff = computeImportDiff({}, { "+": "new" });
        expect(currentValuesForRejected({}, diff.rejected)).toEqual({});
    });

    it("still rejects a colon-wrapped structural trigger and a colon-only key", () => {
        const { accepted } = filterImportKeys({ ":-:": "x", "::": "y" });
        expect(accepted).toEqual({});
    });

    it("has no count cap: 600 valid keys all import (S-010)", () => {
        const many: Record<string, string> = {};
        for (let i = 0; i < 600; i++) many[`k${i}`] = "v";
        const diff = computeImportDiff({}, many);
        expect(diff.added.length).toBe(600);
        expect(diff.rejected).toEqual([]);
    });

    it("treats __proto__ as an ordinary own key and never pollutes the prototype", () => {
        const incoming = JSON.parse('{"__proto__": "p", "ok": "v"}') as Record<string, string>;
        const { accepted } = filterImportKeys(incoming);
        expect(Object.prototype.hasOwnProperty.call(accepted, "__proto__")).toBe(true);
        expect(Object.getPrototypeOf(accepted)).toBe(Object.prototype);
        expect(({} as Record<string, unknown>)["p"]).toBeUndefined();
    });

    it("does not treat inherited names as existing keys (constructor, toString)", () => {
        const diff = computeImportDiff({}, { constructor: "a", toString: "b" });
        expect(diff.added.map((a) => a.key).sort()).toEqual(["constructor", "toString"]);
        expect(diff.conflicts).toEqual([]);
        expect(diff.unchangedCount).toBe(0);
    });

    it("does not count an inherited name as missing from incoming (removed list)", () => {
        const diff = computeImportDiff({ constructor: "x" }, {});
        expect(diff.removed).toEqual([{ key: "constructor", value: "x" }]);
    });

    it("replace mode: a rejected key never hides or deletes a valid existing key", () => {
        const diff = computeImportDiff({ keep: "1", old: "2" }, { keep: "1", "-": "x" });
        expect(diff.rejected.map((r) => r.key)).toEqual(["-"]);
        expect(diff.unchangedCount).toBe(1);
        expect(diff.removed.map((r) => r.key)).toEqual(["old"]);
    });
});
