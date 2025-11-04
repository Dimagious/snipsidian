import { App, Modal, Notice } from "obsidian";
import type SnipSidianPlugin from "../../main";
import { validatePackage, type ValidationResult } from "../../services/package-validator";
import { processPackageSubmission } from "../../services/community-packages";
import type { PackageData } from "../../services/package-types";
import * as yaml from "js-yaml";

export class SubmitPackageModal extends Modal {
    private yamlTextarea!: HTMLTextAreaElement;
    private validationContainer!: HTMLElement;
    private submitBtn!: HTMLButtonElement;
    private validationResult: ValidationResult | null = null;

    constructor(
        public app: App,
        private plugin: SnipSidianPlugin
    ) {
        super(app);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("snipsy-submit-modal");

        // Header
        const header = contentEl.createDiv({ cls: "modal-header" });
        header.createEl("h2", { text: "Submit community package" });
        header.createEl("p", { 
            text: "Share your snippet collection with the community!",
            cls: "modal-subtitle"
        });

        // Help text
        const helpText = contentEl.createDiv({ cls: "help-text" });
        helpText.createEl("p", { 
            text: "Paste your package YAML below. Make sure it follows the community package format with name, author, version, and snippets."
        });
        
        const helpLink = helpText.createEl("a", {
            text: "Learn how to create packages",
            href: "https://github.com/Dimagious/snipsidian/wiki/Package-Creation",
            cls: "help-link"
        });
        helpLink.setAttribute("target", "_blank");
        helpLink.setAttribute("rel", "noopener noreferrer");

        // YAML input
        const yamlContainer = contentEl.createDiv({ cls: "yaml-container" });
        yamlContainer.createEl("label", { 
            // eslint-disable-next-line obsidianmd/ui/sentence-case -- Label format with acronym
            text: "Package YAML:",
            cls: "yaml-label"
        });
        
        this.yamlTextarea = yamlContainer.createEl("textarea", {
            placeholder: "Paste your community package YAML here...",
            cls: "yaml-textarea"
        });

        // Validation container
        this.validationContainer = contentEl.createDiv({ cls: "validation-container" });

        // Buttons
        const buttonContainer = contentEl.createDiv({ cls: "button-container" });
        
        const validateBtn = buttonContainer.createEl("button", {
            // eslint-disable-next-line obsidianmd/ui/sentence-case -- Button action text
            text: "Validate package",
            cls: "validate-btn"
        });
        validateBtn.onclick = () => this.validatePackage();

        this.submitBtn = buttonContainer.createEl("button", {
            // eslint-disable-next-line obsidianmd/ui/sentence-case -- Button action text
            text: "Submit package",
            cls: "submit-btn"
        });
        this.submitBtn.disabled = true;
        this.submitBtn.onclick = () => this.submitPackage();
    }

    private validatePackage() {
        const yamlContent = this.yamlTextarea.value.trim();
        
        if (!yamlContent) {
            this.showValidationResult({
                isValid: false,
                errors: ["Please paste package YAML first"],
                warnings: []
            });
            return;
        }

        try {
            const packageData = yaml.load(yamlContent);
            
            if (!packageData || typeof packageData !== 'object') {
                this.showValidationResult({
                    isValid: false,
                    errors: ["Invalid YAML format"],
                    warnings: []
                });
                return;
            }

            // Check if it looks like a community package
            const typedPackageData = packageData as PackageData;
            if (!typedPackageData.name || !typedPackageData.author || !typedPackageData.version || !typedPackageData.snippets) {
                this.showValidationResult({
                    isValid: false,
                    errors: ["This doesn't look like a community package. Make sure it has name, author, version, and snippets fields."],
                    warnings: []
                });
                return;
            }

            // Validate the package
            const validation = validatePackage(typedPackageData, { strictMode: false });
            this.validationResult = validation;
            this.showValidationResult(validation);

            // Enable submit button if valid
            this.submitBtn.disabled = !validation.isValid;

        } catch (error) {
            this.showValidationResult({
                isValid: false,
                errors: [`Failed to parse YAML: ${error}`],
                warnings: []
            });
        }
    }

    private showValidationResult(validation: ValidationResult) {
        this.validationContainer.empty();

        if (validation.isValid) {
            const successEl = this.validationContainer.createDiv({ cls: "validation-success" });
            successEl.createEl("div", { 
                // eslint-disable-next-line obsidianmd/ui/sentence-case -- Success validation message
                text: "✅ Package is valid!",
                cls: "validation-title"
            });
            
            if (validation.warnings.length > 0) {
                const warningsEl = successEl.createDiv({ cls: "validation-warnings" });
                warningsEl.createEl("div", { 
                    text: "Warnings:",
                    cls: "warnings-title"
                });
                validation.warnings.forEach((warning: string) => {
                    warningsEl.createEl("div", { 
                        text: `⚠️ ${warning}`,
                        cls: "warning-item"
                    });
                });
            }
        } else {
            const errorEl = this.validationContainer.createDiv({ cls: "validation-error" });
            errorEl.createEl("div", { 
                // eslint-disable-next-line obsidianmd/ui/sentence-case -- Error message format
                text: "❌ Validation failed:",
                cls: "validation-title"
            });
            
            validation.errors.forEach((error: string) => {
                errorEl.createEl("div", { 
                    text: `• ${error}`,
                    cls: "error-item"
                });
            });
        }
    }

    private async submitPackage() {
        if (!this.validationResult || !this.validationResult.isValid) {
            new Notice("Please validate the package first");
            return;
        }

        try {
            const yamlContent = this.yamlTextarea.value.trim();
            const packageData = yaml.load(yamlContent) as PackageData;
            
            // Generate a temporary filename
            const packageId = this.generatePackageId(packageData.name || '');
            const fileName = `${packageId}.yml`;
            
            // Submit to pending folder
            const result = await processPackageSubmission(packageData, `community-packages/pending/${fileName}`);
            
            if (result.success) {
                // Show success message
                this.showSuccessMessage();
                
                // Close modal after a delay
                setTimeout(() => {
                    this.close();
                }, 3000);
            } else {
                new Notice(`Failed to submit package: ${result.errors.join(', ')}`);
            }
        } catch (error) {
            new Notice(`Failed to submit package: ${error}`);
        }
    }

    private showSuccessMessage() {
        this.validationContainer.empty();
        
        const successEl = this.validationContainer.createDiv({ cls: "submission-success" });
        successEl.createEl("div", { 
            // eslint-disable-next-line obsidianmd/ui/sentence-case -- Success celebration message
            text: "🎉 Thank you for contributing to the community!",
            cls: "success-title"
        });
        successEl.createEl("div", { 
            // eslint-disable-next-line obsidianmd/ui/sentence-case -- Success message text
            text: "Your package has been submitted for review and will appear in the pending packages.",
            cls: "success-message"
        });
        
        const linkEl = successEl.createEl("a", {
            text: "View pending packages",
            href: "https://github.com/Dimagious/snipsidian/wiki/Community-Guidelines",
            cls: "success-link"
        });
        linkEl.setAttribute("target", "_blank");
        linkEl.setAttribute("rel", "noopener noreferrer");
    }

    private generatePackageId(name: string): string {
        return name
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-+|-+$/g, '');
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}
