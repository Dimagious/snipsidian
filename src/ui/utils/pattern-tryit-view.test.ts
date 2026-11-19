import { describe, it, expect } from "vitest";
import type { TryItResult } from "../../core/pattern-tryit";
import { describeTryItStatus, fieldMark, tryItLabel, tryItPieces } from "./pattern-tryit-view";

const result = (over: Partial<TryItResult>): TryItResult => ({
    text: "",
    replaced: null,
    fields: [],
    caret: 0,
    status: { kind: "none" },
    ...over,
});

describe("describeTryItStatus", () => {
    it("words every status the design lists", () => {
        expect(describeTryItStatus({ kind: "empty" })).toBe("");
        expect(describeTryItStatus({ kind: "none" })).toBe("No match.");
        expect(describeTryItStatus({ kind: "fires", at: "1/2" })).toBe("Fires after 1/2.");
        expect(describeTryItStatus({ kind: "needs-separator" })).toBe("Fires when you type a separator next.");
        expect(describeTryItStatus({ kind: "early", at: "1/2", next: "3" })).toBe(
            "Fired at 1/2, before 3. To type 1/23, choose After a separator.",
        );
        expect(describeTryItStatus({ kind: "shadowed-rule", position: 2 })).toBe("Rule 2 fires first.");
        expect(describeTryItStatus({ kind: "shadowed-snippet", trigger: "todo" })).toBe("Snippet todo fires first.");
    });
});

describe("tryItPieces", () => {
    it("marks the replaced span and puts the caret at the end (the early-firing picture)", () => {
        expect(tryItPieces(result({ text: "½3", replaced: { from: 0, to: 1 }, caret: 2 }))).toEqual([
            { kind: "replaced", text: "½" },
            { kind: "text", text: "3" },
            { kind: "caret" },
        ]);
    });

    it("places fields and an inner caret inside the insert, in order", () => {
        const pieces = tryItPieces(result({ text: "Meeting  with ", replaced: { from: 0, to: 14 }, fields: [8, 14], caret: 8 }));
        expect(pieces).toEqual([
            { kind: "replaced", text: "Meeting " },
            { kind: "field", number: 1 },
            { kind: "caret" },
            { kind: "replaced", text: " with " },
            { kind: "field", number: 2 },
        ]);
    });

    it("an empty text still shows the caret", () => {
        expect(tryItPieces(result({ text: "", caret: 0 }))).toEqual([{ kind: "caret" }]);
    });

    it("plain typed text is one piece", () => {
        expect(tryItPieces(result({ text: "hello", caret: 5 }))).toEqual([{ kind: "text", text: "hello" }, { kind: "caret" }]);
    });

    it("clamps marks that point past the text", () => {
        expect(tryItPieces(result({ text: "ab", caret: 99 }))).toEqual([{ kind: "text", text: "ab" }, { kind: "caret" }]);
    });
});

describe("fieldMark and label", () => {
    it("uses circled digits up to nine, then numbers", () => {
        expect(fieldMark(1)).toBe("①");
        expect(fieldMark(9)).toBe("⑨");
        expect(fieldMark(10)).toBe("(10)");
    });

    it("names the text and the marks for a screen reader", () => {
        expect(tryItLabel(result({ text: "½3", caret: 2 }))).toBe("Result: ½3, caret at end");
        expect(tryItLabel(result({ text: "ab", fields: [0, 1], caret: 0 }))).toBe("Result: ab, 2 tab stops");
        expect(tryItLabel(result({ text: "ab", fields: [0], caret: 1 }))).toBe("Result: ab, 1 tab stop");
    });
});
