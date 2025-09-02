import { describe, it, expect } from "vitest";
import { getDict, mergeDefaults, replaceAllSnippets } from "./snippets";

describe("store/snippets", () => {
    it("getDict returns settings.snippets or {}", () => {
        expect(getDict({ snippets: { a: "1" } } as any)).toEqual({ a: "1" });
        expect(getDict({ snippets: undefined } as any)).toEqual({});
    });

    it("mergeDefaults prefers current over defaults", () => {
        const defs = { a: "A", b: "B" };
        const cur = { b: "b-cur", c: "C" };
        expect(mergeDefaults(cur, defs)).toEqual({ a: "A", b: "b-cur", c: "C" });
    });

    it("replaceAllSnippets accepts valid input and rejects invalid", () => {
        const settings = { snippets: { a: "1" } } as any;
        const ok = replaceAllSnippets(settings, { x: "X" });
        expect(ok).toEqual({ snippets: { x: "X" } });

        const bad = replaceAllSnippets(settings, { x: 1 } as any);
        expect(bad).toBeNull();
    });
});
