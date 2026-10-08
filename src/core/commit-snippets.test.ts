import { describe, it, expect, vi } from "vitest";
import { commitSnippets } from "./commit-snippets";

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
