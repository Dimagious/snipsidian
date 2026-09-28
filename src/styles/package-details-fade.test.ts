import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * UI redesign, package details item #3: the scrollable snippet-preview
 * list in the package details modal fades at the bottom to hint there
 * is more to scroll.
 *
 * jsdom doesn't apply our external stylesheet (see the B-157 guard in
 * `picker-tokens.test.ts` for the same reasoning), so this pins the
 * fade directly against the source CSS text: the rule must declare a
 * `mask-image` (plus the `-webkit-` prefix Safari still needs) and
 * every *visible* colour on the block (background/border) must come
 * from an Obsidian CSS variable, never a literal hex/rgb.
 */
describe("package details — scrollable list fade", () => {
    const css = readFileSync(join(__dirname, "main.css"), "utf8");

    function ruleBody(selector: string): string {
        const escaped = selector.replace(/[.]/g, "\\.");
        const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
        if (!match?.[1]) throw new Error(`Rule "${selector}" not found in main.css`);
        return match[1];
    }

    it("declares a bottom mask-image fade (with the -webkit- prefix)", () => {
        const body = ruleBody(".snipsidian-modal .package-snippet-preview");
        expect(body).toMatch(/(?<!-webkit-)mask-image\s*:/);
        expect(body).toMatch(/-webkit-mask-image\s*:/);
        expect(body).toMatch(/linear-gradient\(to bottom/);
    });

    it("has no hard-coded background/border colour — Obsidian CSS variables only", () => {
        const body = ruleBody(".snipsidian-modal .package-snippet-preview");
        // Strip the mask-image lines: their gradient stops are alpha
        // (opacity) stops, not themed colours, so "black"/"transparent"
        // there don't count as hard-coded colour.
        const withoutMask = body.replace(/(?:-webkit-)?mask-image\s*:[^;]*;/g, "");
        expect(withoutMask).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        expect(withoutMask).not.toMatch(/rgba?\(/);
        expect(withoutMask).toContain("var(--background-modifier-border)");
    });
});
