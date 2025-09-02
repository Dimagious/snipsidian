import { describe, it, expect } from "vitest";
import { buildEdit } from "./edit";

describe("buildEdit", () => {
    it("builds edit and computes new cursor position", () => {
        const input = { textBefore: "fn", textAfter: "", lastTyped: " ", sepCh: 2 };
        const match = { trigger: "fn", fromCh: 0, toCh: 2 };
        const applied = { text: "function () {}", cursorDelta: "function ".length };
        const plan = buildEdit(input as any, match as any, applied as any);
        expect(plan.insert).toBe("function () {}");
        expect(plan.fromCh).toBe(0);
        expect(plan.toCh).toBe(2);
        expect(plan.newCursorCh).toBe("function ".length);
    });

    it("cursor goes to end if no cursorDelta", () => {
        const input = { textBefore: "brb", textAfter: "", lastTyped: " ", sepCh: 3 };
        const match = { trigger: "brb", fromCh: 0, toCh: 3 };
        const applied = { text: "be right back" };
        const plan = buildEdit(input as any, match as any, applied as any);
        expect(plan.newCursorCh).toBe("be right back".length);
    });
});
