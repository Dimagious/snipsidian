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

async function settle(): Promise<void> {
    for (let i = 0; i < 6; i++) await Promise.resolve();
}

const SIMPLE_YAML = `
matches:
  - trigger: ":brb"
    replace: "be right back"
  - trigger: ":omw"
    replace: "on my way"
`.trim();

describe("EspansoSection — render", () => {
    // B-189: replaces the scorecard-flagged `.setting-item:has(textarea)`.
    it("[B-189] tags the YAML row with snipsy-setting-textarea", () => {
        const { yaml } = mount();
        expect(yaml.closest(".setting-item")?.classList.contains("snipsy-setting-textarea")).toBe(true);
    });

    // B-153/wording: "Import from Espanso YAML" becomes "Espanso
    // import" — rendered as the group's sentence-case heading
    // (renderSettingGroup), not a `.section-title` div.
    it("mounts the 'Espanso import' heading + group-input + textarea + import button", () => {
        const { root } = mount();
        const heading = Array.from(
            root.querySelectorAll(".setting-item-heading .setting-item-name"),
        ).find((el) => el.textContent === "Espanso import");
        expect(heading).toBeTruthy();
        expect(root.querySelector(".snipsy-espanso-group-input")).toBeTruthy();
        expect(root.querySelector(".yaml-textarea")).toBeTruthy();
        expect(
            Array.from(root.querySelectorAll("button")).map((b) => b.textContent),
        ).toContain("Import snippets");
    });

    // B-153/wording + AUDIT X8 (em dashes in UI copy).
    // V2 fix (2026-09 UI-redesign follow-up): the intro is now a real
    // (nameless) row's `descEl` — same pattern as
    // `PackageSubmissionSection`'s "Share a package" intro — instead
    // of a bare `createDiv`, so it picks up correct row padding on
    // every Obsidian version. It's the first Setting this section
    // mounts, so its `descEl` is the first `.setting-item-description`
    // in document order (the "Group name" row's own desc comes after).
    it("intro copy reads the new sentence, linking 'Espanso hub', with no em dash", () => {
        const { root } = mount();
        const intro = root.querySelector(".setting-item-description") as HTMLElement;
        expect(intro.textContent).toBe(
            "Paste package YAML. Plain text triggers become snippets; forms and scripts are skipped. Find packages on the Espanso hub.",
        );
        expect(intro.textContent).not.toContain("—");
        const link = intro.querySelector("a");
        expect(link?.textContent).toBe("Espanso hub");
        expect(link?.getAttribute("href")).toBe("https://hub.espanso.org/search");
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

    it("[B-184] a cross-group collision no longer aborts: the rest imports, the colliding trigger is listed with its group", async () => {
        plugin.settings.snippets["other-group/brb"] = "totally different value";

        const { yaml, importBtn } = mount();
        yaml.value = SIMPLE_YAML;
        importBtn.click();
        await settle();

        // No refusal Notice, nothing written yet (omw has no conflict ->
        // direct install path writes immediately).
        expect(noticeCalls.some((m) => m.includes("trigger name collision"))).toBe(false);
        expect(plugin.settings.snippets["espanso-import/omw"]).toBe("on my way");
        expect(
            Object.prototype.hasOwnProperty.call(plugin.settings.snippets, "espanso-import/brb"),
        ).toBe(false);
        expect(plugin.settings.snippets["other-group/brb"]).toBe("totally different value");
        const msg = noticeCalls.find((m) => m.startsWith("Installed 1 snippet"));
        expect(msg).toContain('brb (already used in group "other-group")');
    });

    it("[B-184] when EVERY trigger collides: says nothing to import and writes nothing", async () => {
        plugin.settings.snippets["g1/brb"] = "x";
        plugin.settings.snippets["g2/omw"] = "y";
        const before = JSON.stringify(plugin.settings.snippets);

        const { yaml, importBtn } = mount();
        yaml.value = SIMPLE_YAML;
        importBtn.click();
        await settle();

        const msg = noticeCalls.find((m) => m.startsWith("Nothing to import"));
        expect(msg).toContain('brb (already used in group "g1")');
        expect(msg).toContain('omw (already used in group "g2")');
        expect(JSON.stringify(plugin.settings.snippets)).toBe(before);
        expect(plugin._saveCalls.length).toBe(0);
        expect(document.body.querySelector(".modal-content")).toBeNull();
    });

    it("[B-184] when every trigger collides AND some matches were unsupported: explains both halves", async () => {
        plugin.settings.snippets["g1/brb"] = "x";
        const { yaml, importBtn } = mount();
        yaml.value = `
matches:
  - trigger: ":brb"
    replace: "be right back"
  - trigger: ":form"
    form: "[[a]]"
`.trim();
        importBtn.click();
        await settle();

        const msg = noticeCalls.find((m) => m.startsWith("Nothing to import"));
        expect(msg).toContain('brb (already used in group "g1")');
        expect(msg).toContain("1 skipped as unsupported");
        expect(msg).toContain("form");
    });

    it("[B-184] collision + same-group conflict: preview still opens for the conflict and lists the left-out trigger; Cancel writes nothing", async () => {
        plugin.settings.snippets["other-group/brb"] = "different";
        plugin.settings.snippets["espanso-import/omw"] = "USER EDIT";
        const before = JSON.stringify(plugin.settings.snippets);

        const { groupInput, yaml, importBtn } = mount();
        groupInput.value = "Espanso import";
        yaml.value = SIMPLE_YAML;
        importBtn.click();
        await settle();

        const info = document.body.querySelector(".modal-content .snipsy-espanso-skip-status");
        expect(info?.textContent).toContain('brb (already used in group "other-group")');
        const cancel = Array.from(document.body.querySelectorAll(".modal-button-container button"))
            .find((b) => b.textContent === "Cancel") as HTMLButtonElement;
        cancel.click();
        await settle();
        expect(JSON.stringify(plugin.settings.snippets)).toBe(before);
        expect(plugin._saveCalls.length).toBe(0);
    });

    it("[B-184] ungrouped owner is described without a group name", async () => {
        plugin.settings.snippets["brb"] = "plain";
        const { yaml, importBtn } = mount();
        yaml.value = SIMPLE_YAML;
        importBtn.click();
        await settle();
        const msg = noticeCalls.find((m) => m.startsWith("Installed 1 snippet"));
        expect(msg).toContain("brb (already used by an ungrouped snippet)");
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
        // B-153/wording + AUDIT X8: no em dash; a plain sentence instead.
        expect(status.textContent).not.toContain("—");
        expect(status.textContent).toBe(
            "1 imported, 1 skipped: addr. Forms and scripts are not supported.",
        );

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

describe("EspansoSection: failed save rolls back (B-181)", () => {
    it("direct-install path restores the previous snippets when saveSettings rejects", async () => {
        const previous = plugin.settings.snippets;
        plugin.saveSettings = vi.fn().mockRejectedValue(new Error("disk full"));
        const { yaml, importBtn } = mount();
        yaml.value = SIMPLE_YAML;
        importBtn.click();
        await settle();

        expect(noticeCalls.some((m) => m.startsWith("Failed to install from YAML"))).toBe(true);
        expect(plugin.settings.snippets).toBe(previous);
        expect(plugin.settings.snippets).toEqual({});
    });

    it("conflict-preview path restores the previous snippets when saveSettings rejects", async () => {
        plugin.settings.snippets["espanso-import/brb"] = "USER EDIT";
        const previous = plugin.settings.snippets;
        plugin.saveSettings = vi.fn().mockRejectedValue(new Error("disk full"));
        const { groupInput, yaml, importBtn } = mount();
        groupInput.value = "Espanso import";
        yaml.value = SIMPLE_YAML;
        importBtn.click();
        await settle();

        const apply = Array.from(document.body.querySelectorAll(".modal-button-container button"))
            .find((b) => b.textContent === "Apply") as HTMLButtonElement;
        apply.click();
        await settle();

        expect(plugin.settings.snippets).toBe(previous);
        expect(plugin.settings.snippets).toEqual({ "espanso-import/brb": "USER EDIT" });
        expect(plugin.settings.snippets["espanso-import/omw"]).toBeUndefined();
        expect(noticeCalls).toContain("Failed to install from YAML: disk full");
    });
});
