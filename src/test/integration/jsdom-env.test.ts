import { describe, it, expect } from "vitest";

/**
 * Smoke test for the jsdom test environment (B-076).
 *
 * Tests run in `node` by default, which is correct for our hot-path
 * engine + adapter tests (faster, no DOM overhead). UI tests need a DOM
 * and the Obsidian DOM helpers: a test file opts in by being listed in
 * the `dom` option of `defineUnitConfig()` in `vitest.config.ts`
 * (everything under `src/ui`, plus a few single files, this one among them).
 *
 * This file exists to:
 *   1. Prove the `dom` project gives a file jsdom and the helpers
 *   2. Give the next test author a smoke test to run when a file
 *      moved to the `dom` list misbehaves
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
