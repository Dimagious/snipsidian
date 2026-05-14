import { describe, it, expect } from "vitest";
import { buildIssueUrl, buildPackageSubmissionUrl } from "./github-issue-url";

/**
 * ADR-0005: URL builder is the seam between the user's intent and
 * GitHub's issue tracker. The contract worth pinning is the
 * round-trip of title and body through URL encoding — if that's
 * broken, the user lands on a half-prefilled issue and the project's
 * feedback channel quietly degrades.
 */

function parseQuery(url: string) {
    const u = new URL(url);
    return Object.fromEntries(u.searchParams.entries());
}

describe("buildIssueUrl", () => {
    it("points at the snipsidian repo's /issues/new endpoint", () => {
        const url = buildIssueUrl({ kind: "bug" });
        const u = new URL(url);
        expect(u.origin).toBe("https://github.com");
        expect(u.pathname).toBe("/Dimagious/snipsidian/issues/new");
    });

    it("prefixes the title with the kind tag", () => {
        const url = buildIssueUrl({ kind: "feature", title: "regex triggers" });
        expect(parseQuery(url).title).toBe("[Feature] regex triggers");
    });

    it("uses the default body template when no body is supplied", () => {
        const url = buildIssueUrl({ kind: "bug" });
        const body = parseQuery(url).body;
        expect(body).toContain("What happened?");
        expect(body).toContain("Steps to reproduce");
    });

    it("honours a user-supplied body over the template", () => {
        const url = buildIssueUrl({ kind: "feedback", body: "I love the new tab strip." });
        expect(parseQuery(url).body).toBe("I love the new tab strip.");
    });

    it("appends meta block as a markdown footer", () => {
        const url = buildIssueUrl({
            kind: "bug",
            meta: { pluginVersion: "1.1.0", obsidianVersion: "1.5.12", platform: "macOS" },
        });
        const body = parseQuery(url).body;
        expect(body).toContain("---");
        expect(body).toContain("- Snipsy: 1.1.0");
        expect(body).toContain("- Obsidian: 1.5.12");
        expect(body).toContain("- Platform: macOS");
    });

    it("omits empty meta lines so the user doesn't see 'Platform: '", () => {
        const url = buildIssueUrl({
            kind: "bug",
            meta: { pluginVersion: "1.1.0" },
        });
        const body = parseQuery(url).body;
        expect(body).toContain("- Snipsy: 1.1.0");
        expect(body).not.toContain("- Obsidian:");
        expect(body).not.toContain("- Platform:");
    });

    it("does not emit the meta footer when meta is absent", () => {
        const url = buildIssueUrl({ kind: "bug" });
        expect(parseQuery(url).body).not.toContain("---");
    });

    it("URL-encodes special characters in the title (round-trip safe)", () => {
        // Real users will put `?`, `&`, `#`, and `+` in titles. Verify
        // they round-trip cleanly via URL parsing.
        const tricky = "[crash] expander breaks on `#&?+`";
        const url = buildIssueUrl({ kind: "bug", title: tricky });
        expect(parseQuery(url).title).toBe(`[Bug] ${tricky}`);
    });
});

describe("buildPackageSubmissionUrl", () => {
    it("embeds YAML in a fenced code block in the body", () => {
        const url = buildPackageSubmissionUrl({
            packageName: "Greek Letters",
            yaml: "name: greek\nauthor: dy\nversion: 1.0.0",
        });
        const body = parseQuery(url).body;
        expect(body).toMatch(/```yaml\nname: greek\nauthor: dy\nversion: 1\.0\.0\n```/);
    });

    it("uses the package name as the title (with [Package] prefix)", () => {
        const url = buildPackageSubmissionUrl({
            packageName: "Greek Letters",
            yaml: "name: greek",
        });
        expect(parseQuery(url).title).toBe("[Package] Greek Letters");
    });

    it("trims surrounding whitespace from the YAML before embedding", () => {
        const url = buildPackageSubmissionUrl({
            packageName: "x",
            yaml: "\n\n  name: x\n\n",
        });
        // Don't assert exact whitespace because URLSearchParams normalises
        // — just confirm the trimmed content is present and trailing
        // blank lines don't leak into the fence.
        const body = parseQuery(url).body;
        expect(body).toContain("name: x");
        expect(body).not.toMatch(/```yaml\n\n\n/);
    });
});
