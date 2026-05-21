import { App, Notice } from "obsidian";
import type SnipSidianPlugin from "../../../main";
import { espansoYamlToSnippets } from "../../../packages/espanso";
import { diffIncoming } from "../../../store/diff";
import { PackagePreviewModal } from "../Modals";
import { hasReplacementCollision } from "../../../store/snippets";

export class EspansoSection {
  constructor(
    private app: App,
    private plugin: SnipSidianPlugin
  ) {}

  render(root: HTMLElement): void {
    const espansoSection = root.createDiv({ cls: "snipsy-section snipsy-espanso-section" });
    // B-059: "Install package from hub" was misleading — Snipsy
    // doesn't fetch from the Espanso hub, the user pastes YAML
    // manually. Honest framing: "Import from Espanso YAML".
    espansoSection.createEl("h3", { text: "Import from Espanso YAML", cls: "section-title" });
    const espansoHelpText = espansoSection.createDiv({ cls: "help-text" });
    espansoHelpText.createEl("p", { text: "Paste YAML from the Espanso hub or any other source — Snipsy parses the trigger list and imports it as snippets." });
    const espansoLinkEl = espansoHelpText.createEl("p", { text: "Browse packages at ", cls: "snipsy-hint" });
    const espansoLink = espansoLinkEl.createEl("a", {
      text: "Espanso hub",
      href: "https://hub.espanso.org/search",
      cls: "snipsy-link",
    });
    espansoLink.setAttribute("target", "_blank");
    espansoLink.setAttribute("rel", "noopener noreferrer");

    const espansoYamlRow = espansoSection.createDiv({ cls: "yaml-input-row" });
    espansoYamlRow.createEl("p", { text: "Paste an Espanso package's YAML below", cls: "yaml-instruction" });
    const espansoYamlContainer = espansoYamlRow.createDiv({ cls: "yaml-container" });
    const espansoTextarea: HTMLTextAreaElement = espansoYamlContainer.createEl("textarea", {
      placeholder: "Paste Espanso YAML here…",
      cls: "yaml-textarea",
      attr: { "aria-label": "Espanso YAML to import" },
    });

    const espansoButtonRow = espansoSection.createDiv({ cls: "button-row" });
    // B-056 + B-059: button text matches the section heading
    // ("Import snippets" — verb form of "Import from Espanso YAML").
    const espansoInstallBtn = espansoButtonRow.createEl("button", { text: "Import snippets", cls: "install-btn" });
    espansoInstallBtn.onclick = () => {
      const yamlText = espansoTextarea.value;
      if (!yamlText?.trim()) {
        new Notice("Please paste YAML content first");
        return;
      }
      try {
        const incoming = espansoYamlToSnippets(yamlText);
        const triggerCollisions = Object.entries(incoming).filter(([trigger, replacement]) => {
          return hasReplacementCollision(this.plugin.settings, trigger, replacement);
        });

        if (triggerCollisions.length > 0) {
          const collisions = triggerCollisions.map(([trigger]) => trigger).join(", ");
          new Notice(`Skipped install: trigger name collision with existing snippets (${collisions})`);
          return;
        }

        const diff = diffIncoming(incoming, this.plugin.settings.snippets);
        if (diff.conflicts.length > 0) {
          // B-060: conflict modal title matches the section heading
          // ("Import from Espanso YAML" instead of Title Case
          // "Espanso Package"). Sentence case across modals.
          const modal = new PackagePreviewModal(this.app, this.plugin, "Import from Espanso YAML", diff);
          modal.onConfirm = async (resolved) => {
            this.plugin.settings.snippets = resolved;
            await this.plugin.saveSettings();
            new Notice(`Installed ${Object.keys(incoming).length} snippets from YAML`);
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
