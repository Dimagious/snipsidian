import { describe, it, expect, vi, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { removeDirTolerant } from "../../e2e/remove-dir";

/** B-220: user-data-dir cleanup must retry and must never fail a passed test. */

afterEach(() => {
    vi.restoreAllMocks();
});

describe("removeDirTolerant", () => {
    it("removes a populated directory tree", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "snipsy-rm-"));
        fs.mkdirSync(path.join(dir, "a", "b"), { recursive: true });
        fs.writeFileSync(path.join(dir, "a", "b", "f.txt"), "x");
        expect(removeDirTolerant(dir)).toBe(true);
        expect(fs.existsSync(dir)).toBe(false);
    });

    it("is a no-op for a missing directory", () => {
        const dir = path.join(os.tmpdir(), "snipsy-rm-missing-" + String(Date.now()));
        expect(removeDirTolerant(dir)).toBe(true);
    });

    it("asks Node to retry ENOTEMPTY/EBUSY (maxRetries and retryDelay set)", () => {
        const rm = vi.fn();
        removeDirTolerant("/x", rm as unknown as typeof fs.rmSync);
        expect(rm).toHaveBeenCalledWith("/x", {
            recursive: true,
            force: true,
            maxRetries: 10,
            retryDelay: 100,
        });
    });

    it("warns with the path and does not throw when removal keeps failing", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const rm = vi.fn(() => {
            throw new Error("ENOTEMPTY: directory not empty");
        });
        let result: boolean | undefined;
        expect(() => {
            result = removeDirTolerant("/leaky/dir", rm as unknown as typeof fs.rmSync);
        }).not.toThrow();
        expect(result).toBe(false);
        expect(warn).toHaveBeenCalledTimes(1);
        const msg = String(warn.mock.calls[0]?.[0]);
        expect(msg).toContain("/leaky/dir");
        expect(msg).toContain("ENOTEMPTY");
    });
});
