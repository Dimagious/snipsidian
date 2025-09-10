import { App, Notice, Setting } from "obsidian";
import type SnipSidianPlugin from "../../main";
import { PACKAGE_CATALOG } from "../../catalog";
import { diffIncoming } from "../../services/utils";
import { espansoYamlToSnippets } from "../../packages/espanso";
import { PackagePreviewModal } from "./Modals";

export class PackagesTab {
    constructor(
        private app: App,
        private plugin: SnipSidianPlugin
    ) {}

    render(root: HTMLElement) {
        const section = (title: string, hint?: string, specialClass?: string) => {
            const wrap = root.createDiv({ cls: `snipsy-section ${specialClass || ""}` });
            wrap.createEl("h3", { text: title });
            if (hint) wrap.createEl("p", { text: hint, cls: "snipsy-hint" });
            return wrap;
        };

        const catalogSection = section("Install from Catalog", "Curated packages designed for Obsidian.", "snipsy-catalog-section");

        new Setting(catalogSection)
            .setName("Package")
            .setDesc("Select a package to install")
            .addDropdown((dropdown) => {
                dropdown.addOption("", "Choose a package...");
                for (const pkg of PACKAGE_CATALOG) {
                    dropdown.addOption(pkg.id, pkg.label);
                }
                dropdown.onChange(async (value) => {
                    if (!value) return;
                    const pkg = PACKAGE_CATALOG.find((p) => p.id === value);
                    if (!pkg) return;

                    try {
                        const incoming = espansoYamlToSnippets(pkg.yaml);
                        const conflicts = diffIncoming(this.plugin.settings.snippets, incoming);
                        
                        if (conflicts.conflicts.length > 0) {
                            new PackagePreviewModal(this.app, this.plugin, pkg.label, conflicts).onConfirm = (resolved) => {
                                this.installPackage(pkg);
                            };
                            new PackagePreviewModal(this.app, this.plugin, pkg.label, conflicts).open();
                        } else {
                            this.installPackage(pkg);
                        }
                    } catch (err) {
                        new Notice(`Failed to parse package: ${err}`);
                    }
                });
            });

        const yamlSection = section("Install from YAML", "Paste any Espanso-compatible package.", "snipsy-yaml-section");

        new Setting(yamlSection)
            .setName("YAML Package")
            .setDesc("Paste YAML content from Espanso Hub or other sources")
            .addTextArea((text) => {
                text
                    .setPlaceholder("Paste YAML here...")
                    .setValue("")
                    .inputEl.style.height = "120px";
            })
            .addButton((btn) =>
                btn
                    .setButtonText("Install")
                    .setCta()
                    .onClick(async () => {
                        const yaml = (btn.buttonEl.previousElementSibling as HTMLTextAreaElement)?.value;
                        if (!yaml?.trim()) {
                            new Notice("Please paste YAML content first");
                            return;
                        }

                        try {
                            const incoming = espansoYamlToSnippets(yaml);
                            const conflicts = diffIncoming(this.plugin.settings.snippets, incoming);
                            
                            if (conflicts.conflicts.length > 0) {
                                const modal = new PackagePreviewModal(this.app, this.plugin, "Custom Package", conflicts);
                                modal.onConfirm = (resolved) => {
                                    this.installFromYaml(yaml);
                                };
                                modal.open();
                            } else {
                                this.installFromYaml(yaml);
                            }
                        } catch (err) {
                            new Notice(`Failed to parse YAML: ${err}`);
                        }
                    })
            );
    }

    private async installPackage(pkg: { id: string; label: string; kind: "builtin"; yaml: string }) {
        try {
            const incoming = espansoYamlToSnippets(pkg.yaml);
            const folder = pkg.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
            
            for (const [trigger, replacement] of Object.entries(incoming)) {
                const key = folder ? `${folder}/${trigger}` : trigger;
                this.plugin.settings.snippets[key] = replacement as string;
            }
            
            await this.plugin.saveSettings();
            new Notice(`Installed "${pkg.label}" package`);
        } catch (err) {
            new Notice(`Failed to install package: ${err}`);
        }
    }

    private async installFromYaml(yaml: string) {
        try {
            const incoming = espansoYamlToSnippets(yaml);
            
            for (const [trigger, replacement] of Object.entries(incoming)) {
                this.plugin.settings.snippets[trigger] = replacement as string;
            }
            
            await this.plugin.saveSettings();
            new Notice(`Installed ${Object.keys(incoming).length} snippets from YAML`);
        } catch (err) {
            new Notice(`Failed to install from YAML: ${err}`);
        }
    }
}
