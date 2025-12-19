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
    espansoSection.createEl("h3", { text: "Install package from hub", cls: "section-title" });
    const espansoHelpText = espansoSection.createDiv({ cls: "help-text" });
    espansoHelpText.createEl("p", { text: "Paste packages from the hub." });
    const espansoLinkEl = espansoHelpText.createEl("p", { text: "Browse packages at ", cls: "snipsy-hint" });
    const espansoLink = espansoLinkEl.createEl("a", {
      text: "Espanso hub",
      href: "https://hub.espanso.org/search",
      cls: "snipsy-link",
    });
    espansoLink.setAttribute("target", "_blank");
    espansoLink.setAttribute("rel", "noopener noreferrer");

    const espansoYamlRow = espansoSection.createDiv({ cls: "yaml-input-row" });
    espansoYamlRow.createEl("p", { text: "Paste YAML content from the hub or other sources", cls: "yaml-instruction" });
    const espansoYamlContainer = espansoYamlRow.createDiv({ cls: "yaml-container" });
    const espansoTextarea: HTMLTextAreaElement = espansoYamlContainer.createEl("textarea", {
      placeholder: "Paste Espanso YAML here…",
      cls: "yaml-textarea",
    });

    const espansoButtonRow = espansoSection.createDiv({ cls: "button-row" });
    const espansoInstallBtn = espansoButtonRow.createEl("button", { text: "Install package", cls: "install-btn" });
    espansoInstallBtn.onclick = () => {
      const yamlText = espansoTextarea.value;
      if (!yamlText?.trim()) {
        new Notice("Please paste YAML content first");
        return;
      }
      try {
        const incoming = espansoYamlToSnippets(yamlText);
        const conflicts = diffIncoming(this.plugin.settings.snippets, incoming);
        if (conflicts.conflicts.length > 0) {
          const modal = new PackagePreviewModal(this.app, this.plugin, "Espanso Package", conflicts);
          modal.onConfirm = async () => {
            await this.installFromYaml(yamlText);
          };
          modal.open();
        } else {
          void this.installFromYaml(yamlText);
        }
      } catch (err) {
        new Notice(`Failed to parse Espanso package: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
  }

  private async installFromYaml(yamlStr: string) {
    try {
      const incoming = espansoYamlToSnippets(yamlStr);
      for (const [trigger, replacement] of Object.entries(incoming)) {
        this.plugin.settings.snippets[trigger] = replacement;
      }
      await this.plugin.saveSettings();
      new Notice(`Installed ${Object.keys(incoming).length} snippets from YAML`);
    } catch (err) {
      new Notice(`Failed to install from YAML: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
