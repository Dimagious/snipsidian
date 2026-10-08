import { App, Notice, Platform } from "obsidian";
import type SnipSidianPlugin from "../../../main";
import { validatePackage, type ValidationResult } from "../../../services/package-validator";
import { buildPackageSubmissionUrl } from "../../../services/github-issue-url";
import type { PackageData } from "../../../services/package-types";
import * as YAML from "yaml";
import { renderSettingGroup } from "../../utils/setting-group";
import { SETTING_TEXTAREA_CLASS } from "../../utils/style-hooks";

/**
 * Submit a community package. The legacy Google Form path is gone
 * (B-008); submission now opens a prefilled GitHub issue with the
 * YAML embedded in a fenced code block, so reviewers can copy it
 * straight into the community catalog repo.
 *
 * In-app validation stays — it catches bad YAML/missing fields
 * before the user files an issue.
 */
export class PackageSubmissionSection {
    private validationResult: ValidationResult | null = null;
    private parsedPackage: PackageData | null = null;

    constructor(
        private app: App,
        private plugin: SnipSidianPlugin,
    ) {}

    render(root: HTMLElement): void {
        const group = renderSettingGroup(root, "Share a package");

        group.addSetting((s) => {
            // Built directly into `descEl` (`appendText` + `createEl`)
            // rather than a detached `DocumentFragment` passed to
            // `setDesc` — both render identically in real Obsidian
            // (`Element.prototype.setText` appends a Node value as-is,
            // it doesn't stringify it), but this avoids relying on that
            // less-obvious special case.
            s.descEl.appendText(
                "Paste your package YAML to validate it, then open a GitHub issue to submit it for review. ",
            );
            // B-058: the wiki page doesn't exist (GitHub wikis are off
            // by default for new repos — the wiki URL redirects to the
            // repo home). Point at the live catalog directory instead —
            // submitters can browse real, accepted packs as templates.
            s.descEl.createEl("a", {
                text: "See existing packs as examples",
                href: "https://github.com/Dimagious/snipsidian-community/tree/main/community-packages/approved",
                attr: { target: "_blank", rel: "noopener noreferrer" },
            });
        });

        let yamlTextarea!: HTMLTextAreaElement;
        group.addSetting((s) => {
            s.settingEl.addClass(SETTING_TEXTAREA_CLASS);
            s.addTextArea((t) => {
                yamlTextarea = t.inputEl;
                t.inputEl.addClass("snipsy-submit-textarea");
                t.setPlaceholder("Paste your community package YAML here…");
                t.inputEl.setAttr("aria-label", "Community package YAML");
            });
        });

        // Validation result sits on the same row as the buttons it
        // unlocks, instead of a separate block above them.
        let validationContainer!: HTMLDivElement;
        let submitBtn!: HTMLButtonElement;
        group.addSetting((s) => {
            validationContainer = s.infoEl.createDiv({ cls: "snipsy-submit-validation" });
            s.addButton((b) =>
                b.setButtonText("Validate").onClick(() => {
                    this.validate(yamlTextarea, validationContainer, submitBtn);
                }),
            );
            s.addButton((b) => {
                submitBtn = b.buttonEl;
                b.setButtonText("Open submission issue")
                    .setCta()
                    .setDisabled(true)
                    .onClick(() => {
                        void this.openSubmissionIssue(yamlTextarea, validationContainer, submitBtn);
                    });
            });
        });
    }

    private validate(
        textarea: HTMLTextAreaElement,
        container: HTMLElement,
        submitBtn: HTMLButtonElement,
    ) {
        const yamlContent = textarea.value.trim();
        if (!yamlContent) {
            this.showValidationResult(
                container,
                { isValid: false, errors: ["Paste package YAML first."], warnings: [] },
                submitBtn,
            );
            return;
        }
        try {
            const packageData = YAML.parse(yamlContent) as PackageData;
            if (!packageData || typeof packageData !== "object") {
                this.showValidationResult(
                    container,
                    { isValid: false, errors: ["Invalid YAML."], warnings: [] },
                    submitBtn,
                );
                return;
            }
            if (
                !packageData.name ||
                !packageData.author ||
                !packageData.version ||
                !packageData.snippets
            ) {
                this.showValidationResult(
                    container,
                    {
                        isValid: false,
                        errors: [
                            "Missing required fields. Packages need name, author, version, and snippets.",
                        ],
                        warnings: [],
                    },
                    submitBtn,
                );
                return;
            }
            const validation = validatePackage(packageData, { strictMode: false });
            this.validationResult = validation;
            this.parsedPackage = validation.isValid ? packageData : null;
            this.showValidationResult(container, validation, submitBtn);
        } catch (err) {
            this.showValidationResult(
                container,
                {
                    isValid: false,
                    errors: [
                        `Failed to parse YAML: ${err instanceof Error ? err.message : String(err)}`,
                    ],
                    warnings: [],
                },
                submitBtn,
            );
        }
    }

