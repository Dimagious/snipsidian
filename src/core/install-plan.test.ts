import { describe, it, expect } from "vitest";
import { buildPackageDiff, isPackageInstalled } from "./install-plan";

describe("install-plan.buildPackageDiff", () => {
    it("splits incoming snippets into added vs conflicts, prefixed by group", () => {
        const incoming = { todo: "- [ ]", done: "- [x]" };
        const current = { "Markdown/done": "- [DONE]" };
        const diff = buildPackageDiff(incoming, "Markdown", current);

        expect(diff.added).toEqual([{ key: "Markdown/todo", value: "- [ ]" }]);
        expect(diff.conflicts).toEqual([
            { key: "Markdown/done", incoming: "- [x]", current: "- [DONE]" },
        ]);
    });

    it("returns empty added + conflicts for an empty incoming package", () => {
        const diff = buildPackageDiff({}, "Anything", { foo: "bar" });
        expect(diff.added).toEqual([]);
        expect(diff.conflicts).toEqual([]);
    });

    it("skips entries that already match exactly (no-op re-install)", () => {
        const incoming = { todo: "- [ ]" };
        const current = { "Markdown/todo": "- [ ]" };
        const diff = buildPackageDiff(incoming, "Markdown", current);
        expect(diff.added).toEqual([]);
        expect(diff.conflicts).toEqual([]);
    });

    it("applies group prefix via joinKey (no slashes leak into trigger keys)", () => {
        // A package label with spaces in it should be passed through
        // joinKey untouched; the diff produces `<label>/<trigger>` keys.
        const diff = buildPackageDiff(
            { hello: "world" },
            "My Pack — Edition 2",
            {},
        );
        expect(diff.added).toEqual([
            { key: "My Pack — Edition 2/hello", value: "world" },
        ]);
    });

    it("prototype-shaped trigger keys are passed through as plain own properties", () => {
        // `validatePackageForInstall` rejects prototype-pollution attempts
        // upstream, but pin the behaviour at this layer too: the diff
        // function must not mutate Object.prototype and must report the
        // weird keys as added under the group prefix.
        //
        // Use JSON.parse to construct the input — an object literal
        // `{__proto__: ...}` would invoke the prototype setter rather
        // than create an own property. JSON.parse is the realistic
        // attack surface (YAML pack → object → here).
        const before = Object.prototype.toString;
        const incoming = JSON.parse(
            '{"__proto__":"evil","constructor":"also evil"}',
        ) as Record<string, string>;
        const diff = buildPackageDiff(incoming, "Group", {});
        expect(Object.prototype.toString).toBe(before);
        const keys = diff.added.map((a) => a.key).sort();
        expect(keys).toEqual(["Group/__proto__", "Group/constructor"].sort());
    });
});

describe("install-plan.isPackageInstalled", () => {
    it("returns true when 100% of triggers match (exact same values)", () => {
        expect(
            isPackageInstalled(
                { a: "1", b: "2", c: "3" },
                "Pack",
                { "Pack/a": "1", "Pack/b": "2", "Pack/c": "3" },
            ),
        ).toBe(true);
    });

    it("returns false for undefined or empty snippet map", () => {
        expect(isPackageInstalled(undefined, "Pack", { "Pack/a": "1" })).toBe(false);
        expect(isPackageInstalled({}, "Pack", { "Pack/a": "1" })).toBe(false);
    });

    it("returns true at the 80% boundary (4 of 5 match)", () => {
        const triggers = { a: "1", b: "2", c: "3", d: "4", e: "5" };
        const current = {
            "Pack/a": "1",
            "Pack/b": "2",
            "Pack/c": "3",
            "Pack/d": "4",
            // e missing — 4 of 5 = exactly 80%
        };
        expect(isPackageInstalled(triggers, "Pack", current)).toBe(true);
    });

    it("returns false just under the 80% boundary (3 of 5 match)", () => {
        const triggers = { a: "1", b: "2", c: "3", d: "4", e: "5" };
        const current = {
            "Pack/a": "1",
            "Pack/b": "2",
            "Pack/c": "3",
            // d, e missing — 3 of 5 = 60%
        };
        expect(isPackageInstalled(triggers, "Pack", current)).toBe(false);
    });

    it("counts a user-edited entry as NOT installed (value mismatch)", () => {
        // If the user edited one entry in a 5-pack to a different
        // replacement, that entry no longer counts toward the
        // heuristic. 4 unedited of 5 = still installed (80% boundary).
        const triggers = { a: "1", b: "2", c: "3", d: "4", e: "5" };
        const current = {
            "Pack/a": "1",
            "Pack/b": "2",
            "Pack/c": "3",
            "Pack/d": "4",
            "Pack/e": "USER EDIT", // value differs from pack
        };
        expect(isPackageInstalled(triggers, "Pack", current)).toBe(true);

        // Two edits drops to 3/5 = 60% — flips to false.
        const moreEdited = {
            ...current,
            "Pack/d": "USER EDIT 2",
        };
        expect(isPackageInstalled(triggers, "Pack", moreEdited)).toBe(false);
    });

    it("zero-trigger packages report false (matches the no-snippets-to-install Notice path)", () => {
        expect(isPackageInstalled({}, "Pack", {})).toBe(false);
    });
});
