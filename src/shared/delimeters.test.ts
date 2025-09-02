import { describe, it, expect } from "vitest";
import { DEFAULT_DELIMITERS, isSeparator } from "./delimiters";

describe("delimiters", () => {
    it("DEFAULT_DELIMITERS contains common separators", () => {
        expect(DEFAULT_DELIMITERS).toContain(" ");
        expect(DEFAULT_DELIMITERS).toContain(".");
        expect(DEFAULT_DELIMITERS).toContain(",");
        expect(DEFAULT_DELIMITERS).toContain("(");
        expect(DEFAULT_DELIMITERS).toContain(")");
        expect(DEFAULT_DELIMITERS).toContain("-");
        expect(DEFAULT_DELIMITERS).toContain("/");
        expect(DEFAULT_DELIMITERS).toContain("|");
    });

    it("isSeparator returns true for whitespace and punctuation", () => {
        for (const ch of [" ", "\t", "\n", ".", ",", "!", "?", ";", ":", "(", ")", "[", "]", "{", "}", "\"", "'", "-", "\\", "/", "|"]) {
            expect(isSeparator(ch)).toBe(true);
        }
    });

    it("isSeparator returns false for letters, digits, and underscore", () => {
        for (const ch of ["a", "Z", "я", "Ж", "é", "0", "5", "_"]) {
            expect(isSeparator(ch)).toBe(false);
        }
    });
});
