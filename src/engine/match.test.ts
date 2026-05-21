import { describe, it, expect } from "vitest";
import { findTrigger } from "./match";
import type { Dict } from "./types";

const delims = [" ", "\t", "\n", ".", ",", "!", "?", ";", ":", "(", ")", "[", "]", "{", "}", "\"", "'", "-", "\\", "/", "|"];

describe("findTrigger", () => {
    const dict: Dict = { "пр": "привет", fn: "function $|() {}", ab: "AB" };

    it("finds trigger before a space and respects word boundaries", () => {
        const input = {
            textBefore: "напишу пр",
            textAfter: "",
            lastTyped: " ",
            sepCh: "напишу пр".length
        };
        const m = findTrigger(input, dict, delims);
        expect(m).not.toBeNull();
        expect(m!.trigger).toBe("пр");
        expect(m!.fromCh).toBe("напишу ".length);
        expect(m!.toCh).toBe("напишу пр".length);
    });

    it("does not match in the middle of a word", () => {
        const input = {
            textBefore: "xxab",
            textAfter: "",
            lastTyped: " ",
            sepCh: "xxab".length
        };
        const m = findTrigger(input, dict, delims);
        expect(m).toBeNull();
    });

    it("ignores unknown triggers", () => {
        const input = {
            textBefore: "hello zz",
            textAfter: "",
            lastTyped: " ",
            sepCh: "hello zz".length
        };
        const m = findTrigger(input, dict, delims);
        expect(m).toBeNull();
    });

    it("works with punctuation as delimiter", () => {
        const input = {
            textBefore: "fn",
            textAfter: "",
            lastTyped: ".",
            sepCh: "fn".length
        };
        const m = findTrigger(input, dict, delims);
        expect(m?.trigger).toBe("fn");
    });

    // ---- Boundary cases per ADR-0005 (B-080) ----
    //
    // The unit tests above cover "happy path" cases. These boundary
    // tests pin the contract at edge inputs that previously slipped
    // through 90%+ line coverage and shipped as bugs.

    it("matches a trigger at column 0 (no preceding text)", () => {
        // Boundary: the trigger starts at the very beginning of the
        // line. The scan walks backwards from sepCh-1 while NOT a
        // separator; at i=0 the char is part of the trigger, the loop
        // exits when i becomes -1. fromCh must be 0, not 1.
        const input = {
            textBefore: "fn",
            textAfter: "",
            lastTyped: " ",
            sepCh: 2,
        };
        const m = findTrigger(input, dict, delims);
        expect(m?.trigger).toBe("fn");
        expect(m?.fromCh).toBe(0);
        expect(m?.toCh).toBe(2);
    });

    it("returns null when lastTyped isn't a separator at all", () => {
        // Defensive guard: even if the caller passes a non-separator
        // for lastTyped (shouldn't happen, but…), findTrigger must
        // refuse rather than scan with a bogus boundary.
        const input = {
            textBefore: "hello fn",
            textAfter: "",
            lastTyped: "x",
            sepCh: "hello fn".length,
        };
        const m = findTrigger(input, dict, delims);
        expect(m).toBeNull();
    });

    it("returns null when the cursor is on a separator with no preceding non-separator", () => {
        // Pathological: textBefore ends with a separator, so the
        // backward scan immediately falls through to fromCh === toCh
        // and the helper returns null.
        const input = {
            textBefore: "hello ",
            textAfter: "",
            lastTyped: " ",
            sepCh: "hello ".length,
        };
        const m = findTrigger(input, dict, delims);
        expect(m).toBeNull();
    });

    it("treats every separator equally — newline behaves like space", () => {
        // The delimiter set includes `\n`. Triggers followed by a
        // newline (Enter key) must expand the same way as
        // space-completed triggers.
        const input = {
            textBefore: "fn",
            textAfter: "",
            lastTyped: "\n",
            sepCh: "fn".length,
        };
        const m = findTrigger(input, dict, delims);
        expect(m?.trigger).toBe("fn");
    });

    it("ignores text after the separator (`textAfter` doesn't influence match)", () => {
        // The match window is `[fromCh, sepCh)` — anything past the
        // separator is irrelevant. Sanity-check that the helper
        // doesn't accidentally scan forward.
        const input = {
            textBefore: "fn",
            textAfter: "ignored content trigger",
            lastTyped: " ",
            sepCh: "fn".length,
        };
        const m = findTrigger(input, dict, delims);
        expect(m?.trigger).toBe("fn");
        expect(m?.toCh).toBe("fn".length);
    });

    it("supports multi-byte unicode triggers (Cyrillic)", () => {
        // String indexing on JS strings uses UTF-16 code units, so a
        // BMP cyrillic char like 'п' is 1 unit. `slice(i, j)` does
        // the right thing. The existing happy-path test covers this
        // implicitly; pin it explicitly so a future refactor to
        // code-point-aware slicing keeps the contract.
        const input = {
            textBefore: "пр",
            textAfter: "",
            lastTyped: " ",
            sepCh: "пр".length,
        };
        const m = findTrigger(input, dict, delims);
        expect(m?.trigger).toBe("пр");
        expect(m?.fromCh).toBe(0);
        expect(m?.toCh).toBe("пр".length);
    });

    it("[B-019] caps lookback at 64 chars — pathological non-separator runs return null", () => {
        // 200-char run of non-separators (no spaces in the line up to
        // the typed separator). Without the cap, findTrigger walks
        // all 200 chars before concluding "no trigger". With the
        // cap, it bails out after 64 chars. The dict is empty so
        // even short matches return null — this test pins the
        // null-bailout for pathological-length runs specifically.
        const longRun = "a".repeat(200);
        const input = {
            textBefore: longRun,
            textAfter: "",
            lastTyped: " ",
            sepCh: longRun.length,
        };
        expect(findTrigger(input, dict, delims)).toBeNull();
    });

    it("[B-019] triggers exactly 64 chars long still match (boundary)", () => {
        const exactTrigger = "x".repeat(64);
        const richDict = { ...dict, [exactTrigger]: "ok" };
        const input = {
            textBefore: exactTrigger,
            textAfter: "",
            lastTyped: " ",
            sepCh: exactTrigger.length,
        };
        const m = findTrigger(input, richDict, delims);
        expect(m?.trigger).toBe(exactTrigger);
    });

    it("[B-019] separator before the 64-char window is still found (short trigger after long URL)", () => {
        // 200-char URL-like run + space + short trigger + separator
        // → the short trigger is within the cap, finds the
        // intermediate space and returns the short trigger.
        const url = "h".repeat(200);
        const trigger = "fn";
        const before = `${url} ${trigger}`;
        const input = {
            textBefore: before,
            textAfter: "",
            lastTyped: " ",
            sepCh: before.length,
        };
        const m = findTrigger(input, dict, delims);
        expect(m?.trigger).toBe(trigger);
    });
});
