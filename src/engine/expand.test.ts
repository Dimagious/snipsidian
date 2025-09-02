import { describe, it, expect } from "vitest";
import { expand } from "./expand";
import type { Dict } from "./types";

const dict: Dict = {
    fn: "function $|() {}",
    brb: "be right back"
};

describe("expand", () => {
    const baseCtx = { isInCode: false, isInMath: false, isInFrontmatter: false, now: new Date("2025-09-02T10:11:12") };

    it("returns null if guard blocks (code/frontmatter)", async () => {
        const input = { textBefore: "fn", textAfter: "", lastTyped: " ", sepCh: 2 };
        const plan1 = await expand(input as any, dict, { ...baseCtx, isInCode: true } as any);
        expect(plan1).toBeNull();
        const plan2 = await expand(input as any, dict, { ...baseCtx, isInFrontmatter: true } as any);
        expect(plan2).toBeNull();
    });

    it("expands known trigger and positions cursor at $|", async () => {
        const input = { textBefore: "fn", textAfter: "", lastTyped: " ", sepCh: 2 };
        const plan = await expand(input as any, dict, baseCtx as any);
        expect(plan).not.toBeNull();
        expect(plan!.insert).toBe("function () {}");
        expect(plan!.fromCh).toBe(0);
        expect(plan!.toCh).toBe(2);
        expect(plan!.newCursorCh).toBe("function ".length);
    });

    it("returns null for unknown trigger", async () => {
        const input = { textBefore: "zzz", textAfter: "", lastTyped: " ", sepCh: 3 };
        const plan = await expand(input as any, dict, baseCtx as any);
        expect(plan).toBeNull();
    });
});
