import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Checker finding #1 regression guard.
 *
 * On Obsidian 1.13+, the General group (`buildGeneralDefinitions`,
 * `cls: "snipsy-expansion"`) renders straight off
 * `getSettingDefinitions()` at the declarative tree's root. Unlike the
 * Snippets/Packages `SettingPage`s (`declarative-pages.ts`), whose
 * `display()` adds `.snipsidian-settings` to `this.containerEl` by
 * hand, nothing adds that class to the root container the framework
 * builds itself — so a `.snipsidian-settings .snipsy-expansion ...`
 * selector never matches there, and the Prefix-character row never
 * dims when "Require a prefix before triggers" is off.
 *
 * jsdom doesn't apply our external stylesheet, so — same pattern as
 * `first-row-divider.test.ts` — this reads the source CSS text
 * directly rather than asserting on computed styles.
 */
describe("declarative root — is-disabled dimming reaches rows with no .snipsidian-settings ancestor", () => {
    const css = readFileSync(join(__dirname, "main.css"), "utf8");

    it("the .snipsy-expansion is-disabled dimming rule exists", () => {
        expect(css).toMatch(/\.snipsy-expansion \.setting-item\.is-disabled\s*\{[^}]*opacity:\s*0\.5/);
    });

    it("its selector does NOT start with .snipsidian-settings (that ancestor is absent at the 1.13+ declarative root)", () => {
        const match = /^([^\n{]*\.snipsy-expansion \.setting-item\.is-disabled)\s*\{/m.exec(css);
        expect(match?.[1]).toBeDefined();
        const selector = (match?.[1] ?? "").trim();
        expect(selector.startsWith(".snipsidian-settings")).toBe(false);
    });

    it("no other rule scopes a group cls used at the declarative root under .snipsidian-settings", () => {
        // snipsy-expansion is currently the only SettingDefinitionGroup
        // `cls` applied outside a custom SettingPage (declarative-pages.ts
        // wraps Snippets/Packages in a container that DOES carry
        // .snipsidian-settings, so rules scoped to their group classes
        // are fine). If a future root-level group cls gets a
        // `.snipsidian-settings`-prefixed rule, this should fail so it
        // gets the same unprefixed fix.
        const prefixedExpansionRule = /\.snipsidian-settings\s+\.snipsy-expansion\b/.exec(css);
        expect(prefixedExpansionRule).toBeNull();
    });
});
