import { describe, it, expect } from "vitest";
import { planTextSnippetsMigration } from "./text-snippets-migration";

function plan(data: Record<string, unknown>) {
    return planTextSnippetsMigration(data, JSON.stringify(data));
}

describe("core/text-snippets-migration (B-254)", () => {
    it("converts snippets_file into the text-snippets group and maps the options", () => {
        const result = plan({ snippets_file: "brb : be right back\nsig : Best,$nl$Me", useTab: true, useSpace: false });
        expect(result.ok).toBe(true);
        expect(result.settings.snippets).toEqual({
            "text-snippets/brb": "be right back",
            "text-snippets/sig": "Best,\nMe",
        });
        expect(result.settings.expansion).toEqual({ onType: false, onTab: true });
        expect(result.importedCount).toBe(2);
    });

    it("never seeds the Snipsy defaults", () => {
        const result = plan({ snippets_file: "" });
        expect(result.ok).toBe(true);
        expect(result.settings.snippets).toEqual({});
        expect(result.importedCount).toBe(0);
    });

    it("honours custom markers from the file", () => {
        const result = plan({ snippets_file: "a : x<NL>y", newlineSymbol: "<NL>" });
        expect(result.settings.snippets["text-snippets/a"]).toBe("x\ny");
    });

    it("reports skipped records and keeps the rest", () => {
        const result = plan({ snippets_file: "ok : fine\nno separator here\nbad trigger : x" });
        expect(Object.keys(result.settings.snippets)).toEqual(["text-snippets/ok"]);
        expect(result.skipped.map((s) => s.trigger)).toEqual(["no separator here", "bad trigger"]);
    });

    it("falls back to the snippets cache when snippets_file is absent", () => {
        const result = plan({ snippets: ["a : b"] });
        expect(result.settings.snippets).toEqual({ "text-snippets/a": "b" });
    });

    it("an empty cache converts to nothing without failing", () => {
        const result = plan({ snippets: [] });
        expect(result.ok).toBe(true);
        expect(result.importedCount).toBe(0);
    });

    it("wrong types fail with the options kept and nothing converted", () => {
        const result = plan({ snippets: [1, 2], useTab: false, useSpace: true });
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/list of strings/);
        expect(result.settings).toEqual({ snippets: {}, expansion: { onType: true, onTab: false } });
    });

    it("malformed JSON text fails instead of throwing", () => {
        const result = planTextSnippetsMigration({ snippets_file: "a : b" }, "{not json");
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/not valid JSON/);
    });

    // S-009 / S-010: the count cap is lifted for the user's own library (a
    // refused migration used to strand the original file); everything else holds.
    it("imports a library of more than 500 snippets whole (count cap lifted)", () => {
        const file = Array.from({ length: 501 }, (_, i) => `t${i} : v`).join("\n");
        const result = plan({ snippets_file: file });
        expect(result.ok).toBe(true);
        expect(result.importedCount).toBe(501);
        expect(Object.keys(result.settings.snippets)).toHaveLength(501);
        expect(result.skipped).toEqual([]);
    });

    it("entries that break a per-entry limit are skipped and reported, the rest imports", () => {
        const longTrigger = "a".repeat(51);
        const longReplacement = "x".repeat(10001);
        const file = `ok : fine\n${longTrigger} : v\nbig : ${longReplacement}`;
        const result = plan({ snippets_file: file });
        expect(result.ok).toBe(true);
        expect(Object.keys(result.settings.snippets)).toEqual(["text-snippets/ok"]);
        expect(result.skipped.map((s) => s.trigger)).toContain(longTrigger);
        expect(result.skipped.map((s) => s.trigger)).toContain("big");
        expect(result.importedCount).toBe(1);
    });

    it("a skipped entry's warning is not reported as 'changed'", () => {
        const long = "x".repeat(10001);
        const file = `big : ${long}$1 and $2\nok : a`;
        const result = plan({ snippets_file: file });
        expect(result.warnings.map((w) => w.trigger)).not.toContain("big");
    });

    it("the total-size cap still fails the whole migration (original kept by the caller)", () => {
        // 250 records x 9000 chars > 2 MiB, each below the per-entry cap.
        const file = Array.from({ length: 250 }, (_, i) => `t${i} : ${"x".repeat(9000)}`).join("\n");
        const result = plan({ snippets_file: file });
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/total size/);
        expect(result.settings.snippets).toEqual({});
    });

    it("a __proto__ trigger stays data, not prototype semantics (S-004/S-008)", () => {
        const result = plan({ snippets_file: "__proto__ : x\nok : y" });
        expect(Object.getPrototypeOf(result.settings.snippets)).toBe(Object.prototype);
        expect(Object.keys(result.settings.snippets)).not.toContain("polluted");
        expect(result.settings.snippets["text-snippets/ok"]).toBe("y");
    });
});
