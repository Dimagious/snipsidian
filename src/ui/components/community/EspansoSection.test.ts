// @vitest-environment jsdom

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

// Stub `new Notice(msg)` so tests can assert on toast copy. The
// default obsidian stub silently swallows the message.
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
import { EspansoSection } from "./EspansoSection";
import type { App } from "obsidian";
import type SnipSidianPlugin from "../../../../main";

/**
 * Mount tests for the Espanso-import section — focused on the
 * B-045 group-name flow that just landed (1.1.7 PR #47):
 *
 *   1. Section renders all three rows (heading + help, group-input,
 *      yaml textarea, import button).
 *   2. Default group name is "Espanso import" on first mount.
 *   3. Default group name auto-increments to "Espanso import 2"
 *      when "espanso-import" slug already exists in settings.
 *   4. Clicking Import with an empty group input falls back to the
 *      default group label, and the resulting settings keys are
 *      prefixed `<slug>/<trigger>` (not bare).
 *   5. Empty YAML → Notice "Please paste YAML content first" + no
 *      mutation.
 *   6. Custom group label → keys land under the slugified version.
 *   7. Cross-group trigger collision (same name in another group,
 *      different replacement) → Notice "Skipped install".
 */

beforeAll(() => {
    installObsidianDomHelpers();
});

let plugin: ReturnType<typeof makeMockPlugin>;
let app: App;
beforeEach(() => {
    document.body.innerHTML = "";
    noticeCalls.length = 0;
    plugin = makeMockPlugin();
    app = plugin.app as unknown as App;
});

function mount(): { root: HTMLElement; groupInput: HTMLInputElement; yaml: HTMLTextAreaElement; importBtn: HTMLButtonElement } {
    const root = document.createElement("div");
    document.body.appendChild(root);
    new EspansoSection(app, plugin as unknown as SnipSidianPlugin).render(root);
    const groupInput = root.querySelector(".snipsy-espanso-group-input") as HTMLInputElement;
    const yaml = root.querySelector(".yaml-textarea") as HTMLTextAreaElement;
    const importBtn = Array.from(root.querySelectorAll("button"))
        .find((b) => b.textContent === "Import snippets") as HTMLButtonElement;
    if (!groupInput || !yaml || !importBtn) {
        throw new Error("EspansoSection did not render expected elements");
    }
    return { root, groupInput, yaml, importBtn };
}

const SIMPLE_YAML = `
matches:
  - trigger: ":brb"
    replace: "be right back"
  - trigger: ":omw"
    replace: "on my way"
`.trim();

describe("EspansoSection — render", () => {
    it("mounts the heading + group-input + textarea + import button", () => {
        const { root } = mount();
        expect(root.querySelector(".section-title")?.textContent).toBe(
            "Import from Espanso YAML",
        );
        expect(root.querySelector(".snipsy-espanso-group-input")).toBeTruthy();
        expect(root.querySelector(".yaml-textarea")).toBeTruthy();
        expect(
            Array.from(root.querySelectorAll("button")).map((b) => b.textContent),
        ).toContain("Import snippets");
    });
});

describe("EspansoSection — default group name (B-045)", () => {
    it("defaults to 'Espanso import' on a fresh vault", () => {
        const { groupInput } = mount();
        expect(groupInput.value).toBe("Espanso import");
    });

    it("auto-increments to 'Espanso import 2' if 'espanso-import' slug is taken", () => {
        plugin.settings.snippets["espanso-import/existing"] = "from earlier";
        const { groupInput } = mount();
        expect(groupInput.value).toBe("Espanso import 2");
    });

    it("walks 2 → 3 → 4 etc. when multiple defaults already taken", () => {
        plugin.settings.snippets["espanso-import/a"] = "1";
        plugin.settings.snippets["espanso-import-2/b"] = "2";
        plugin.settings.snippets["espanso-import-3/c"] = "3";
        const { groupInput } = mount();
        expect(groupInput.value).toBe("Espanso import 4");
    });
});

