// @vitest-environment jsdom

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

const noticeCalls: string[] = [];
vi.mock("obsidian", async () => {
    const actual = await vi.importActual("../../../test/stubs/obsidian");
    return {
        ...actual,
        Notice: vi.fn().mockImplementation((msg: string) => {
            noticeCalls.push(msg);
        }),
    };
});

import { installObsidianDomHelpers } from "../../../test/dom-polyfill";
import { makeMockPlugin } from "../../../test/factories/plugin";
import { PackageSubmissionSection } from "./PackageSubmissionSection";
import type { App } from "obsidian";
import type SnipSidianPlugin from "../../../../main";

/**
 * Mount tests for "Share a package" (PackageSubmissionSection).
 *
 * UI redesign (2026-09): this section moved from hand-rolled divs to
 * `renderSettingGroup` (a sentence-case "Share a package" heading over
 * a filled group of `Setting` rows — Build map: "Grouped setting rows
 * (General, About, Share, Espanso)"). Previously had zero mount-test
 * coverage; these pin the validate → enable-submit → open-issue
 * contract end to end.
 */

beforeAll(() => {
    installObsidianDomHelpers();
});

let plugin: ReturnType<typeof makeMockPlugin>;
let app: App;
let windowOpenSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    document.body.innerHTML = "";
    noticeCalls.length = 0;
    plugin = makeMockPlugin();
    app = plugin.app as unknown as App;
    windowOpenSpy = vi.spyOn(window, "open").mockReturnValue({} as Window);
});

function mount(): {
    root: HTMLElement;
    yaml: HTMLTextAreaElement;
    validateBtn: HTMLButtonElement;
    submitBtn: HTMLButtonElement;
} {
    const root = document.createElement("div");
    document.body.appendChild(root);
    new PackageSubmissionSection(app, plugin as unknown as SnipSidianPlugin).render(root);
    const yaml = root.querySelector(".snipsy-submit-textarea") as HTMLTextAreaElement;
    const buttons = Array.from(root.querySelectorAll("button"));
    const validateBtn = buttons.find((b) => b.textContent === "Validate") as HTMLButtonElement;
    const submitBtn = buttons.find((b) => b.textContent === "Open submission issue") as HTMLButtonElement;
    if (!yaml || !validateBtn || !submitBtn) {
        throw new Error("PackageSubmissionSection did not render expected elements");
    }
    return { root, yaml, validateBtn, submitBtn };
}

const VALID_YAML = `
name: Meeting kit
author: you
version: 1.0.0
description: A handful of meeting note snippets.
snippets:
  - trigger: "mtg"
    replace: "## Meeting: $|"
`.trim();

describe("PackageSubmissionSection — shape", () => {
    // B-189: replaces the scorecard-flagged `.setting-item:has(textarea)`.
    it("[B-189] tags the YAML row with snipsy-setting-textarea", () => {
        const { yaml } = mount();
        expect(yaml.closest(".setting-item")?.classList.contains("snipsy-setting-textarea")).toBe(true);
    });

    it("renders the 'Share a package' heading over a filled group", () => {
        const { root } = mount();
        const heading = Array.from(
            root.querySelectorAll(".setting-item-heading .setting-item-name"),
        ).find((el) => el.textContent === "Share a package");
        expect(heading).toBeTruthy();
    });

    it("Open submission issue starts disabled until a valid package is validated", () => {
        const { submitBtn } = mount();
        expect(submitBtn.disabled).toBe(true);
    });

    // F2: the intro line is built directly into the row's `descEl`
    // (`appendText` + `createEl("a", ...)`) instead of a detached
    // `DocumentFragment` passed to `setDesc`. Pins both the visible
    // text and the example-packs link's href/target/rel — a test that
    // would fail if a future change dropped the link, stringified the
    // description, or lost the `noopener noreferrer` attributes.
    it("the intro description renders as real text plus a working 'See existing packs' link in descEl", () => {
        const { root } = mount();
        // The intro row is the first `Setting` this component mounts,
        // so its `descEl` is the first `.setting-item-description` in
        // document order — true for both `renderSettingGroup` branches
        // (native `SettingGroup` nests the heading and rows under one
        // `.setting-group`; the pre-1.11 fallback renders the heading
        // as a standalone sibling row instead), so this doesn't need
        // to know which one rendered.
        const descEl = root.querySelector(".setting-item-description") as HTMLElement;

        expect(descEl.textContent).toContain(
            "Paste your package YAML to validate it, then open a GitHub issue to submit it for review.",
        );
        const link = descEl.querySelector("a") as HTMLAnchorElement;
        expect(link).toBeTruthy();
        expect(link.textContent).toBe("See existing packs as examples");
        expect(link.getAttribute("href")).toBe(
            "https://github.com/Dimagious/snipsidian-community/tree/main/community-packages/approved",
        );
        expect(link.getAttribute("target")).toBe("_blank");
        expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    });
});

describe("PackageSubmissionSection — validate", () => {
    it("empty YAML reports an error and keeps submit disabled", () => {
        const { root, validateBtn, submitBtn } = mount();
        validateBtn.click();

        expect(root.querySelector(".snipsy-submit-invalid")).toBeTruthy();
        expect(submitBtn.disabled).toBe(true);
    });

    it("missing required fields reports an error", () => {
        const { root, yaml, validateBtn } = mount();
        yaml.value = "name: Only a name";
        validateBtn.click();

        const invalid = root.querySelector(".snipsy-submit-invalid");
        expect(invalid?.textContent).toContain("Missing required fields");
    });

    it("a valid package shows the success state and enables submit", () => {
        const { root, yaml, validateBtn, submitBtn } = mount();
        yaml.value = VALID_YAML;
        validateBtn.click();

        expect(root.querySelector(".snipsy-submit-valid")?.textContent).toContain(
            "Package is valid",
        );
        expect(submitBtn.disabled).toBe(false);
    });

    it("invalid YAML syntax reports a parse error", () => {
        const { root, yaml, validateBtn } = mount();
        yaml.value = "not: valid: yaml: [";
        validateBtn.click();

        expect(root.querySelector(".snipsy-submit-invalid")?.textContent).toContain(
            "Failed to parse YAML",
        );
    });
});

describe("PackageSubmissionSection — submit", () => {
    it("clicking Validate then Open submission issue opens a prefilled GitHub URL", async () => {
        const { yaml, validateBtn, submitBtn } = mount();
        yaml.value = VALID_YAML;
        validateBtn.click();
        submitBtn.click();
        await Promise.resolve();

        expect(windowOpenSpy).toHaveBeenCalledTimes(1);
        const [url] = windowOpenSpy.mock.calls[0] as [string, string, string];
        expect(url).toContain("github.com");
        expect(url).toContain("issues/new");
    });

    it("a popup-blocked submit (window.open returns null) shows a Notice instead of silently succeeding", async () => {
        windowOpenSpy.mockReturnValue(null);
        // No clipboard in this test environment — exercises the
        // "could not copy either" branch of the Notice message.
        const { yaml, validateBtn, submitBtn } = mount();
        yaml.value = VALID_YAML;
        validateBtn.click();
        submitBtn.click();
        await Promise.resolve();
        await Promise.resolve();

        expect(noticeCalls.some((m) => m.includes("Popup blocked"))).toBe(true);
    });

    it("submit clears the form on success", async () => {
        const { yaml, validateBtn, submitBtn } = mount();
        yaml.value = VALID_YAML;
        validateBtn.click();
        submitBtn.click();
        await Promise.resolve();

        expect(yaml.value).toBe("");
        expect(submitBtn.disabled).toBe(true);
    });
});
