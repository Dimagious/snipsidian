import { describe, it, expect } from "vitest";
import { isRecordOfString } from "./guards";

describe("shared/guards.isRecordOfString", () => {
    it("validates map of string values", () => {
        expect(isRecordOfString({ a: "1" })).toBe(true);
        expect(isRecordOfString({})).toBe(true);
        expect(isRecordOfString({ a: "1", b: "2" })).toBe(true);
    });
    it("rejects non-objects or non-strings", () => {
        expect(isRecordOfString(null)).toBe(false);
        expect(isRecordOfString(undefined)).toBe(false);
        expect(isRecordOfString(42)).toBe(false as never);
        expect(isRecordOfString("x")).toBe(false);
        expect(isRecordOfString({ a: 1 })).toBe(false);
        expect(isRecordOfString({ a: "1", b: {} as never })).toBe(false);
    });
});
