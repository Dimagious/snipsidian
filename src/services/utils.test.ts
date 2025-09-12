import { describe, it, expect } from "vitest";
import {
    diffIncoming,
    isRecordOfString,
    normalizeTrigger,
    isBadTrigger,
    splitKey,
    joinKey,
    slugifyGroup,
    displayGroupTitle,
} from "./utils";

describe("utils.diffIncoming", () => {
    it("splits incoming into added and conflicts", () => {
        const incoming = { a: "1", b: "2", c: "3" };
        const current = { b: "B", d: "4" };
        const r = diffIncoming(incoming, current);

        expect(r.added).toEqual(
            expect.arrayContaining([
                { key: "a", value: "1" },
                { key: "c", value: "3" },
            ])
        );
        expect(r.added).toHaveLength(2);

        expect(r.conflicts).toEqual(
            expect.arrayContaining([
                { key: "b", incoming: "2", current: "B" },
            ])
        );
        expect(r.conflicts).toHaveLength(1);
    });
});

describe("utils.isRecordOfString", () => {
    it("returns true for plain string maps", () => {
        expect(isRecordOfString({ a: "1", b: "2" })).toBe(true);
    });
    it("returns false for non-objects or non-string values", () => {
        expect(isRecordOfString(null)).toBe(false);
        expect(isRecordOfString(undefined)).toBe(false);
        expect(isRecordOfString("x")).toBe(false);
        expect(isRecordOfString({ a: 1 })).toBe(false);
        expect(isRecordOfString({ a: "1", b: {} })).toBe(false);
    });
});

describe("utils.normalizeTrigger", () => {
    it("trims whitespace", () => {
        expect(normalizeTrigger("  fn  ")).toBe("fn");
    });
});

describe("utils.isBadTrigger", () => {
    it("rejects empty or triggers containing separators/punctuation", () => {
        expect(isBadTrigger("")).toBe(true);
        expect(isBadTrigger("a b")).toBe(true);   // space
        expect(isBadTrigger("a.b")).toBe(true);   // dot
        expect(isBadTrigger("a/b")).toBe(true);   // slash
        expect(isBadTrigger("a-b")).toBe(true);   // hyphen
        expect(isBadTrigger("(")).toBe(true);
        expect(isBadTrigger("a:b")).toBe(true);   // colon in middle
    });
    it("accepts simple word-like triggers (latin or unicode letters)", () => {
        expect(isBadTrigger("ab")).toBe(false);
        expect(isBadTrigger("пр")).toBe(false);   // cyrillic is allowed
        expect(isBadTrigger("_ab")).toBe(false);  // underscore ok
        expect(isBadTrigger("a1")).toBe(false);
    });
    it("accepts triggers starting with colon", () => {
        expect(isBadTrigger(":plot")).toBe(false);
        expect(isBadTrigger(":scene")).toBe(false);
        expect(isBadTrigger(":character")).toBe(false);
        expect(isBadTrigger(":email")).toBe(false);
    });
});

describe("utils.splitKey/joinKey", () => {
    it("splits 'group/name' into {group, name}", () => {
        expect(splitKey("dev/fn")).toEqual({ group: "dev", name: "fn" });
    });
    it("returns empty group when no slash", () => {
        expect(splitKey("fn")).toEqual({ group: "", name: "fn" });
    });
    it("joinKey composes back", () => {
        expect(joinKey("dev", "fn")).toBe("dev/fn");
        expect(joinKey("", "fn")).toBe("fn");
    });
});

describe("utils.slugifyGroup", () => {
    it("lowercases, strips diacritics and non-alphanumerics, collapses dashes", () => {
        expect(slugifyGroup("  Café Déjà Vu!  ")).toBe("cafe-deja-vu");
        expect(slugifyGroup("Hello___World---2025")).toBe("hello-world-2025");
        expect(slugifyGroup("--a--b--")).toBe("a-b");
    });
    it("empty or non-latin strings may collapse to empty slug", () => {
        // Non-latin letters are removed by /[^a-zA-Z0-9]+/ -> may produce empty
        expect(slugifyGroup("Привет мир")).toBe("");
    });
});

describe("utils.displayGroupTitle", () => {
    it("uses the first path segment and title-cases words", () => {
        expect(displayGroupTitle("my-group_name")).toBe("My Group Name");
        expect(displayGroupTitle("dev/fn")).toBe("Dev"); // takes first segment before '/'
        expect(displayGroupTitle("single")).toBe("Single");
    });
});
