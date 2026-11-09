import { describe, it, expect } from "vitest";
import {
    compareObsidianVersions,
    isExplicitVersion,
    normalizeVersion,
} from "../../e2e/obsidian-version";

/**
 * B-221: the e2e fixture compares the Obsidian it was meant to test with the
 * one that actually booted. The comparison is pure and lives in `e2e/`, so it
 * is pinned here (vitest only collects under `src/`). Each case would fail if
 * the check were loosened into "close enough" or into a silent pass.
 */
describe("compareObsidianVersions (B-221)", () => {
    it("reports a match for identical versions", () => {
        const v = compareObsidianVersions("1.14.5", "1.14.5");
        expect(v.status).toBe("match");
        expect(v.message).toContain("1.14.5");
    });

    it("tolerates surrounding whitespace from a file or IPC reply", () => {
        expect(compareObsidianVersions(" 1.14.5\n", "1.14.5 ").status).toBe("match");
    });

    it("flags a mismatch and names both versions", () => {
        const v = compareObsidianVersions("1.14.5", "1.13.7");
        expect(v.status).toBe("mismatch");
        expect(v.message).toContain("expected 1.14.5");
        expect(v.message).toContain("1.13.7");
    });

    it("does not treat a patch difference as close enough", () => {
        expect(compareObsidianVersions("1.14.5", "1.14.6").status).toBe("mismatch");
    });

    it("is unknown (not a failure) when the running version is unreadable", () => {
        expect(compareObsidianVersions("1.14.5", null).status).toBe("unknown");
        expect(compareObsidianVersions("1.14.5", "").status).toBe("unknown");
    });

    it("is unknown when there is nothing to compare against", () => {
        const v = compareObsidianVersions(null, "1.14.5");
        expect(v.status).toBe("unknown");
        expect(v.message).toContain("1.14.5");
        expect(compareObsidianVersions(undefined, "1.14.5").status).toBe("unknown");
    });
});

describe("isExplicitVersion / normalizeVersion (B-221)", () => {
    it("accepts plain x.y.z only", () => {
        expect(isExplicitVersion("1.14.5")).toBe(true);
        expect(isExplicitVersion("public-latest")).toBe(false);
        expect(isExplicitVersion("1.14")).toBe(false);
        expect(isExplicitVersion("1.14.5-beta")).toBe(false);
        expect(isExplicitVersion("")).toBe(false);
    });

    it("normalizes empty and whitespace-only input to null", () => {
        expect(normalizeVersion("  ")).toBeNull();
        expect(normalizeVersion(undefined)).toBeNull();
        expect(normalizeVersion(" 1.0.0 ")).toBe("1.0.0");
    });
});
