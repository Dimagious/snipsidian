import { describe, it, expect } from "vitest";
import { splitKey, joinKey, slugifyGroup, displayGroupTitle } from "./keys";

describe("keys.splitKey/joinKey", () => {
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

describe("keys.slugifyGroup", () => {
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

describe("keys.displayGroupTitle", () => {
    it("uses the first path segment and title-cases words", () => {
        expect(displayGroupTitle("my-group_name")).toBe("My Group Name");
        expect(displayGroupTitle("dev/fn")).toBe("Dev"); // takes first segment before '/'
        expect(displayGroupTitle("single")).toBe("Single");
    });
});
