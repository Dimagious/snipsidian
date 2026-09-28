import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * B-157 regression guard: the snippet picker's selected row used
 * `--interactive-accent-translucent` (a variable that doesn't exist
 * in Obsidian 1.13's `app.css` — falls back to a hard-coded
 * `rgba(125,103,255,.22)`) as its background, with the trigger text
 * painted `--text-on-accent` on top. In light theme that's white text
 * on a near-white background — the selected trigger was invisible,
 * and since a single search result is always selected, the very first
 * thing a user typed became unreadable.
 *
 * DOM-level tests (`SnippetPickerModal.test.ts`) already pin that the
 * `.selected` class toggles onto the right row; jsdom doesn't apply
 * our external stylesheet, so the only way to pin *which token* backs
 * that class — the actual bug — is to check the source CSS text
 * directly. This fails if the selected-row rule reverts to the old
 * token or the pale-background + on-accent-text pairing.
 */
describe("B-157 — picker selected-row contrast token", () => {
    const css = readFileSync(join(__dirname, "main.css"), "utf8");

    /** The `.snippet-item.selected { ... }` rule body, isolated so
     *  assertions don't false-positive on some *other* selector in the
     *  file that happens to mention these tokens. */
    function ruleBody(selector: string): string {
        const escaped = selector.replace(/[.]/g, "\\.");
        const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
        if (!match?.[1]) throw new Error(`Rule "${selector}" not found in main.css`);
        return match[1];
    }

    it("the selected row's background is --background-modifier-hover, not the dead accent-translucent token", () => {
        const body = ruleBody(".snippet-picker-modal .snippet-item.selected");
        expect(body).toContain("--background-modifier-hover");
        expect(body).not.toContain("interactive-accent-translucent");
        expect(body).not.toMatch(/rgba\(/);
    });

    it("the selected trigger text stays --text-normal, not --text-on-accent", () => {
        const body = ruleBody(".snippet-picker-modal .snippet-item.selected .snippet-name span");
        expect(body).toContain("--text-normal");
        expect(body).not.toContain("--text-on-accent");
    });

    it("main.css no longer references the two Obsidian-1.13-undefined accent variables anywhere outside comments", () => {
        const codeOnly = css.replace(/\/\*[\s\S]*?\*\//g, "");
        expect(codeOnly).not.toContain("--interactive-accent-translucent");
        expect(codeOnly).not.toContain("--interactive-accent-rgb");
    });
});
