import { App, Notice } from "obsidian";
import type SnipSidianPlugin from "../../../main";
import { espansoYamlToSnippets } from "../../../packages/espanso";
import { diffIncoming } from "../../../services/utils";
import { PackagePreviewModal } from "../Modals";

export class EspansoSection {
  constructor(
    private app: App,
    private plugin: SnipSidianPlugin
  ) {}

  render(root: HTMLElement): void {
    const espansoSection = root.createDiv({ cls: "snipsy-section snipsy-espanso-section" });
    espansoSection.createEl("h3", { text: "Install Espanso Package", cls: "section-title" });
    const espansoHelpText = espansoSection.createDiv({ cls: "help-text" });
    espansoHelpText.createEl("p", { text: "Paste packages from Espanso Hub." });
    const espansoLinkEl = espansoHelpText.createEl("p", { text: "Browse packages at ", cls: "snipsy-hint" });
    const espansoLink = espansoLinkEl.createEl("a", {
      text: "Espanso Hub",
      href: "https://hub.espanso.org/search",
      cls: "snipsy-link",
    });
    espansoLink.setAttribute("target", "_blank");
    espansoLink.setAttribute("rel", "noopener noreferrer");

    const espansoYamlRow = espansoSection.createDiv({ cls: "yaml-input-row" });
    espansoYamlRow.createEl("p", { text: "Paste YAML content from Espanso Hub or other Espanso sources", cls: "yaml-instruction" });
    const espansoYamlContainer = espansoYamlRow.createDiv({ cls: "yaml-container" });
    const espansoTextarea = espansoYamlContainer.createEl("textarea", {
      placeholder: "Paste Espanso YAML here…",
      cls: "yaml-textarea",
    }) as HTMLTextAreaElement;
    espansoTextarea.style.height = "120px";

    const espansoButtonRow = espansoSection.createDiv({ cls: "button-row" });
    const espansoInstallBtn = espansoButtonRow.createEl("button", { text: "Install Espanso Package", cls: "install-btn" });
    espansoInstallBtn.onclick = async () => {
      const yamlText = espansoTextarea.value;
      if (!yamlText?.trim()) {
        new Notice("Please paste Espanso YAML first");
        return;
      }
      try {
        const incoming = espansoYamlToSnippets(yamlText);
        const conflicts = diffIncoming(this.plugin.settings.snippets, incoming);
        if (conflicts.conflicts.length > 0) {
          const modal = new PackagePreviewModal(this.app, this.plugin, "Espanso Package", conflicts);
          modal.onConfirm = () => this.installFromYaml(yamlText);
          modal.open();
        } else {
          this.installFromYaml(yamlText);
        }
      } catch (err) {
        new Notice(`Failed to parse Espanso package: ${err}`);
      }
    };
  }

  private async installFromYaml(yamlStr: string) {
    try {
      const incoming = espansoYamlToSnippets(yamlStr);
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
