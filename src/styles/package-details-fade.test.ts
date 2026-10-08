import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PICKER_HOST_CLASS, SETTING_TEXTAREA_CLASS } from "../ui/utils/style-hooks";

/**
 * UI redesign, package details item #3: the scrollable snippet-preview
 * list in the package details modal fades at the bottom to hint there
 * is more to scroll.
 *
 * B-189: the fade used to be a CSS mask, which the community scorecard
 * flags ("css-masks" only partially supported). It is now a sticky
 * `::after` gradient strip. jsdom doesn't apply our external stylesheet
 * (see the B-157 guard in `picker-tokens.test.ts`), so this pins the
 * technique directly against the source CSS text.
 */
describe("package details — scrollable list fade", () => {
    const css = readFileSync(join(__dirname, "main.css"), "utf8");

    function ruleBody(selector: string): string {
        const escaped = selector.replace(/[.]/g, "\\.");
        const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
        if (!match?.[1]) throw new Error(`Rule "${selector}" not found in main.css`);
        return match[1];
    }

    const fade = (): string => ruleBody(".snipsidian-modal .package-snippet-preview::after");

    it("fades via a bottom-pinned ::after gradient strip, not a mask", () => {
        const body = fade();
        expect(body).toMatch(/position\s*:\s*sticky/);
        expect(body).toMatch(/bottom\s*:\s*0/);
        expect(body).toMatch(/linear-gradient\(to bottom/);
        expect(body).toMatch(/pointer-events\s*:\s*none/);
    });

    it("uses no CSS mask anywhere in the stylesheet source (scorecard css-masks)", () => {
        expect(css).not.toMatch(/\bmask\b|mask-/i);
    });

    it("gradient colour and list chrome come from Obsidian CSS variables only", () => {
        const body = fade();
        expect(body).toContain("var(--background-secondary");
        expect(body).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        expect(body).not.toMatch(/rgba?\(/);
        const list = ruleBody(".snipsidian-modal .package-snippet-preview");
        expect(list).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        expect(list).not.toMatch(/rgba?\(/);
        expect(list).toContain("var(--background-modifier-border)");
    });

    it("does not use :has() anywhere in the stylesheet source (scorecard avoid-has)", () => {
        expect(css).not.toContain(":has(");
    });

    // B-189: the TS side adds these classes, the CSS side styles them. If
    // either is renamed alone the layout silently regresses (jsdom can't
    // see it), so pin both ends to the shared constants.
    it("main.css styles the textarea-row class that TS adds", () => {
        expect(css).toContain(`.setting-item.${SETTING_TEXTAREA_CLASS}`);
        expect(css).toContain(`.setting-item.${SETTING_TEXTAREA_CLASS} textarea`);
    });

    it("main.css styles the picker host class that TS adds", () => {
        expect(css).toContain(`.modal.${PICKER_HOST_CLASS} .modal-title`);
    });
});
