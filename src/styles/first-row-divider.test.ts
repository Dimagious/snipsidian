import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * B-159/B-162 regression guard.
 *
 * B-159 (original): every filled settings group (General, About,
 * Packages' "Community packages"/"Share a package"/"Espanso import")
 * showed a thin divider line along the top inner edge of the box,
 * because `.setting-item:not(.setting-item-heading) { border-top:
 * ... }` (main.css) matched every row regardless of position,
 * including the first row of a group's body — where that straight
 * `border-top` sits right against the box's rounded top corners,
 * showing as a stray arc.
 *
 * B-162 (this file's update): the fix wasn't only a first-row
 * problem. Obsidian's own `.setting-group .setting-items` CSS already
 * draws a divider between rows inside a native `SettingGroup` — our
 * own `border-top` rule was drawing a SECOND one on every non-first
 * row too, not just producing an arc on the first. The native branch
 * now draws NO border-top of its own on any row (not just
 * `:first-child`), relying entirely on Obsidian's native divider. The
 * pre-1.11 fallback branch (`.snipsy-group-fallback`, which has no
 * native divider CSS to lean on) keeps its own — that guard hasn't
 * changed and is still pinned below.
 *
 * jsdom doesn't apply our external stylesheet, so — same pattern as
 * `picker-tokens.test.ts` — this reads the source CSS text directly
 * rather than asserting on computed styles.
 */
describe("B-159/B-162 — dividers inside a filled group", () => {
    const css = readFileSync(join(__dirname, "main.css"), "utf8");

    /** The rule body for `selector { ... }`, isolated so assertions
     *  don't false-positive on some other selector that happens to
     *  share a substring. */
    function ruleBody(selector: string): string {
        const escaped = selector.replace(/[.()]/g, "\\$&");
        const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
        if (!match?.[1]) throw new Error(`Rule "${selector}" not found in main.css`);
        return match[1];
    }

    it("native SettingGroup branch: no row (not just the first) draws its own border-top — relies on Obsidian's native divider", () => {
        const body = ruleBody(
            ".snipsidian-settings .setting-group .setting-items .setting-item:not(.setting-item-heading)",
        );
        expect(body).toMatch(/border-top:\s*0/);
    });

    it("pre-1.11 fallback branch: still draws its own divider, zeroed only on the first row", () => {
        const body = ruleBody(".snipsidian-settings .snipsy-group-fallback .setting-item:first-child");
        expect(body).toMatch(/border-top:\s*0/);
    });

    it("Packages list: the first package row's border-top is still zeroed", () => {
        const body = ruleBody(".snipsidian-settings .package-row:first-child");
        expect(body).toMatch(/border-top:\s*0/);
    });

    it("Snippets list: groups are only bordered via `+` (adjacent-sibling), which structurally excludes the first group", () => {
        // No `:first-child` override should be needed here — if a bare
        // `.snippet-group { border-top: ... }` rule (matching every
        // group, not just non-first ones) ever gets introduced, this
        // guards that the divider-generating rule for the list stays
        // scoped to the `+` combinator instead.
        const body = ruleBody(".snipsidian-settings .snippet-group \\+ .snippet-group");
        expect(body).toMatch(/border-top:\s*1px/);
    });
});
