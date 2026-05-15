// @vitest-environment jsdom

import { describe, it, expect } from "vitest";

/**
 * Smoke test for the jsdom test environment (B-076).
 *
 * Vitest defaults to `environment: "node"` in `vitest.config.ts`,
 * which is correct for our hot-path engine + adapter tests (faster,
 * no DOM overhead). UI tests need a DOM — `jsdom` is already a
 * devDependency, so the cheapest opt-in is the per-file directive
 * `// @vitest-environment jsdom` at the very top of a test file.
 *
 * This file exists to:
 *   1. Prove the directive works in our setup
 *   2. Give the next test author a copy-pasteable example for the
 *      first line of any UI mount test
 *
 * If jsdom is misconfigured (e.g. removed from package.json),
 * vitest will fail to bootstrap this file with a clear message.
 */

describe("test environment: jsdom is wired up for UI tests", () => {
    it("exposes a DOM `document` global", () => {
        expect(typeof document).toBe("object");
        expect(document.createElement).toBeInstanceOf(Function);
    });

    it("supports basic DOM operations (createElement / appendChild / classList)", () => {
        // Smoke-test the surface Snipsy actually uses in UI: createDiv /
        // createSpan / createEl / addClass / setAttr resolve through
        // these primitives via Obsidian's HTMLElement extensions.
        const div = document.createElement("div");
        div.classList.add("test-class");
        const span = document.createElement("span");
        span.textContent = "hello";
        div.appendChild(span);

        expect(div.classList.contains("test-class")).toBe(true);
        expect(div.children.length).toBe(1);
        expect(div.textContent).toBe("hello");
    });

    it("supports event listeners (needed for UI keydown / click tests)", () => {
        const button = document.createElement("button");
        let clickCount = 0;
        button.addEventListener("click", () => {
            clickCount++;
        });
        button.click();
        button.click();
        expect(clickCount).toBe(2);
    });
});
