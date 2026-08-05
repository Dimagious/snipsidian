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

// Spy-wrap the install validator (delegates to the real one by
// default) so a single test can force a defensive-branch verdict.
const validateSpy = vi.hoisted(() => vi.fn());
vi.mock("../../../services/package-validator", async () => {
    const actual = await vi.importActual<
        typeof import("../../../services/package-validator")
    >("../../../services/package-validator");
    validateSpy.mockImplementation(actual.validatePackageForInstall);
    return { ...actual, validatePackageForInstall: validateSpy };
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

    it("[S-009] multi-violation package reports the first error plus a count", () => {
        const before = JSON.stringify(plugin.settings.snippets);
        const huge = "x".repeat(10001); // two oversized replacements → 2 errors
        const { yaml, importBtn } = mount();
        yaml.value = [
            "matches:",
            `  - trigger: ":big1"\n    replace: "${huge}"`,
            `  - trigger: ":big2"\n    replace: "${huge}"`,
        ].join("\n");
        importBtn.click();

        expect(
            noticeCalls.some(
                (msg) =>
                    msg.startsWith("Cannot import Espanso package:") &&
                    msg.endsWith("(and 1 more)"),
            ),
        ).toBe(true);
        expect(JSON.stringify(plugin.settings.snippets)).toBe(before);
    });

    it("[S-009] invalid verdict with no error detail falls back to a generic message", () => {
        // The real validator never returns isValid:false with empty errors;
        // this pins the defensive fallback text on that impossible shape.
        validateSpy.mockReturnValueOnce({ isValid: false, errors: [], warnings: [] });
        const before = JSON.stringify(plugin.settings.snippets);
        const { yaml, importBtn } = mount();
        yaml.value = SIMPLE_YAML;
        importBtn.click();

        expect(noticeCalls).toContain(
            "Cannot import Espanso package: Import failed validation",
        );
        expect(JSON.stringify(plugin.settings.snippets)).toBe(before);
    });

    it("[B-140] same-key re-import with an edited value is NOT a hard refusal, even when another group also holds the trigger — goes through the conflict preview instead", async () => {
        // Pins the exact PackageBrowser/Espanso divergence B-140 closed.
        // Pre-B-140 Espanso only skipped its collision check on an
        // IDENTICAL same-key value; a same-key value that differs (the
        // reinstall-over-an-edit case) fell through to a real
        // cross-group `hasReplacementCollision` check — and with
        // "other-group/brb" also present, THAT would have fired a hard
        // "Skipped install" refusal. Unified semantics (matching
        // PackageBrowser's pre-B-140 behavior): an existing key at the
        // same grouped path is never a cross-group collision,
        // regardless of value — this becomes a diff/preview conflict
        // instead.
        plugin.settings.snippets["espanso-import/brb"] = "USER EDIT";
        plugin.settings.snippets["other-group/brb"] = "yet another different value";

        const { groupInput, yaml, importBtn } = mount();
        groupInput.value = "Espanso import";
        yaml.value = SIMPLE_YAML;
        importBtn.click();
        await Promise.resolve();
        await Promise.resolve();

        expect(
            noticeCalls.some((msg) => msg.startsWith("Skipped install: trigger name collision")),
        ).toBe(false);

        const modalConflict = document.body.querySelector(".modal-content");
        expect(modalConflict).toBeTruthy();
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

// ---- B-139: Espanso import honesty ----

describe("EspansoSection — skip reporting (B-139)", () => {
    async function flush() {
        await Promise.resolve();
        await Promise.resolve();
    }

    it("zero-skip pack: no skip status UI, no mention of skips in the Notice", async () => {
        const { yaml, importBtn } = mount();
        yaml.value = SIMPLE_YAML;
        importBtn.click();
        await flush();

        const status = document.body.querySelector(".snipsy-espanso-skip-status") as HTMLElement;
        expect(status.style.display).toBe("none");
        expect(noticeCalls.some((m) => m.includes("skipped"))).toBe(false);
    });

    it("mixed pack: imports the good matches, reports the skipped ones with a reason", async () => {
        const mixedYaml = `
matches:
  - trigger: ":brb"
    replace: "be right back"
  - trigger: ":addr"
    form: "Address"
    form_fields:
      a: {}
`.trim();
        const { yaml, importBtn } = mount();
        yaml.value = mixedYaml;
        importBtn.click();
        await flush();

        expect(plugin.settings.snippets["espanso-import/brb"]).toBe("be right back");
        expect(plugin.settings.snippets["espanso-import/addr"]).toBeUndefined();

        const status = document.body.querySelector(".snipsy-espanso-skip-status") as HTMLElement;
        expect(status.style.display).not.toBe("none");
        expect(status.textContent).toContain("1 imported, 1 skipped");
        expect(status.textContent).toContain("addr");
        expect(status.getAttribute("aria-live")).toBe("polite");

        expect(
            noticeCalls.some((m) => m.includes("Installed 1 snippet") && m.includes("skipped")),
        ).toBe(true);
    });

    it("all-skipped pack: clear message, nothing written, saveSettings never called", async () => {
        const allSkippedYaml = `
matches:
  - trigger: ":addr"
    form: "Address"
    form_fields:
      a: {}
  - trigger: ":img"
    image_path: "./x.png"
`.trim();
        const saveSpy = vi.spyOn(plugin, "saveSettings");
        const before = JSON.stringify(plugin.settings.snippets);
        const { yaml, importBtn } = mount();
        yaml.value = allSkippedYaml;
        importBtn.click();
        await flush();

        expect(JSON.stringify(plugin.settings.snippets)).toBe(before);
        expect(saveSpy).not.toHaveBeenCalled();

        const status = document.body.querySelector(".snipsy-espanso-skip-status") as HTMLElement;
        expect(status.style.display).not.toBe("none");
        expect(status.textContent).toContain("Nothing to import");
        expect(status.textContent).toContain("2 matches use");

        expect(noticeCalls.some((m) => m.startsWith("Nothing to import"))).toBe(true);
    });

    it("skip summary caps the listed trigger names at 3, with an ellipsis for the rest", async () => {
        const manySkipsYaml = `
matches:
  - trigger: ":a"
    image_path: "./a.png"
  - trigger: ":b"
    image_path: "./b.png"
  - trigger: ":c"
    image_path: "./c.png"
  - trigger: ":d"
    image_path: "./d.png"
`.trim();
        const { yaml, importBtn } = mount();
        yaml.value = manySkipsYaml;
        importBtn.click();
        await flush();

        const status = document.body.querySelector(".snipsy-espanso-skip-status") as HTMLElement;
        expect(status.textContent).toContain("a, b, c, …");
        expect(status.textContent).not.toContain(": d");
    });

    it("the confirm-modal path (a real conflict) also shows the skip summary inside the modal", async () => {
        // Pre-seed a conflicting value so the diff has a real conflict
        // and the PackagePreviewModal path is exercised.
        plugin.settings.snippets["espanso-import/brb"] = "an existing different value";

        const mixedYaml = `
matches:
  - trigger: ":brb"
    replace: "be right back"
  - trigger: ":addr"
    form: "Address"
    form_fields:
      a: {}
`.trim();
        const { groupInput, yaml, importBtn } = mount();
        // Force the same group slug as the pre-seeded conflict above —
        // otherwise the auto-incrementing default ("Espanso import 2",
        // since "espanso-import" is now taken) would land in a
        // different group and never collide.
        groupInput.value = "Espanso import";
        yaml.value = mixedYaml;
        importBtn.click();
        await flush();

        // The conflict modal is open — its contentEl should carry a
        // skip-status block too (not just the section's own).
        const modalSkip = document.body.querySelector(
            ".modal-content .snipsy-espanso-skip-status",
        );
        expect(modalSkip).toBeTruthy();
        expect(modalSkip?.textContent).toContain("skipped");
        expect(modalSkip?.textContent).toContain("addr");
    });
});

// ---- Fold-in (ux#7, B-140): honest install counts ----
describe("EspansoSection — reported install count reflects actual changes, not pack size", () => {
    function modalApplyButton(): HTMLButtonElement {
        const btn = Array.from(
            document.body.querySelectorAll(".modal-button-container button"),
        ).find((b) => b.textContent === "Apply") as HTMLButtonElement | undefined;
        if (!btn) throw new Error("Modal Apply button not found");
        return btn;
    }

    it("'keep current' on every conflict reports 'No changes', not the full pack size", async () => {
        // Both triggers already exist at the SAME group with different
        // values — re-importing is a pure conflict, no additions.
        plugin.settings.snippets["espanso-import/brb"] = "USER EDIT 1";
        plugin.settings.snippets["espanso-import/omw"] = "USER EDIT 2";

        const { groupInput, yaml, importBtn } = mount();
        groupInput.value = "Espanso import";
        yaml.value = SIMPLE_YAML;
        importBtn.click();
        await Promise.resolve();
        await Promise.resolve();

        // Default per-row choice is "keep current" — Apply with no
        // per-row changes.
        modalApplyButton().click();
        await Promise.resolve();
        await Promise.resolve();

        expect(plugin.settings.snippets["espanso-import/brb"]).toBe("USER EDIT 1");
        expect(
            noticeCalls.some((m) => m.startsWith('No changes — "Espanso import"')),
        ).toBe(true);
        expect(noticeCalls.some((m) => m.startsWith("Installed"))).toBe(false);
    });

    it("a mixed conflict (one new, one kept) reports only the new one, not the pack size", async () => {
        // "brb" is a user-edited conflict; "omw" doesn't exist yet.
        plugin.settings.snippets["espanso-import/brb"] = "USER EDIT";

        const { groupInput, yaml, importBtn } = mount();
        groupInput.value = "Espanso import";
        yaml.value = SIMPLE_YAML;
        importBtn.click();
        await Promise.resolve();
        await Promise.resolve();

        modalApplyButton().click();
        await Promise.resolve();
        await Promise.resolve();

        expect(plugin.settings.snippets["espanso-import/brb"]).toBe("USER EDIT");
        expect(plugin.settings.snippets["espanso-import/omw"]).toBe("on my way");
        expect(noticeCalls).toContain('Installed 1 snippet into "Espanso import"');
    });
});