describe("EspansoSection — import flow (B-045)", () => {
    it("writes keys under the default group when input is empty", async () => {
        const { groupInput, yaml, importBtn } = mount();
        groupInput.value = ""; // empty → falls back to default
        yaml.value = SIMPLE_YAML;
        importBtn.click();
        await Promise.resolve();
        await Promise.resolve();

        expect(plugin.settings.snippets["espanso-import/brb"]).toBe("be right back");
        expect(plugin.settings.snippets["espanso-import/omw"]).toBe("on my way");
        // Bare triggers must NOT be written.
        expect(plugin.settings.snippets["brb"]).toBeUndefined();
        expect(plugin.settings.snippets["omw"]).toBeUndefined();
    });

    it("writes keys under the slugified custom group label", async () => {
        const { groupInput, yaml, importBtn } = mount();
        groupInput.value = "My Hub Pack 2024!";
        yaml.value = SIMPLE_YAML;
        importBtn.click();
        await Promise.resolve();
        await Promise.resolve();

        // slugifyGroup("My Hub Pack 2024!") → "my-hub-pack-2024"
        expect(plugin.settings.snippets["my-hub-pack-2024/brb"]).toBe("be right back");
        expect(plugin.settings.snippets["my-hub-pack-2024/omw"]).toBe("on my way");
    });

    it("calls saveSettings() once on successful import", async () => {
        const saveSpy = vi.spyOn(plugin, "saveSettings");
        const { yaml, importBtn } = mount();
        yaml.value = SIMPLE_YAML;
        importBtn.click();
        await Promise.resolve();
        await Promise.resolve();
        expect(saveSpy).toHaveBeenCalledTimes(1);
    });

    it("rejects empty YAML with a Notice and no mutation", () => {
        const before = JSON.stringify(plugin.settings.snippets);
        const { yaml, importBtn } = mount();
        yaml.value = "";
        importBtn.click();

        expect(noticeCalls).toContain("Please paste YAML content first");
        expect(JSON.stringify(plugin.settings.snippets)).toBe(before);
    });

    it("rejects group labels that slugify to empty with a Notice", () => {
        const before = JSON.stringify(plugin.settings.snippets);
        const { groupInput, yaml, importBtn } = mount();
        groupInput.value = "!!! ???"; // all punctuation → slugifies to ""
        yaml.value = SIMPLE_YAML;
        importBtn.click();

        expect(noticeCalls).toContain(
            "Group name must contain at least one letter or number",
        );
        expect(JSON.stringify(plugin.settings.snippets)).toBe(before);
    });

    it("rejects when a trigger collides in another group with different value", () => {
        // Pre-seed a cross-group collision.
        plugin.settings.snippets["other-group/brb"] = "totally different value";

        const before = JSON.stringify(plugin.settings.snippets);
        const { yaml, importBtn } = mount();
        yaml.value = SIMPLE_YAML;
        importBtn.click();

        expect(
            noticeCalls.some((msg) =>
                msg.startsWith("Skipped install: trigger name collision"),
            ),
        ).toBe(true);
        // No mutation past the seed.
        expect(JSON.stringify(plugin.settings.snippets)).toBe(before);
    });

    // S-009: Espanso YAML is pasted from an untrusted source and used to
    // skip every install-time limit (count, replacement length, trigger
    // shape) that the community-pack path enforces. The import must now be
    // gated by `validatePackageForInstall` before any write.
    it("[S-009] rejects an oversized replacement with a Notice and no mutation", () => {
        const before = JSON.stringify(plugin.settings.snippets);
        const huge = "x".repeat(10001); // > INSTALL_MAX_REPLACEMENT_LEN (10000)
        const { yaml, importBtn } = mount();
        yaml.value = `matches:\n  - trigger: ":big"\n    replace: "${huge}"`;
        importBtn.click();

        expect(
            noticeCalls.some((msg) => msg.startsWith("Cannot import Espanso package:")),
        ).toBe(true);
        expect(JSON.stringify(plugin.settings.snippets)).toBe(before);
    });

    it("[S-009] rejects a package exceeding the snippet-count cap", () => {
        const before = JSON.stringify(plugin.settings.snippets);
        // 501 matches > INSTALL_MAX_SNIPPETS (500)
        const lines = Array.from({ length: 501 }, (_, i) => `  - trigger: ":t${i}"\n    replace: "v${i}"`);
        const { yaml, importBtn } = mount();
        yaml.value = `matches:\n${lines.join("\n")}`;
        importBtn.click();

        expect(
            noticeCalls.some((msg) => msg.startsWith("Cannot import Espanso package:")),
        ).toBe(true);
        expect(JSON.stringify(plugin.settings.snippets)).toBe(before);
    });

    it("allows re-import: same-value trigger in same group is a no-op, not a collision", async () => {
        // Pre-seed the exact same keys at the same values.
        plugin.settings.snippets["espanso-import/brb"] = "be right back";
        plugin.settings.snippets["espanso-import/omw"] = "on my way";
        const saveSpy = vi.spyOn(plugin, "saveSettings");

        const { groupInput, yaml, importBtn } = mount();
        // Default would auto-bump to "Espanso import 2"; force same
        // group name so we exercise the re-import path.
        groupInput.value = "Espanso import";
        yaml.value = SIMPLE_YAML;
        importBtn.click();
        await Promise.resolve();
        await Promise.resolve();

        // No collision Notice — the same key + value is silent.
        expect(
            noticeCalls.find((msg) => msg.includes("trigger name collision")),
        ).toBeUndefined();
        // Re-import still calls saveSettings (the loop just overwrites
        // with the same value).
        expect(saveSpy).toHaveBeenCalled();
    });
});
