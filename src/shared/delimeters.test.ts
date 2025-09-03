import { describe, it, expect } from "vitest";
import { DEFAULT_DELIMITERS, isSeparator } from "./delimiters";

describe("delimiters", () => {
    it("DEFAULT_DELIMITERS contains common separators", () => {
        for (const ch of [
            " ", "\t", "\n",
            ".", ",", "!", "?", ";", ":",
            "(", ")", "[", "]", "{", "}", "\"", "'",
        ]) {
            expect(DEFAULT_DELIMITERS).toContain(ch);
        }
        expect(DEFAULT_DELIMITERS).not.toContain("-");
        expect(DEFAULT_DELIMITERS).not.toContain("/");
        expect(DEFAULT_DELIMITERS).not.toContain("\\");
        expect(DEFAULT_DELIMITERS).not.toContain("|");
    });

    it("isSeparator returns true for whitespace and punctuation (excluding - / \\ |)", () => {
        for (const ch of [
            " ", "\t", "\n",
            ".", ",", "!", "?", ";", ":",
            "(", ")", "[", "]", "{", "}", "\"", "'",
        ]) {
            expect(isSeparator(ch)).toBe(true);
        }
    });

    it("treats '-', '/', '\\\\', '|' as non-separators to support symbolic triggers", () => {
        for (const ch of ["-", "/", "\\", "|"]) {
            expect(isSeparator(ch)).toBe(false);
        }
    });

    it("isSeparator returns false for letters, digits, and underscore", () => {
        for (const ch of ["a", "Z", "я", "Ж", "é", "0", "5", "_"]) {
            expect(isSeparator(ch)).toBe(false);
        }
    });
});
