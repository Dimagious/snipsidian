// @vitest-environment jsdom

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { installObsidianDomHelpers } from "../../test/dom-polyfill";
import { makeMockPlugin } from "../../test/factories/plugin";
import { FeedbackTab } from "./FeedbackTab";
import type { App } from "obsidian";
import type SnipSidianPlugin from "../../main";

/**
 * Mount tests for the About tab.
 *
 * UI redesign (2026-09): sections render via `renderSettingGroup` as
 * real `Setting` rows inside sentence-case-heading groups (Feedback /
 * Resources / More from the author) instead of the old bordered
 * `.snipsy-about-list` card, and the "About Snipsy" page heading is
 * gone (B-153 — clears the sentence-case scanner warning without
 * lowercasing the product name; the tab button already says "About").
 *
 * New for this redesign:
 *   - B-048: a "Website" row is the first Resources row, linking the
 *     live demo/docs site.
 *   - Owner ask: a "More from the author" row promotes Dashy, with a
 *     primary action into Obsidian's community plugin browser
 *     (`obsidian://show-plugin?id=dashsidian`) and a website link.
 */

beforeAll(() => {
    installObsidianDomHelpers();
});

let plugin: ReturnType<typeof makeMockPlugin>;
let app: App;
let windowOpenSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    document.body.innerHTML = "";
    plugin = makeMockPlugin();
    app = plugin.app as unknown as App;
    windowOpenSpy = vi.spyOn(window, "open").mockReturnValue(null);
});

function mount(): HTMLElement {
    const root = document.createElement("div");
    document.body.appendChild(root);
    new FeedbackTab(app, plugin as unknown as SnipSidianPlugin).render(root);
    return root;
}

function groupHeadings(root: HTMLElement): string[] {
    return Array.from(root.querySelectorAll(".setting-item-heading .setting-item-name")).map(
        (el) => el.textContent,
    );
}

function rowByTitle(root: HTMLElement, title: string): HTMLElement {
    const row = Array.from(root.querySelectorAll(".setting-item")).find(
        (el) => el.querySelector(".setting-item-name")?.textContent === title,
    );
    if (!row) throw new Error(`Row "${title}" not found`);
    return row as HTMLElement;
}

function buttonInRow(row: HTMLElement, text: string): HTMLButtonElement {
    const btn = Array.from(row.querySelectorAll("button")).find((b) => b.textContent === text);
    if (!btn) throw new Error(`Button "${text}" not found in row`);
    return btn as HTMLButtonElement;
}

describe("FeedbackTab — shape (UI redesign, B-153)", () => {
    it("does not render a redundant 'About Snipsy' page heading", () => {
        const root = mount();
        expect(root.querySelector("h3")).toBeNull();
        expect(root.textContent).not.toContain("About Snipsy");
    });

    it("renders the Feedback, Resources, and More from the author groups in order", () => {
        const root = mount();
        expect(groupHeadings(root)).toEqual(["Feedback", "Resources", "More from the author"]);
    });
});

describe("FeedbackTab — Feedback rows", () => {
    it.each([
        ["Report a bug", "File a bug report on GitHub. Includes plugin and Obsidian versions."],
        ["Suggest a feature", "Propose new functionality or improvements."],
        ["General feedback", "Share your overall experience or get in touch."],
    ])("renders '%s' with an Open issue button that opens a GitHub issue URL", (title, desc) => {
        const root = mount();
        const row = rowByTitle(root, title);
        expect(row.querySelector(".setting-item-description")?.textContent).toBe(desc);

        buttonInRow(row, "Open issue").click();

        expect(windowOpenSpy).toHaveBeenCalledTimes(1);
        const [url] = windowOpenSpy.mock.calls[0] as [string, string, string];
        expect(url).toContain("github.com");
        expect(url).toContain("issues/new");
    });
});

