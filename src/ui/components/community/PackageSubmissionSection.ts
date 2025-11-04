import { App, Notice } from "obsidian";
import type SnipSidianPlugin from "../../../main";
import { validatePackage, type ValidationResult } from "../../../services/package-validator";
import { createPackageIssue } from "../../../services/community-packages";
import { buildGoogleFormUrl, collectSystemMeta } from "../../../services/feedback-form";
import type { PackageData } from "../../../services/package-types";
import * as yaml from "js-yaml";

export class PackageSubmissionSection {
  private validationResult: ValidationResult | null = null;

  constructor(
    private app: App,
    private plugin: SnipSidianPlugin
  ) {}

  render(root: HTMLElement): void {
    const submitSection = root.createDiv({ cls: "snipsy-section snipsy-community-submit-section" });
    submitSection.createEl("h3", { text: "Submit new package", cls: "section-title" });

    const helpText = submitSection.createDiv({ cls: "help-text" });
    helpText.createEl("p", {
      text: "Have an idea or good collection? Share it with the community!",
    });
    const helpLink = helpText.createEl("a", {
      text: "Learn how to create packages",
      href: "https://github.com/Dimagious/snipsidian/wiki/Package-Creation",
      cls: "help-link",
    });
    helpLink.setAttribute("target", "_blank");
    helpLink.setAttribute("rel", "noopener noreferrer");

    const yamlRow = submitSection.createDiv({ cls: "yaml-input-row" });
    yamlRow.createEl("p", {
      text: "Paste your package YAML below. Make sure it follows the community package format with name, author, version, and snippets.",
      cls: "yaml-instruction",
    });
    const yamlContainer = yamlRow.createDiv({ cls: "yaml-container" });
    const yamlTextarea = yamlContainer.createEl("textarea", {
      placeholder: "Paste your community package YAML here…",
      cls: "yaml-textarea",
    }) as HTMLTextAreaElement;

    const validationContainer = submitSection.createDiv({ cls: "validation-container" });

    const buttonRow = submitSection.createDiv({ cls: "button-row" });
    const validateBtn = buttonRow.createEl("button", { text: "Validate package", cls: "validate-btn" });
    validateBtn.onclick = () => this.validatePackage(yamlTextarea, validationContainer);

    const submitBtn = buttonRow.createEl("button", { text: "Submit package", cls: "submit-btn" }) as HTMLButtonElement;
    submitBtn.disabled = true;
    submitBtn.onclick = () => this.submitPackage(yamlTextarea, submitBtn);
  }

  private validatePackage(textarea: HTMLTextAreaElement, container: HTMLElement) {
    const yamlContent = textarea.value.trim();
    if (!yamlContent) {
      this.showValidationResult(container, { isValid: false, errors: ["Please paste package YAML first"], warnings: [] });
      return;
    }
    try {
      const packageData = yaml.load(yamlContent) as PackageData;
      if (!packageData || typeof packageData !== "object") {
        this.showValidationResult(container, { isValid: false, errors: ["Invalid YAML format"], warnings: [] });
        return;
      }
      if (!packageData.name || !packageData.author || !packageData.version || !packageData.snippets) {
        this.showValidationResult(container, {
          isValid: false,
          errors: ["This doesn't look like a community package. Make sure it has name, author, version, and snippets fields."],
          warnings: [],
        });
        return;
      }
      const validation = validatePackage(packageData, { strictMode: false });
      this.validationResult = validation;
      this.showValidationResult(container, validation);
      const submitBtn = container.parentElement?.querySelector(".submit-btn") as HTMLButtonElement;
      if (submitBtn) submitBtn.disabled = !validation.isValid;
    } catch (error) {
      this.showValidationResult(container, { isValid: false, errors: [`Failed to parse YAML: ${error}`], warnings: [] });
    }
  }

  private showValidationResult(container: HTMLElement, validation: ValidationResult) {
    container.empty();
    if (validation.isValid) {
      const successEl = container.createDiv({ cls: "validation-success" });
      successEl.createEl("div", { 
          text: "✅ Package is valid!", 
          cls: "validation-title" 
      });
      if (validation.warnings.length > 0) {
        const warningsEl = successEl.createDiv({ cls: "validation-warnings" });
        warningsEl.createEl("div", { 
            text: "Warnings:", 
            cls: "warnings-title" 
        });
        validation.warnings.forEach((w: string) => warningsEl.createEl("div", { text: `⚠️ ${w}`, cls: "warning-item" }));
      }
    } else {
      const errorEl = container.createDiv({ cls: "validation-error" });
      errorEl.createEl("div", { 
          text: "❌ Validation failed:", 
          cls: "validation-title" 
      });
      validation.errors.forEach((e: string) => errorEl.createEl("div", { text: `• ${e}`, cls: "error-item" }));
    }
  }

  private async submitPackage(textarea: HTMLTextAreaElement, submitBtn: HTMLButtonElement) {
    if (!this.validationResult || !this.validationResult.isValid) {
      new Notice("Please validate the package first");
      return;
    }
    
    try {
      const yamlContent = textarea.value.trim();
      const packageData = yaml.load(yamlContent) as PackageData;
      
      // Create Issue via GitHub API
      const result = await createPackageIssue(this.app, packageData, { author: packageData.author });
      
      if (result.success && result.issueUrl) {
        // Show notification with Issue link
        const notice = new Notice("🎉 Package submitted successfully! Click to view issue.", 10000);
        notice.messageEl.onclick = () => {
          window.open(result.issueUrl, '_blank');
        };
        
        // Clear form
        textarea.value = "";
        submitBtn.disabled = true;
        this.validationResult = null;
        const validationContainer = submitBtn.parentElement?.parentElement?.querySelector(".validation-container");
        if (validationContainer) validationContainer.empty();
      } else {
        // Show error with Google Form link
        this.showErrorWithFeedbackForm(`Failed to submit package: ${result.error}`);
      }
    } catch (error) {
      this.showErrorWithFeedbackForm(`Failed to submit package: ${error}`);
    }
  }

  private showErrorWithFeedbackForm(message: string) {
    // eslint-disable-next-line obsidianmd/ui/sentence-case -- Error message with action link
    const errorNotice = new Notice(`❌ ${message} Click to report bug.`, 10000);
    errorNotice.messageEl.onclick = () => {
      const pluginVersion = this.plugin.manifest.version;
      const meta = collectSystemMeta(this.app, pluginVersion);
      const baseUrl = "https://docs.google.com/forms/d/e/1FAIpQLSf4kFr5pme9C0CX02NOad_9STlia5-xZ2D-9C88u1mX32WqXw/viewform";
      const formUrl = buildGoogleFormUrl(baseUrl, "Bug report", meta);
      window.open(formUrl, '_blank');
    };
  }
}
