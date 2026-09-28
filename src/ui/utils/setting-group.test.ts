// @vitest-environment jsdom

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { installObsidianDomHelpers } from "../../test/dom-polyfill";

/**
 * `renderSettingGroup` (src/ui/utils/setting-group.ts) feature-detects
 * Obsidian's `SettingGroup` class (>= 1.11.0) at runtime and falls
 * back to a hand-built heading + rows shape on older installs — see
 * the owner's decision #1 in the redesign task: "feature-detect at
 * runtime; the fallback must look acceptable (same headings, same
 * order)". Both branches are exercised here: the default `obsidian`
 * test stub exports `SettingGroup` (mirrors Obsidian >= 1.11), so the
 * "available" describe block covers that branch directly; the
 * "fallback" block re-imports the module against a mocked `obsidian`
 * with `SettingGroup` stripped out, mirroring an older install.
 */

beforeAll(() => {
    installObsidianDomHelpers();
});

beforeEach(() => {
    document.body.innerHTML = "";
});

function mountRoot(): HTMLElement {
    const root = document.createElement("div");
    document.body.appendChild(root);
    return root;
}

describe("renderSettingGroup — SettingGroup available (Obsidian >= 1.11)", () => {
    it("renders a sentence-case heading over a .snipsy-group body of rows", async () => {
        vi.resetModules();
        const { renderSettingGroup } = await import("./setting-group");
        const root = mountRoot();

        const group = renderSettingGroup(root, "Expansion");
        group.addSetting((s) => s.setName("Require a prefix before triggers"));

        const headingName = root.querySelector(".setting-item-heading .setting-item-name");
        expect(headingName?.textContent).toBe("Expansion");

        // Uses the native SettingGroup path: `addClass` targets the
        // outer `groupEl`, which carries Obsidian's own `.setting-group`
        // class alongside our `.snipsy-group` (F4: NOT the rows-only
        // `.setting-items` body — the heading stays outside the fill).
        expect(root.querySelector(".setting-group.snipsy-group")).toBeTruthy();
        expect(root.querySelector(".snipsy-group-fallback")).toBeNull();

        // Query the rows body directly (`group.bodyEl`) rather than
        // `.snipsy-group .setting-item-name`, which would also match
        // the heading's own name — the heading is nested inside
        // `.snipsy-group` now, immediately before the rows body.
        const rowName = group.bodyEl.querySelector(".setting-item-name");
        expect(rowName?.textContent).toBe("Require a prefix before triggers");
    });

    it("addExtraButton mounts a clickable icon with a tooltip and aria-label next to the heading", async () => {
        vi.resetModules();
        const { renderSettingGroup } = await import("./setting-group");
        const root = mountRoot();

        let clicked = false;
        const group = renderSettingGroup(root, "Community packages");
        group.addExtraButton((b) =>
            b.setIcon("refresh-cw").setTooltip("Refresh packages").onClick(() => {
                clicked = true;
            }),
        );

        const btn = root.querySelector(".extra-setting-button") as HTMLElement;
        expect(btn).toBeTruthy();
        expect(btn.getAttribute("aria-label")).toBe("Refresh packages");
        btn.click();
        expect(clicked).toBe(true);
    });

    it("addSearch docks a search input at the top of the group", async () => {
        vi.resetModules();
        const { renderSettingGroup } = await import("./setting-group");
        const root = mountRoot();

        const group = renderSettingGroup(root, "Community packages");
        group.addSearch((s) => s.setPlaceholder("Filter packages"));
        group.addSetting((s) => s.setName("Basic emojis"));

        const body = root.querySelector(".snipsy-group") as HTMLElement;
        const input = body.querySelector("input[type=search]") as HTMLInputElement;
        expect(input.placeholder).toBe("Filter packages");
    });

    it("bodyEl accepts arbitrary custom row markup (used by the Packages catalog)", async () => {
        vi.resetModules();
        const { renderSettingGroup } = await import("./setting-group");
        const root = mountRoot();

        const group = renderSettingGroup(root, "Community packages");
        group.bodyEl.createDiv({ cls: "package-row", text: "Basic Emojis" });

        expect(root.querySelector(".snipsy-group .package-row")?.textContent).toBe("Basic Emojis");
    });
});

describe("renderSettingGroup — fallback (Obsidian < 1.11, no SettingGroup)", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.doMock("obsidian", async () => {
            const actual = await vi.importActual<Record<string, unknown>>("obsidian");
            const { SettingGroup: _drop, ...rest } = actual;
            return rest;
        });
    });

    it("renders the identical heading text, in the identical order, without SettingGroup", async () => {
        const { renderSettingGroup } = await import("./setting-group");
        const root = mountRoot();

        const group = renderSettingGroup(root, "Expansion");
        group.addSetting((s) => s.setName("Require a prefix before triggers"));

        const headingName = root.querySelector(".setting-item-heading .setting-item-name");
        expect(headingName?.textContent).toBe("Expansion");
        expect(root.querySelector(".setting-group")).toBeNull();

        const body = root.querySelector(".snipsy-group.snipsy-group-fallback") as HTMLElement;
        expect(body).toBeTruthy();
        expect(body.querySelector(".setting-item-name")?.textContent).toBe(
            "Require a prefix before triggers",
        );
        // Heading comes immediately before the body, same as the native
        // SettingGroup branch — "same headings, same order".
        expect(headingName?.closest(".setting-item-heading")?.nextElementSibling).toBe(body);
    });

    it("addExtraButton mounts onto the heading row so it still sits next to the heading", async () => {
        const { renderSettingGroup } = await import("./setting-group");
        const root = mountRoot();

        let clicked = false;
        const group = renderSettingGroup(root, "Community packages");
        group.addExtraButton((b) =>
            b.setTooltip("Refresh packages").onClick(() => {
                clicked = true;
            }),
        );

        const heading = root.querySelector(".setting-item-heading") as HTMLElement;
        const btn = heading.querySelector(".extra-setting-button") as HTMLElement;
        expect(btn).toBeTruthy();
        expect(btn.getAttribute("aria-label")).toBe("Refresh packages");
        btn.click();
        expect(clicked).toBe(true);
    });

    it("addSearch renders as the group's first row (no native search-in-group affordance)", async () => {
        const { renderSettingGroup } = await import("./setting-group");
        const root = mountRoot();

        const group = renderSettingGroup(root, "Community packages");
        group.addSearch((s) => s.setPlaceholder("Filter packages"));
        group.addSetting((s) => s.setName("Basic emojis"));

        const body = root.querySelector(".snipsy-group-fallback") as HTMLElement;
        const input = body.querySelector("input[type=search]") as HTMLInputElement;
        expect(input.placeholder).toBe("Filter packages");
        const names = Array.from(body.querySelectorAll(".setting-item-name")).map(
            (el) => el.textContent,
        );
        expect(names).toContain("Basic emojis");
    });

    it("bodyEl accepts arbitrary custom row markup, same as the SettingGroup branch", async () => {
        const { renderSettingGroup } = await import("./setting-group");
        const root = mountRoot();

        const group = renderSettingGroup(root, "Community packages");
        group.bodyEl.createDiv({ cls: "package-row", text: "Basic Emojis" });

        expect(root.querySelector(".snipsy-group-fallback .package-row")?.textContent).toBe(
            "Basic Emojis",
        );
    });
});