describe("FeedbackTab — Resources rows (B-048 Website)", () => {
    it("renders Website as the first Resources row, opening the live site", () => {
        const root = mount();
        const row = rowByTitle(root, "Website");
        expect(row.querySelector(".setting-item-description")?.textContent).toBe(
            "Live demo, screenshots and docs.",
        );

        buttonInRow(row, "Open").click();

        expect(windowOpenSpy).toHaveBeenCalledWith(
            "https://dimagious.github.io/snipsidian/",
            "_blank",
            "noopener,noreferrer",
        );
    });

    it("Website is ordered before Documentation, GitHub issues, and Obsidian community", () => {
        const root = mount();
        const titles = Array.from(
            root.querySelectorAll(".setting-item-heading .setting-item-name"),
        )
            .find((el) => el.textContent === "Resources")!
            .closest(".setting-item-heading")!
            .nextElementSibling!.querySelectorAll(".setting-item-name");
        expect(Array.from(titles).map((el) => el.textContent)).toEqual([
            "Website",
            "Documentation",
            "GitHub issues",
            "Obsidian community",
        ]);
    });

    it("renders Documentation, GitHub issues, and Obsidian community with the expected links", () => {
        const root = mount();

        buttonInRow(rowByTitle(root, "Documentation"), "Open").click();
        expect(windowOpenSpy).toHaveBeenLastCalledWith(
            "https://github.com/Dimagious/snipsidian#readme",
            "_blank",
            "noopener,noreferrer",
        );

        buttonInRow(rowByTitle(root, "GitHub issues"), "Open").click();
        expect(windowOpenSpy).toHaveBeenLastCalledWith(
            "https://github.com/Dimagious/snipsidian/issues",
            "_blank",
            "noopener,noreferrer",
        );

        buttonInRow(rowByTitle(root, "Obsidian community"), "Open").click();
        expect(windowOpenSpy).toHaveBeenLastCalledWith(
            "https://forum.obsidian.md/",
            "_blank",
            "noopener,noreferrer",
        );
    });
});

describe("FeedbackTab — More from the author (Dashy promotion)", () => {
    it("renders a Dashy row with a one-line description, not louder than the other rows", () => {
        const root = mount();
        const row = rowByTitle(root, "Dashy");
        expect(row.querySelector(".setting-item-description")?.textContent).toBe(
            "A dashboard inside a note, built from Markdown blocks. No code needed.",
        );
        // Same row shape as every other About row — no extra "banner"
        // wrapper or accent-only styling hook.
        expect(row.classList.contains("setting-item")).toBe(true);
        expect(row.className.split(" ")).not.toContain("snipsy-accent-banner");
    });

    it("'Open in Obsidian' opens the community plugin browser deep link", () => {
        const root = mount();
        buttonInRow(rowByTitle(root, "Dashy"), "Open in Obsidian").click();

        expect(windowOpenSpy).toHaveBeenCalledWith(
            "obsidian://show-plugin?id=dashsidian",
            "_blank",
            "noopener,noreferrer",
        );
    });

    it("'Website' opens the Dashy site", () => {
        const root = mount();
        buttonInRow(rowByTitle(root, "Dashy"), "Website").click();

        expect(windowOpenSpy).toHaveBeenCalledWith(
            "https://dimagious.github.io/dashsidian/",
            "_blank",
            "noopener,noreferrer",
        );
    });
});

describe("FeedbackTab — version footer", () => {
    it("renders the plugin version, Obsidian version, and platform, left-aligned (not centred)", () => {
        const root = mount();
        const footer = root.querySelector(".snipsy-about-version") as HTMLElement;
        expect(footer.textContent).toContain(`Snipsy ${plugin.manifest.version}`);
        expect(footer.textContent).toContain("Obsidian");
        expect(footer.textContent).toContain("Desktop");
    });
});

describe("FeedbackTab — link-open failure handling", () => {
    it("reports a failure via Notice instead of throwing when window.open throws", () => {
        windowOpenSpy.mockImplementation(() => {
            throw new Error("popup blocked");
        });
        const root = mount();

        expect(() => buttonInRow(rowByTitle(root, "Website"), "Open").click()).not.toThrow();
    });
});
