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
        const plan1 = await expand(input, dict, { ...baseCtx, isInCode: true });
        expect(plan1).toBeNull();
        const plan2 = await expand(input, dict, { ...baseCtx, isInFrontmatter: true });
        expect(plan2).toBeNull();
    });

    it("expands known trigger and positions cursor at $|", async () => {
        const input = { textBefore: "fn", textAfter: "", lastTyped: " ", sepCh: 2 };
        const plan = await expand(input, dict, baseCtx);
        expect(plan).not.toBeNull();
        expect(plan!.insert).toBe("function () {}");
        expect(plan!.fromCh).toBe(0);
        expect(plan!.toCh).toBe(2);
        expect(plan!.newCursor).toEqual({ lineDelta: 0, ch: "function ".length });
    });

    it("returns null for unknown trigger", async () => {
        const input = { textBefore: "zzz", textAfter: "", lastTyped: " ", sepCh: 3 };
        const plan = await expand(input, dict, baseCtx);
        expect(plan).toBeNull();
    });

    // S-008: before the fix, typing `constructor ` resolved `dict.constructor`
    // to the Object function — `expand` then called `.replace` on it and
    // threw a TypeError on the per-keystroke hot path. Must resolve to a
    // clean no-match instead.
    it("[S-008] returns null (no throw) for inherited prototype key as trigger", async () => {
        const input = { textBefore: "constructor", textAfter: "", lastTyped: " ", sepCh: "constructor".length };
        await expect(expand(input, dict, baseCtx)).resolves.toBeNull();
    });

    // B-243
    it("a snippet with two fields yields a plan with fields and a final stop", async () => {
        const input = { textBefore: "lnk", textAfter: "", lastTyped: " ", sepCh: 3 };
        const plan = await expand(input, { lnk: "[$1]($2)" }, baseCtx);
        expect(plan?.insert).toBe("[]()");
        expect(plan?.fields).toEqual([1, 3]);
        expect(plan?.docOrder).toEqual([0, 1]);
        // no `$|`: the adapter puts the final stop after the typed separator
        expect(plan?.final).toBeUndefined();
    });

    it("a virtual separator at the caret expands the trigger before it (B-244 input shape)", async () => {
        const input = { textBefore: "see brb", textAfter: " tail", lastTyped: "\n", sepCh: 7 };
        const plan = await expand(input, dict, baseCtx);
        expect(plan).toMatchObject({ fromCh: 4, toCh: 7, insert: "be right back" });
    });
});
