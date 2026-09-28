import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * B-159 regression guard: every filled settings group (General, About,
 * Packages' "Community packages"/"Share a package"/"Espanso import")
 * showed a thin divider line along the top inner edge of the box.
 *
 * `.setting-item:not(.setting-item-heading) { border-top: ... }`
 * (main.css) matches every row regardless of position, including the
 * first row of a group's body — where that straight `border-top` sits
 * right against the box's rounded top corners, showing as a stray arc.
 * Obsidian's own filled pages (Editor,
 * Hotkeys) never draw a divider above a group's first row.
 *
 * The fallback branch (`renderSettingGroup`'s pre-1.11 path,
 * `.snipsy-group-fallback`) already zeroed this for its first row.
 * This test pins the same zeroing for the native `SettingGroup`
 * branch (`.setting-group .setting-items`), which was missing it.
 *
 * jsdom doesn't apply our external stylesheet, so — same pattern as
 * `picker-tokens.test.ts` — this reads the source CSS text directly
 * rather than asserting on computed styles.
 */
describe("B-159 — no divider above a filled group's first row", () => {
    const css = readFileSync(join(__dirname, "main.css"), "utf8");

    /** The rule body for `selector { ... }`, isolated so assertions
     *  don't false-positive on some other selector that happens to
     *  share a substring. */
    function ruleBody(selector: string): string {
        const escaped = selector.replace(/[.]/g, "\\.");
        const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
        if (!match?.[1]) throw new Error(`Rule "${selector}" not found in main.css`);
        return match[1];
    }

    it("native SettingGroup branch: the first row's border-top is zeroed", () => {
        const body = ruleBody(".snipsidian-settings .setting-group .setting-items .setting-item:first-child");
        expect(body).toMatch(/border-top:\s*0/);
    });

    it("pre-1.11 fallback branch: the first row's border-top is still zeroed", () => {
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
