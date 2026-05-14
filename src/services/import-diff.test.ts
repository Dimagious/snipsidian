import { describe, it, expect } from "vitest";
import { computeImportDiff } from "./import-diff";

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
