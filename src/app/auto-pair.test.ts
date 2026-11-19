import { describe, it, expect } from "vitest";
import {
    isCloserStepOver,
    isDeleteUserEvent,
    PAIR_CLOSERS,
    PairedCloserTracker,
    pairedCloser,
    pairInsertCloser,
    type CaretMove,
} from "./auto-pair";
import type { ChangeInfo } from "./change-source-gate";

/** ADR-0008: instant patterns next to Obsidian's "Auto pair brackets". */

describe("pairedCloser", () => {
    it.each([
        ["()", ")"],
        ["[]", "]"],
        ["{}", "}"],
        ['""', '"'],
        ["''", "'"],
        ["``", "`"],
        ["**", "*"],
        ["__", "_"],
    ])("%s is an auto-pair closing with %s", (text, closer) => {
        expect(pairedCloser(text)).toBe(closer);
    });

    it.each(["", "(", "()x", "(]", ")(", "ab", "<>", "  ", "*_", "_*", "*"])("%j is not", (text) => {
        expect(pairedCloser(text)).toBeUndefined();
    });

    it("the closer set is the closers of the pairs", () => {
        expect([...PAIR_CLOSERS].sort()).toEqual([")", "]", "`", "'", '"', "}", "*", "_"].sort());
    });
});

describe("isDeleteUserEvent", () => {
    it.each(["delete", "delete.backward", "delete.forward", "delete.cut", "delete.selection"])("%s is a deletion", (event) => {
        expect(isDeleteUserEvent(event)).toBe(true);
    });

    it.each([undefined, "", "input.type", "deleted", "undo", "select", "x.delete", "input.delete"])("%j is not", (event) => {
        expect(isDeleteUserEvent(event)).toBe(false);
    });
});

describe("pairInsertCloser (shape 2: the opener inserts the pair)", () => {
    const pair: ChangeInfo = { deleted: 0, inserted: 2, lines: 1, end: 4, text: "()" };
    const caret = { ranges: 1, empty: true, head: 3 }; // between the two characters

    it("a pair with the caret between its characters gives the closer", () => {
        expect(pairInsertCloser([pair], caret)).toBe(")");
        expect(pairInsertCloser([{ ...pair, text: "[]" }], caret)).toBe("]");
        expect(pairInsertCloser([{ ...pair, text: "**" }], caret)).toBe("*");
        expect(pairInsertCloser([{ ...pair, text: "__" }], caret)).toBe("_");
    });

    it("anything else gives nothing", () => {
        expect(pairInsertCloser([], caret)).toBeUndefined();
        expect(pairInsertCloser([pair, pair], caret)).toBeUndefined();
        expect(pairInsertCloser([{ ...pair, text: undefined }], caret)).toBeUndefined();
        expect(pairInsertCloser([{ ...pair, text: "ab" }], caret)).toBeUndefined();
        expect(pairInsertCloser([{ ...pair, inserted: 1 }], caret)).toBeUndefined();
        expect(pairInsertCloser([{ ...pair, inserted: 3, text: "(x)" }], caret)).toBeUndefined();
        expect(pairInsertCloser([{ ...pair, deleted: 1 }], caret)).toBeUndefined(); // wrapping a selection
        expect(pairInsertCloser([{ ...pair, lines: 2 }], caret)).toBeUndefined();
    });

    it("the caret must sit between the two characters, single and empty", () => {
        expect(pairInsertCloser([pair], { ...caret, head: 4 })).toBeUndefined();
        expect(pairInsertCloser([pair], { ...caret, head: 2 })).toBeUndefined();
        expect(pairInsertCloser([pair], { ...caret, ranges: 2 })).toBeUndefined();
        expect(pairInsertCloser([pair], { ...caret, empty: false })).toBeUndefined();
    });
});

