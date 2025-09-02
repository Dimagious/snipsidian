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
});
