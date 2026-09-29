import { describe, it, expect } from "vitest";
import { formatTriggerList, sanitizeForNotice } from "./notice-text";

describe("sanitizeForNotice (B-034)", () => {
    it("passes a normal short message through unchanged", () => {
        expect(sanitizeForNotice("Trigger \"foo\" already exists")).toBe(
            "Trigger \"foo\" already exists",
        );
    });

    it("strips C0 control characters (e.g. from a malformed clipboard paste)", () => {
        const withControls = "bad\x00value\x01here";
        expect(sanitizeForNotice(withControls)).toBe("bad value here");
    });

    it("strips DEL and C1 control characters", () => {
        const withControls = "before\x7Fafter\x9Fend";
        expect(sanitizeForNotice(withControls)).toBe("before after end");
    });

    it("collapses newlines and tabs (a multi-line YAML error excerpt) into one line", () => {
        const multiline =
            "Nested mappings are not allowed in compact mappings at line 1, column 10:\n\n" +
            "invalid: yaml: content: [\n         ^\n";
        const result = sanitizeForNotice(multiline);
        expect(result).not.toContain("\n");
        expect(result.startsWith("Nested mappings are not allowed")).toBe(true);
    });

    it("truncates a very long message and marks it with an ellipsis", () => {
        const long = "x".repeat(1000);
        const result = sanitizeForNotice(long, 50);
        expect(result.length).toBe(51); // 50 chars + the ellipsis marker
        expect(result.endsWith("…")).toBe(true);
    });

    it("does not truncate a message exactly at the limit", () => {
        const exact = "x".repeat(50);
        expect(sanitizeForNotice(exact, 50)).toBe(exact);
    });

    it("handles an empty string without throwing", () => {
        expect(sanitizeForNotice("")).toBe("");
    });

    it("uses a sane default max length when none is given", () => {
        const long = "y".repeat(1000);
        const result = sanitizeForNotice(long);
        expect(result.length).toBeLessThan(1000);
        expect(result.endsWith("…")).toBe(true);
    });
});

// B-034 (finding #7): `formatTriggerList` caps both the per-item
// length and the number of items shown, for the "several untrusted
// names joined into one Notice" case (Espanso/community-pack trigger
// collision lists).
describe("formatTriggerList (B-034, finding #7)", () => {
    it("joins a short list unchanged", () => {
        expect(formatTriggerList(["a", "b", "c"])).toBe("a, b, c");
    });

    it("an empty list joins to an empty string", () => {
        expect(formatTriggerList([])).toBe("");
    });

    it("exactly at the default cap (5): no '(and N more)' suffix", () => {
        expect(formatTriggerList(["a", "b", "c", "d", "e"])).toBe("a, b, c, d, e");
    });

    it("over the default cap (5): shows the first 5 and '(and N more)'", () => {
        const names = ["a", "b", "c", "d", "e", "f", "g"];
        expect(formatTriggerList(names)).toBe("a, b, c, d, e (and 2 more)");
    });

    it("respects a custom maxShown", () => {
        expect(formatTriggerList(["a", "b", "c", "d"], 2)).toBe("a, b (and 2 more)");
    });

    it("strips control characters from each shown name", () => {
        expect(formatTriggerList(["bad\x00name"])).toBe("bad name");
    });

    it("caps an individual very long name, independent of the list cap", () => {
        const long = "x".repeat(200);
        const result = formatTriggerList([long]);
        expect(result.length).toBeLessThan(200);
        expect(result.endsWith("…")).toBe(true);
    });
});
