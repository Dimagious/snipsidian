import { describe, it, expect } from "vitest";
import { buildEdit } from "./edit";

describe("buildEdit", () => {
    it("builds edit and computes new cursor position on the same line", () => {
        const input = { textBefore: "fn", textAfter: "", lastTyped: " ", sepCh: 2 };
        const match = { trigger: "fn", fromCh: 0, toCh: 2 };
        const applied = { text: "function () {}", cursorDelta: "function ".length };
        const plan = buildEdit(input as any, match as any, applied as any);
        expect(plan.insert).toBe("function () {}");
        expect(plan.fromCh).toBe(0);
        expect(plan.toCh).toBe(2);
        expect(plan.newCursor).toEqual({ lineDelta: 0, ch: "function ".length });
    });

    it("cursor goes to end if no cursorDelta", () => {
        const input = { textBefore: "brb", textAfter: "", lastTyped: " ", sepCh: 3 };
        const match = { trigger: "brb", fromCh: 0, toCh: 3 };
        const applied = { text: "be right back" };
        const plan = buildEdit(input as any, match as any, applied as any);
        expect(plan.newCursor).toEqual({ lineDelta: 0, ch: "be right back".length });
    });

    // Regression: F-001 — multi-line replacements should advance lineDelta and
    // resolve `ch` against the resulting line, not stay on the trigger line.
    it("multi-line insert with cursor on a later line", () => {
        const input = { textBefore: "cb", textAfter: "", lastTyped: " ", sepCh: 2 };
        const match = { trigger: "cb", fromCh: 0, toCh: 2 };
        // "> [!note] \n> $|"  →  after $| strip in placeholders, the AppliedReplacement
        // would be: text = "> [!note] \n> ", cursorDelta = 12 (the position of `$|` in the
        // pre-strip string; equal to length of "> [!note] \n> " here).
        const applied = { text: "> [!note] \n> ", cursorDelta: "> [!note] \n> ".length };
        const plan = buildEdit(input as any, match as any, applied as any);
        expect(plan.newCursor).toEqual({ lineDelta: 1, ch: "> ".length });
    });

    it("multi-line insert with cursor on the first line still uses lineDelta=0", () => {
        const input = { textBefore: "cb", textAfter: "", lastTyped: " ", sepCh: 5 };
        const match = { trigger: "cb", fromCh: 3, toCh: 5 };
        // Cursor target is at offset 2 ("> $|[!note] \n>"). Even though the
        // insert contains a newline, the marker is before any newline.
        const applied = { text: "> [!note] \n> ", cursorDelta: 2 };
        const plan = buildEdit(input as any, match as any, applied as any);
        expect(plan.newCursor).toEqual({ lineDelta: 0, ch: 3 /* fromCh */ + 2 });
    });

    it("multi-line insert with no explicit cursorDelta lands at end of last line", () => {
        const input = { textBefore: "cb", textAfter: "", lastTyped: " ", sepCh: 2 };
        const match = { trigger: "cb", fromCh: 0, toCh: 2 };
        const applied = { text: "line1\nline2" };
        const plan = buildEdit(input as any, match as any, applied as any);
        expect(plan.newCursor).toEqual({ lineDelta: 1, ch: "line2".length });
    });
});
