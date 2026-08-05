import { describe, it, expect } from "vitest";
import { shouldOpenPackageDetailsOnKeydown } from "./PackageBrowser";

/**
 * B-135 regression: `renderRow`'s keydown handler used to fire
 * `preventDefault()` + open-details on Enter/Space with no check of
 * `e.target`. Keydown bubbles up from the row's inner Install /
 * Uninstall buttons regardless of those buttons' click handlers
 * calling `stopPropagation()` (that only stops `click`, not
 * `keydown`) — so a keyboard user tabbed onto Install and pressing
 * Enter had the row hijack the event: `preventDefault()` cancelled
 * the browser's native "activate the focused button" default action,
 * the button's own click handler never ran, and the details modal
 * opened instead of installing.
 *
 * `PackageBrowser.ts` is coverage-excluded (vitest.config.ts) and has
 * no mount-test scaffolding; per ADR-0005 the keydown *decision* was
 * extracted into a small pure, exported function so the hijack case
 * and the legitimate row case can still be pinned without mounting
 * the full component (network loader, plugin settings, etc).
 */
describe("shouldOpenPackageDetailsOnKeydown (B-135)", () => {
    it("does NOT open details when the keydown target is a descendant (e.g. the Install button) — the hijack case", () => {
        const row = {} as EventTarget;
        const installButton = {} as EventTarget;

        expect(shouldOpenPackageDetailsOnKeydown("Enter", installButton, row)).toBe(false);
        expect(shouldOpenPackageDetailsOnKeydown(" ", installButton, row)).toBe(false);
    });

    it("opens details on Enter/Space when the keydown target IS the row itself", () => {
        const row = {} as EventTarget;

        expect(shouldOpenPackageDetailsOnKeydown("Enter", row, row)).toBe(true);
        expect(shouldOpenPackageDetailsOnKeydown(" ", row, row)).toBe(true);
    });

    it("ignores other keys even when the target is the row", () => {
        const row = {} as EventTarget;

        expect(shouldOpenPackageDetailsOnKeydown("Tab", row, row)).toBe(false);
        expect(shouldOpenPackageDetailsOnKeydown("ArrowDown", row, row)).toBe(false);
    });

    it("treats a null event target (no focus) as not-the-row", () => {
        const row = {} as EventTarget;
        expect(shouldOpenPackageDetailsOnKeydown("Enter", null, row)).toBe(false);
    });
});
