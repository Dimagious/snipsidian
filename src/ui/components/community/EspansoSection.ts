import { App, Notice } from "obsidian";
import type SnipSidianPlugin from "../../../main";
import { espansoYamlToSnippets } from "../../../packages/espanso";
import { diffIncoming } from "../../../store/diff";
import { PackagePreviewModal } from "../Modals";
import { hasReplacementCollision } from "../../../store/snippets";
import { joinKey, slugifyGroup } from "../../../store/keys";
import { GroupManager } from "../../utils/group-utils";

/** Default group label for Espanso imports when the user doesn't
 *  type one. Slugified at write time via `slugifyGroup`. */
const DEFAULT_GROUP_LABEL = "Espanso import";

export class EspansoSection {
  private groupManager = new GroupManager();

  constructor(
    private app: App,
    private plugin: SnipSidianPlugin
  ) {}

  /**
   * Pick a default group label that doesn't collide with an existing
   * group's slug. If "Espanso import" is taken, try "Espanso import 2",
   * "Espanso import 3", etc. Caps at 50 to avoid runaway in the
   * unlikely event of 50+ prior imports.
   */
  private nextDefaultGroupLabel(): string {
    const existing = new Set(
      this.groupManager.allGroupsFrom(this.plugin.settings.snippets),
    );
    if (!existing.has(slugifyGroup(DEFAULT_GROUP_LABEL))) {
      return DEFAULT_GROUP_LABEL;
    }
    for (let n = 2; n <= 50; n++) {
      const candidate = `${DEFAULT_GROUP_LABEL} ${n}`;
      if (!existing.has(slugifyGroup(candidate))) return candidate;
    }
    return `${DEFAULT_GROUP_LABEL} (new)`;
  }

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

    // B-045: ask for a group name so the imported triggers land
    // under `<group>/<trigger>` (mirrors how PackageBrowser groups
    // community packs by label). Without this, two Espanso imports
    // can't be told apart and there's no bulk-uninstall path.
    const groupRow = espansoSection.createDiv({ cls: "snipsy-espanso-group-row" });
    groupRow.createEl("label", {
      text: "Group name",
      cls: "snipsy-hint",
      attr: { for: "snipsy-espanso-group-input" },
    });
    const groupInput = groupRow.createEl("input", {
      type: "text",
      cls: "snipsy-espanso-group-input",
      attr: {
        id: "snipsy-espanso-group-input",
        placeholder: "e.g. Espanso import",
        "aria-label": "Group name for the imported snippets",
      },
    });
    groupInput.value = this.nextDefaultGroupLabel();

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

      // B-045: resolve target group. Empty input falls back to the
      // computed default (which already avoids existing-group
      // collisions). The label is slugified before writing.
      const rawGroupLabel = groupInput.value.trim() || this.nextDefaultGroupLabel();
      const groupSlug = slugifyGroup(rawGroupLabel);
      if (!groupSlug) {
        new Notice("Group name must contain at least one letter or number");
        return;
      }

      // B-061: parse the YAML once and reuse `incoming` for collision
      // check, diff, conflict-modal apply, and the no-conflict path.
      let parsed: Record<string, string>;
      try {
        parsed = espansoYamlToSnippets(yamlText);
      } catch (err) {
        new Notice(`Failed to parse Espanso package: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }

      // B-045: build the grouped map. Triggers stay reachable via
      // `<groupSlug>/<trigger>` keys — same shape as community packs.
      const incoming: Record<string, string> = {};
      for (const [trigger, replacement] of Object.entries(parsed)) {
        incoming[joinKey(groupSlug, trigger)] = replacement;
      }

      // Cross-group collision check on the BARE trigger names — the
      // same trigger living in another group with a different
      // replacement is still a conflict for the engine
      // (`getDict`'s first-wins). Skip if the same grouped-key
      // already exists at the same value (re-import).
      const triggerCollisions = Object.entries(parsed).filter(([trigger, replacement]) => {
        const groupedKey = joinKey(groupSlug, trigger);
        if (this.plugin.settings.snippets[groupedKey] === replacement) return false;
        return hasReplacementCollision(this.plugin.settings, trigger, replacement, groupedKey);
      });

      if (triggerCollisions.length > 0) {
        const collisions = triggerCollisions.map(([trigger]) => trigger).join(", ");
        new Notice(`Skipped install: trigger name collision with existing snippets (${collisions})`);
        return;
      }

      const diff = diffIncoming(incoming, this.plugin.settings.snippets);
      if (diff.conflicts.length > 0) {
        // B-060: conflict modal title matches the section heading.
        const modal = new PackagePreviewModal(this.app, this.plugin, "Import from Espanso YAML", diff);
        modal.onConfirm = async (resolved) => {
          this.plugin.settings.snippets = resolved;
          await this.plugin.saveSettings();
          new Notice(`Installed ${Object.keys(incoming).length} snippets into "${rawGroupLabel}"`);
        };
        modal.open();
      } else {
        void this.installFromIncoming(incoming, rawGroupLabel);
      }
    };
  }

  /** Apply already-prefixed snippets to settings. Caller has done the
   *  collision check + diff computation. B-061: no re-parse. */
  private async installFromIncoming(
    incoming: Record<string, string>,
    groupLabel: string,
  ) {
    try {
      for (const [groupedKey, replacement] of Object.entries(incoming)) {
        this.plugin.settings.snippets[groupedKey] = replacement;
      }
      await this.plugin.saveSettings();
      new Notice(`Installed ${Object.keys(incoming).length} snippets into "${groupLabel}"`);
    } catch (err) {
      new Notice(`Failed to install from YAML: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
