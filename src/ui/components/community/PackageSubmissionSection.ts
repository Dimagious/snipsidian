import { App, Notice, Platform } from "obsidian";
import type SnipSidianPlugin from "../../../main";
import { validatePackage, type ValidationResult } from "../../../services/package-validator";
import { buildPackageSubmissionUrl } from "../../../services/github-issue-url";
import type { PackageData } from "../../../services/package-types";
import * as YAML from "yaml";

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
        root.createEl("h3", { text: "Share a package", cls: "snipsy-tab-heading" });
        const intro = root.createDiv({ cls: "snipsy-hint" });
        intro.createSpan({
            text: "Paste your package YAML to validate it, then open a GitHub issue to submit it for review. ",
        });
        const help = intro.createEl("a", {
            text: "Package format docs",
            href: "https://github.com/Dimagious/snipsidian/wiki/Package-Creation",
        });
        help.setAttr("target", "_blank");
        help.setAttr("rel", "noopener noreferrer");

        const yamlContainer = root.createDiv({ cls: "snipsy-submit-yaml" });
        const yamlTextarea: HTMLTextAreaElement = yamlContainer.createEl("textarea", {
            placeholder: "Paste your community package YAML here…",
            cls: "snipsy-submit-textarea",
            attr: { "aria-label": "Community package YAML" },
        });

        const validationContainer = root.createDiv({ cls: "snipsy-submit-validation" });

        const buttonRow = root.createDiv({ cls: "snipsy-submit-actions" });
        const validateBtn = buttonRow.createEl("button", {
            text: "Validate",
            cls: "snippet-action",
            attr: { type: "button" },
        });
        const submitBtn: HTMLButtonElement = buttonRow.createEl("button", {
            text: "Open submission issue",
            cls: "snippet-action mod-cta",
            attr: { type: "button" },
        });
        submitBtn.disabled = true;

        validateBtn.addEventListener("click", () => {
            this.validate(yamlTextarea, validationContainer, submitBtn);
        });
        submitBtn.addEventListener("click", () => {
            this.openSubmissionIssue(yamlTextarea, validationContainer, submitBtn);
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

    private openSubmissionIssue(
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

        try {
            window.open(url, "_blank", "noopener,noreferrer");
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
