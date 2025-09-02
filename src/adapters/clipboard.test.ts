/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { readClipboardSafe } from "./clipboard";

afterEach(() => {
    // cleanup clipboard stub
    try {
        // @ts-ignore
        delete (navigator as any).clipboard;
    } catch { }
});

describe("adapters/clipboard.readClipboardSafe", () => {
    it("returns clipboard text when navigator.clipboard.readText exists", async () => {
        Object.defineProperty(navigator, "clipboard", {
            value: { readText: vi.fn().mockResolvedValue("CLIP") },
            configurable: true,
        });
        await expect(readClipboardSafe()).resolves.toBe("CLIP");
    });

    it("returns empty string when clipboard not available", async () => {
        // no clipboard defined in jsdom by default
        await expect(readClipboardSafe()).resolves.toBe("");
    });

    it("swallows errors and returns empty string", async () => {
        Object.defineProperty(navigator, "clipboard", {
            value: { readText: vi.fn().mockRejectedValue(new Error("nope")) },
            configurable: true,
        });
        await expect(readClipboardSafe()).resolves.toBe("");
    });
});
