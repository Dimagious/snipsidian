import { describe, it, expect } from "vitest";
import { isRecordOfString } from "./schema";

describe("store/schema.isRecordOfString", () => {
    it("validates map of string values", () => {
        expect(isRecordOfString({ a: "1" })).toBe(true);
        expect(isRecordOfString({})).toBe(true);
    });
    it("rejects non-objects or non-strings", () => {
        expect(isRecordOfString(null)).toBe(false);
        expect(isRecordOfString(42)).toBe(false as any);
        expect(isRecordOfString({ a: 1 })).toBe(false);
        expect(isRecordOfString({ a: "1", b: {} as any })).toBe(false);
    });
});
