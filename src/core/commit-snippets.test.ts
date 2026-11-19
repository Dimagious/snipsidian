import { describe, it, expect, vi } from "vitest";
import { commitSnippets, commitSnippetsAndPatterns } from "./commit-snippets";
import type { PatternRule } from "../engine/types";

describe("commitSnippets (B-181)", () => {
    it("assigns the new map and saves on success", async () => {
        const settings = { snippets: { a: "1" } };
        const next = { a: "1", b: "2" };
        const save = vi.fn().mockResolvedValue(undefined);
        await commitSnippets(settings, next, save);
        expect(settings.snippets).toBe(next);
        expect(save).toHaveBeenCalledTimes(1);
    });

    it("the new map is already in place when save runs", async () => {
        const settings = { snippets: { a: "1" } };
        const next = { b: "2" };
        let seen: Record<string, string> | undefined;
        await commitSnippets(settings, next, async () => {
            seen = settings.snippets;
        });
        expect(seen).toBe(next);
    });

    it("restores the exact previous object and rethrows when save rejects", async () => {
        const previous = { a: "1" };
        const settings = { snippets: previous };
        const err = new Error("disk full");
        await expect(
            commitSnippets(settings, { a: "1", b: "2" }, () => Promise.reject(err)),
        ).rejects.toBe(err);
        expect(settings.snippets).toBe(previous);
        expect(settings.snippets).toEqual({ a: "1" });
    });

    it("restores when save throws synchronously-rejecting async fn", async () => {
        const previous = {};
        const settings = { snippets: previous };
        await expect(
            commitSnippets(settings, { x: "y" }, async () => {
                throw new Error("nope");
            }),
        ).rejects.toThrow("nope");
        expect(settings.snippets).toBe(previous);
    });
});

describe("commitSnippetsAndPatterns (ADR-0008)", () => {
    const rule = (id: string): PatternRule => ({ id, source: `/${id}$/`, replacement: id, enabled: true, mode: "instant" });

    it("replaces both lists and saves once, with both already in place when save runs", async () => {
        const settings: { snippets: Record<string, string>; patterns?: PatternRule[] } = { snippets: { a: "1" }, patterns: [rule("old")] };
        const nextSnippets = { a: "1", b: "2" };
        const nextPatterns = [rule("old"), rule("new")];
        let seen: unknown[] = [];
        const save = vi.fn(async () => {
            seen = [settings.snippets, settings.patterns];
        });
        await commitSnippetsAndPatterns(settings, nextSnippets, nextPatterns, save);
        expect(seen).toEqual([nextSnippets, nextPatterns]);
        expect(settings.snippets).toBe(nextSnippets);
        expect(settings.patterns).toBe(nextPatterns);
        expect(save).toHaveBeenCalledTimes(1);
    });

    it("puts BOTH previous lists back, the same objects, and rethrows when save rejects", async () => {
        const previousSnippets = { a: "1" };
        const previousPatterns = [rule("old")];
        const settings: { snippets: Record<string, string>; patterns?: PatternRule[] } = { snippets: previousSnippets, patterns: previousPatterns };
        const err = new Error("disk full");
        await expect(commitSnippetsAndPatterns(settings, { z: "9" }, [rule("new")], () => Promise.reject(err))).rejects.toBe(err);
        expect(settings.snippets).toBe(previousSnippets);
        expect(settings.patterns).toBe(previousPatterns);
    });

    it("restores 'no patterns yet' as undefined, not as an empty list", async () => {
        const settings: { snippets: Record<string, string>; patterns?: PatternRule[] } = { snippets: {} };
        await expect(commitSnippetsAndPatterns(settings, { a: "1" }, [rule("n")], () => Promise.reject(new Error("x")))).rejects.toThrow("x");
        expect(settings.patterns).toBeUndefined();
    });

    it("does not undo a newer write that replaced the lists while the save was pending", async () => {
        const settings: { snippets: Record<string, string>; patterns?: PatternRule[] } = { snippets: { a: "1" }, patterns: [] };
        const newerSnippets = { newer: "s" };
        const newerPatterns = [rule("newer")];
        await expect(
            commitSnippetsAndPatterns(settings, { b: "2" }, [rule("n")], async () => {
                settings.snippets = newerSnippets;
                settings.patterns = newerPatterns;
                throw new Error("late failure");
            }),
        ).rejects.toThrow("late failure");
        expect(settings.snippets).toBe(newerSnippets);
        expect(settings.patterns).toBe(newerPatterns);
    });
});
