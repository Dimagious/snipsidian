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

describe("install-plan.isPackageInstalled (B-017: key-presence only)", () => {
    it("returns true when at least one pack key is present in current snippets", () => {
        expect(
            isPackageInstalled(
                { a: "1", b: "2", c: "3" },
                "Pack",
                { "Pack/a": "1" },
            ),
        ).toBe(true);
    });

    it("returns true at 100% match (every key + value identical)", () => {
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

    it("ignores values entirely — any pack key with ANY value counts as installed (B-017)", () => {
        // The old ≥80%-value-match heuristic flipped the badge back
        // to "Install" the moment the user edited a few rows, which
        // tempted them to re-install and silently lose their edits.
        // The new contract: user edits are still "installed".
        expect(
            isPackageInstalled(
                { a: "1", b: "2", c: "3" },
                "Pack",
                { "Pack/a": "USER EDIT", "Pack/b": "USER EDIT 2", "Pack/c": "USER EDIT 3" },
            ),
        ).toBe(true);
    });

    it("returns true with only 1 of N keys present (partial install / partial uninstall)", () => {
        const triggers = { a: "1", b: "2", c: "3", d: "4", e: "5" };
        const current = {
            "Pack/a": "1",
            // b, c, d, e all missing — 1 of 5 still counts
        };
        expect(isPackageInstalled(triggers, "Pack", current)).toBe(true);
    });

    it("returns false when NO pack key is present (matches the fresh-install case)", () => {
        const triggers = { a: "1", b: "2" };
        const current = {
            // None of the Pack/* keys present
            "OtherPack/a": "1",
            "OtherPack/b": "2",
        };
        expect(isPackageInstalled(triggers, "Pack", current)).toBe(false);
    });

    it("zero-trigger packages report false (matches the no-snippets-to-install Notice path)", () => {
        expect(isPackageInstalled({}, "Pack", {})).toBe(false);
    });

    it("[B-017 regression] user-edited row surfaces as a conflict in buildPackageDiff so reinstall preserves it by default", () => {
        // The end-to-end behaviour B-017 is about: user installed
        // a pack, edited one row, then reinstalls. The diff must
        // surface the edit as a CONFLICT (not silently overwrite).
        // PackagePreviewModal then renders the conflict with
        // "Keep current" as the default, so a click-through
        // "Reinstall → Apply" preserves the user's edit.
        const pack = { todo: "- [ ]", done: "- [x]" };
        const current = {
            "Markdown/todo": "- [ ] !!!", // user edit
            "Markdown/done": "- [x]",     // untouched
        };

        // The pack is still considered installed even with the edit.
        expect(isPackageInstalled(pack, "Markdown", current)).toBe(true);

        // And the diff shows the edit as a recoverable conflict.
        const diff = buildPackageDiff(pack, "Markdown", current);
        expect(diff.added).toEqual([]);
        expect(diff.conflicts).toEqual([
            { key: "Markdown/todo", incoming: "- [ ]", current: "- [ ] !!!" },
        ]);
    });
});
