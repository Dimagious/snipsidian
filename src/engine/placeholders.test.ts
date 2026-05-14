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

    // Regression: F-002 — `$|` was previously located against the raw replacement,
    // before variable substitution. Any length change in a variable to the left
    // of `$|` would desync the cursor. The cursor must point to the marker's
    // position in the FINAL substituted text.
    it("locates $| after substituting $date (cursor lands at end of expanded date)", async () => {
        const now = new Date("2026-05-14T10:11:12");
        const ctx = { isInCode: false, isInMath: false, isInFrontmatter: false, now };
        const r = await applyPlaceholders("$date $|", ctx as any);
        expect(r.text).toBe("2026-05-14 ");
        expect(r.cursorDelta).toBe("2026-05-14 ".length); // 11 — after the substituted date + space
    });

    it("locates $| after substituting $time", async () => {
        const now = new Date("2026-05-14T07:08:00");
        const ctx = { isInCode: false, isInMath: false, isInFrontmatter: false, now };
        const r = await applyPlaceholders("[$time] $|note", ctx as any);
        expect(r.text).toBe("[07:08] note");
        // cursor lands before "note" — i.e. at index 8 of the substituted text
        expect(r.cursorDelta).toBe("[07:08] ".length);
    });

    it("locates $| after substituting $filename (incl. empty filename)", async () => {
        const ctx = {
            isInCode: false, isInMath: false, isInFrontmatter: false,
            now: new Date(), filename: "",
        };
        const r = await applyPlaceholders("file=$filename $|done", ctx as any);
        expect(r.text).toBe("file= done");
        expect(r.cursorDelta).toBe("file= ".length);
    });

    it("locates $| after substituting $clipboard", async () => {
        const ctx = {
            isInCode: false, isInMath: false, isInFrontmatter: false,
            now: new Date(),
            readClipboard: async () => "hello",
        };
        const r = await applyPlaceholders("[$clipboard] $|", ctx as any);
        expect(r.text).toBe("[hello] ");
        expect(r.cursorDelta).toBe("[hello] ".length);
    });

    it("$| inside a multi-line replacement is resolved against the final text", async () => {
        const ctx = { isInCode: false, isInMath: false, isInFrontmatter: false, now: new Date() };
        const r = await applyPlaceholders("> [!note] \n> $|", ctx as any);
        expect(r.text).toBe("> [!note] \n> ");
        expect(r.cursorDelta).toBe("> [!note] \n> ".length); // the offset of `$|` in the pre-strip string
    });
});
