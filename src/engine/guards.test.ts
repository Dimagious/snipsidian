import { describe, it, expect } from "vitest";
import { shouldExpandHere } from "./guards";

describe("shouldExpandHere", () => {
    const base = { now: new Date(), filename: "x.md" };

    it("returns false in frontmatter", () => {
        expect(shouldExpandHere({ ...base, isInFrontmatter: true, isInCode: false, isInMath: false } as any)).toBe(false);
    });

    it("returns false in code", () => {
        expect(shouldExpandHere({ ...base, isInFrontmatter: false, isInCode: true, isInMath: false } as any)).toBe(false);
    });

    it("returns true in normal text", () => {
        expect(shouldExpandHere({ ...base, isInFrontmatter: false, isInCode: false, isInMath: false } as any)).toBe(true);
    });
});