    private showValidationResult(
        container: HTMLElement,
        validation: ValidationResult,
        submitBtn: HTMLButtonElement,
    ) {
        container.empty();
        submitBtn.disabled = !validation.isValid;

        // B-084: textual marker on the title alongside the colour
        // tint. Title text alone already carries state ("Package is
        // valid" vs "Validation failed"), but for users on monochrome
        // schemes or with strong colour blindness, the ✓ / ✗ prefix
        // makes the success/failure read at a glance independent of
        // hue. The `role="status"` (success) / `role="alert"`
        // (failure) attributes wire the result into AT announcements.
        if (validation.isValid) {
            const ok = container.createDiv({ cls: "snipsy-submit-valid" });
            ok.setAttr("role", "status");
            ok.createDiv({ text: "✓ Package is valid", cls: "snipsy-submit-title" });
            if (validation.warnings.length > 0) {
                const warnings = ok.createDiv({ cls: "snipsy-submit-warnings" });
                warnings.createDiv({ text: "Warnings:", cls: "snipsy-submit-subtitle" });
                validation.warnings.forEach((w) =>
                    warnings.createDiv({ text: w, cls: "snipsy-submit-item" }),
                );
            }
        } else {
            const err = container.createDiv({ cls: "snipsy-submit-invalid" });
            err.setAttr("role", "alert");
            err.createDiv({ text: "✗ Validation failed", cls: "snipsy-submit-title" });
            validation.errors.forEach((e) =>
                err.createDiv({ text: `• ${e}`, cls: "snipsy-submit-item" }),
            );
        }
    }

    private async openSubmissionIssue(
        textarea: HTMLTextAreaElement,
        validationContainer: HTMLElement,
        submitBtn: HTMLButtonElement,
    ) {
        if (!this.validationResult?.isValid || !this.parsedPackage) {
            new Notice("Validate the package first.");
            return;
        }

        const url = buildPackageSubmissionUrl({
            packageName: this.parsedPackage.name ?? "Untitled package",
            yaml: textarea.value,
            meta: {
                pluginVersion: this.plugin.manifest.version,
                obsidianVersion: this.app.version,
                platform: Platform.isDesktop ? "Desktop" : Platform.isMobile ? "Mobile" : undefined,
            },
        });

        // B-044: `window.open` does NOT throw on popup-blocked — it
        // returns null. Pre-1.1.7 we fired a success Notice
        // regardless, and the user would see "opened in browser"
        // with no actual tab opening. Detect the null return,
        // copy the URL to the clipboard (best effort), and surface
        // a Notice the user can act on.
        try {
            const popup = window.open(url, "_blank", "noopener,noreferrer");
            if (popup === null) {
                let copied = false;
                try {
                    await navigator.clipboard?.writeText(url);
                    copied = true;
                } catch {
                    // best-effort — surfaced in the Notice copy below
                }
                new Notice(
                    copied
                        ? "Popup blocked — link copied to clipboard, paste it in your browser."
                        : "Popup blocked — open the submission link from the Snipsy GitHub repo manually.",
                    8_000,
                );
                return;
            }
            new Notice("Submission issue opened in your browser.");
        } catch (err) {
            new Notice(
                `Failed to open submission link: ${err instanceof Error ? err.message : String(err)}`,
            );
            return;
        }

        textarea.value = "";
        validationContainer.empty();
        submitBtn.disabled = true;
        this.validationResult = null;
        this.parsedPackage = null;
    }
}
