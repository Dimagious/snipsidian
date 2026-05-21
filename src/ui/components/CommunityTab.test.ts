// @vitest-environment jsdom

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { installObsidianDomHelpers } from "../../test/dom-polyfill";
import { makeMockPlugin } from "../../test/factories/plugin";
import { CommunityTab } from "./CommunityTab";
import type { App } from "obsidian";
import type SnipSidianPlugin from "../../../main";

/**
 * Smoke tests for `CommunityTab` — the wrapper that mounts the
 * three community sub-sections (PackageBrowser, PackageSubmission,
 * Espanso import). The sub-sections themselves are excluded from
 * the coverage gate (see vitest.config.ts B-114 comment) — they
 * need their own focused PRs. Here we just pin:
 *
 *   - the wrapper instantiates without throwing
 *   - `render()` empties the root and adds the wrapper class
 *   - each sub-section's `render()` is invoked exactly once
 *
 * Async-safe: PackageBrowser.render() does an async load; we mock
 * it to resolve synchronously to keep the test deterministic.
 */

// Mock the three sub-sections so this test stays focused on the
// wrapper's wiring (not on what the sub-sections render).
vi.mock("./community/PackageBrowser", () => ({
    PackageBrowser: vi.fn().mockImplementation(() => ({
        render: vi.fn().mockResolvedValue(undefined),
    })),
}));
vi.mock("./community/PackageSubmissionSection", () => ({
    PackageSubmissionSection: vi.fn().mockImplementation(() => ({
        render: vi.fn(),
    })),
}));
vi.mock("./community/EspansoSection", () => ({
    EspansoSection: vi.fn().mockImplementation(() => ({
        render: vi.fn(),
    })),
}));

import { PackageBrowser } from "./community/PackageBrowser";
import { PackageSubmissionSection } from "./community/PackageSubmissionSection";
import { EspansoSection } from "./community/EspansoSection";

beforeAll(() => {
    installObsidianDomHelpers();
});

let plugin: ReturnType<typeof makeMockPlugin>;
let app: App;
beforeEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
    plugin = makeMockPlugin();
    app = plugin.app as unknown as App;
});

describe("CommunityTab smoke", () => {
    it("instantiates and constructs all three sub-sections with (app, plugin)", () => {
        new CommunityTab(app, plugin as unknown as SnipSidianPlugin);
        expect(PackageBrowser).toHaveBeenCalledWith(app, plugin);
        expect(PackageSubmissionSection).toHaveBeenCalledWith(app, plugin);
        expect(EspansoSection).toHaveBeenCalledWith(app, plugin);
    });

    it("render() empties root, applies snipsy-compact, and invokes all three sub-renders", async () => {
        const tab = new CommunityTab(app, plugin as unknown as SnipSidianPlugin);

        const root = document.createElement("div");
        // Pre-seed children so we can verify empty() ran.
        root.appendChild(document.createElement("span"));
        root.appendChild(document.createElement("span"));
        document.body.appendChild(root);

        await tab.render(root);

        expect(root.classList.contains("snipsy-compact")).toBe(true);
        // The mocks' render fns should each have been called once.
        const browserInstance = vi.mocked(PackageBrowser).mock.results[0]?.value;
        const submissionInstance = vi.mocked(PackageSubmissionSection).mock.results[0]?.value;
        const espansoInstance = vi.mocked(EspansoSection).mock.results[0]?.value;
        expect(browserInstance?.render).toHaveBeenCalledTimes(1);
        expect(submissionInstance?.render).toHaveBeenCalledTimes(1);
        expect(espansoInstance?.render).toHaveBeenCalledTimes(1);
        // Each sub-render gets the (now-emptied) root.
        expect(browserInstance?.render).toHaveBeenCalledWith(root);
        expect(submissionInstance?.render).toHaveBeenCalledWith(root);
        expect(espansoInstance?.render).toHaveBeenCalledWith(root);
    });
});
