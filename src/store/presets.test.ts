import { describe, it, expect } from "vitest";
import * as storePresets from "./presets";
import * as rootPresets from "../presets";
import {
    DEFAULT_SNIPPETS_GROUP,
    defaultSnippetsAsGroup,
    planRestoreDefaults,
} from "./presets";
import { DEFAULT_SNIPPETS } from "../presets";

describe("store/presets re-export", () => {
    it("re-exports DEFAULT_SNIPPETS from root presets", () => {
        expect(storePresets).toHaveProperty("DEFAULT_SNIPPETS");
        expect(storePresets.DEFAULT_SNIPPETS).toBe(rootPresets.DEFAULT_SNIPPETS);
    });
});

describe("defaultSnippetsAsGroup (B-131)", () => {
    it("re-keys every default under the defaults group", () => {
        const grouped = defaultSnippetsAsGroup();
        const entries = Object.entries(grouped);
        expect(entries.length).toBe(Object.keys(DEFAULT_SNIPPETS).length);
        for (const [key, replacement] of entries) {
            expect(key.startsWith(`${DEFAULT_SNIPPETS_GROUP}/`)).toBe(true);
            const trigger = key.slice(DEFAULT_SNIPPETS_GROUP.length + 1);
            expect(replacement).toBe(DEFAULT_SNIPPETS[trigger]);
        }
    });

    it("returns a fresh object on each call (no shared mutable state)", () => {
        const a = defaultSnippetsAsGroup();
        const b = defaultSnippetsAsGroup();
        expect(a).not.toBe(b);
        a[`${DEFAULT_SNIPPETS_GROUP}/todo`] = "mutated";
        expect(b[`${DEFAULT_SNIPPETS_GROUP}/todo`]).toBe(DEFAULT_SNIPPETS.todo);
    });
});

describe("planRestoreDefaults (B-131)", () => {
    it("returns every default for an empty store", () => {
        expect(planRestoreDefaults({})).toEqual(DEFAULT_SNIPPETS);
    });

    it("returns nothing when all defaults are present in the defaults group", () => {
        expect(planRestoreDefaults(defaultSnippetsAsGroup())).toEqual({});
    });

    it("skips a trigger that exists as a bare pre-1.2.0 ungrouped key", () => {
        const plan = planRestoreDefaults({ todo: "- [ ] $|" });
        expect(plan.todo).toBeUndefined();
        expect(plan.done).toBe(DEFAULT_SNIPPETS.done);
    });

    it("skips a trigger the user moved into their own group", () => {
        const plan = planRestoreDefaults({ "my-stuff/note": "custom callout" });
        expect(plan.note).toBeUndefined();
    });

    it("does not resurrect a user-modified default (delete-first contract)", () => {
        const plan = planRestoreDefaults({
            [`${DEFAULT_SNIPPETS_GROUP}/now`]: "my own replacement",
        });
        expect(plan.now).toBeUndefined();
    });

    it("plans only the missing subset", () => {
        const current = defaultSnippetsAsGroup();
        delete current[`${DEFAULT_SNIPPETS_GROUP}/now`];
        delete current[`${DEFAULT_SNIPPETS_GROUP}/today`];
        const plan = planRestoreDefaults(current);
        expect(plan).toEqual({ now: DEFAULT_SNIPPETS.now, today: DEFAULT_SNIPPETS.today });
    });

    it("returns bare trigger keys, not group-prefixed keys", () => {
        const plan = planRestoreDefaults({});
        for (const key of Object.keys(plan)) {
            expect(key.includes("/")).toBe(false);
        }
    });
});