describe("PairedCloserTracker", () => {
    it("starts empty, tracks a closer, forgets it on clear", () => {
        const tracker = new PairedCloserTracker();
        expect(tracker.tracked).toBe(false);
        expect(tracker.isAt(3, ")")).toBe(false);
        tracker.track(3, ")");
        expect(tracker.tracked).toBe(true);
        expect(tracker.isAt(3, ")")).toBe(true);
        expect(tracker.isAt(4, ")")).toBe(false);
        expect(tracker.isAt(3, "]")).toBe(false);
        tracker.clear();
        expect(tracker.tracked).toBe(false);
        expect(tracker.isAt(3, ")")).toBe(false);
    });

    it("moves with the text, and is forgotten when the closer is deleted", () => {
        const tracker = new PairedCloserTracker();
        tracker.track(3, ")");
        tracker.map((pos) => pos + 2);
        expect(tracker.isAt(5, ")")).toBe(true);
        tracker.map(() => null);
        expect(tracker.tracked).toBe(false);
        tracker.map((pos) => pos + 1); // nothing tracked: nothing happens
        expect(tracker.tracked).toBe(false);
    });

    it("a new closer replaces the old one", () => {
        const tracker = new PairedCloserTracker();
        tracker.track(3, ")");
        tracker.track(8, "]");
        expect(tracker.isAt(3, ")")).toBe(false);
        expect(tracker.isAt(8, "]")).toBe(true);
    });
});

describe("isCloserStepOver (shape 1: typing the closer steps over it)", () => {
    const move: CaretMove = {
        userEvents: [undefined],
        before: { ranges: 1, empty: true, head: 4 },
        after: { ranges: 1, empty: true, head: 5 },
        passed: ")",
    };
    const tracked = (): PairedCloserTracker => {
        const tracker = new PairedCloserTracker();
        tracker.track(4, ")");
        return tracker;
    };

    it("an untagged +1 move over the tracked closer is typing it", () => {
        expect(isCloserStepOver(move, tracked())).toBe(true);
    });

    it("a typing tag is fine too, mixed with untagged transactions", () => {
        expect(isCloserStepOver({ ...move, userEvents: ["input.type"] }, tracked())).toBe(true);
        expect(isCloserStepOver({ ...move, userEvents: [undefined, "input.type"] }, tracked())).toBe(true);
    });

    it("without a tracked closer (a programmatic setCursor) it is not", () => {
        expect(isCloserStepOver(move, new PairedCloserTracker())).toBe(false);
    });

    it("a closer tracked at another offset, or another character, is not", () => {
        const elsewhere = new PairedCloserTracker();
        elsewhere.track(9, ")");
        expect(isCloserStepOver(move, elsewhere)).toBe(false);
        expect(isCloserStepOver({ ...move, passed: "]" }, tracked())).toBe(false);
    });

    it.each(["select", "select.pointer", "select.search", "input.paste", "undo", "move.drop", "snipsy.expand"])(
        "a %s transaction is not typing",
        (userEvent) => {
            expect(isCloserStepOver({ ...move, userEvents: [userEvent] }, tracked())).toBe(false);
            expect(isCloserStepOver({ ...move, userEvents: [undefined, userEvent] }, tracked())).toBe(false);
        },
    );

    it("no transactions is not a move", () => {
        expect(isCloserStepOver({ ...move, userEvents: [] }, tracked())).toBe(false);
    });

    it("the head must move exactly one character forward", () => {
        for (const head of [4, 3, 6, 9]) {
            expect(isCloserStepOver({ ...move, after: { ...move.after, head } }, tracked())).toBe(false);
        }
    });

    it("a single empty caret before and after", () => {
        expect(isCloserStepOver({ ...move, before: { ...move.before, ranges: 2 } }, tracked())).toBe(false);
        expect(isCloserStepOver({ ...move, after: { ...move.after, ranges: 2 } }, tracked())).toBe(false);
        expect(isCloserStepOver({ ...move, before: { ...move.before, empty: false } }, tracked())).toBe(false);
        expect(isCloserStepOver({ ...move, after: { ...move.after, empty: false } }, tracked())).toBe(false);
    });

    it.each(["*", "_", "`", '"', "'", "]", "}"])("typing the closer %s over the tracked one is a step-over", (char) => {
        const tracker = new PairedCloserTracker();
        tracker.track(4, char);
        expect(isCloserStepOver({ ...move, passed: char }, tracker)).toBe(true);
    });

    it("the passed character must be an auto-pair closer", () => {
        const tracker = new PairedCloserTracker();
        tracker.track(4, "a");
        expect(isCloserStepOver({ ...move, passed: "a" }, tracker)).toBe(false);
        expect(isCloserStepOver({ ...move, passed: "" }, tracker)).toBe(false);
    });
});
