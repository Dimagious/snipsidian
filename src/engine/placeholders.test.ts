import { describe, it, expect } from "vitest";
import { applyPlaceholders } from "./placeholders";

describe("applyPlaceholders", () => {
    it("removes $| and returns cursorDelta at its position", async () => {
        const ctx = { isInCode: false, isInMath: false, isInFrontmatter: false, now: new Date("2025-09-02T10:11:12Z") };
        const r = await applyPlaceholders("function $|() {}", ctx as any);
        expect(r.text).toBe("function () {}");
        expect(r.cursorDelta).toBe("function ".length);
    });

    it("replaces $date and $time", async () => {
        const now = new Date("2025-09-02T10:11:12");
        const ctx = { isInCode: false, isInMath: false, isInFrontmatter: false, now };
        const r = await applyPlaceholders("Today: $date $time", ctx as any);
        // date: YYYY-MM-DD, time: HH:mm
        expect(r.text).toMatch(/^Today: \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    });

    it("replaces $filename", async () => {
        const ctx = { isInCode: false, isInMath: false, isInFrontmatter: false, now: new Date(), filename: "note.md" };
        const r = await applyPlaceholders("File: $filename", ctx as any);
        expect(r.text).toBe("File: note.md");
    });

    it("replaces $clipboard if provided, otherwise empties it", async () => {
        const ctx1 = {
            isInCode: false, isInMath: false, isInFrontmatter: false,
            now: new Date(),
            readClipboard: async () => "CLIP"
        };
        const r1 = await applyPlaceholders("X $clipboard Y", ctx1 as any);
        expect(r1.text).toBe("X CLIP Y");

        const ctx2 = { isInCode: false, isInMath: false, isInFrontmatter: false, now: new Date() };
        const r2 = await applyPlaceholders("X $clipboard Y", ctx2 as any);
        expect(r2.text).toBe("X  Y");
    });
});
