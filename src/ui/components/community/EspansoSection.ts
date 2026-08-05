import { App, Notice } from "obsidian";
import type SnipSidianPlugin from "../../../main";
import { espansoYamlToSnippets, type EspansoSkip } from "../../../packages/espanso";
import { PackagePreviewModal } from "../Modals";
import { countAppliedChanges, planGroupedInstall } from "../../../core/install-plan";
import { joinKey, slugifyGroup } from "../../../store/keys";
import { GroupManager } from "../../utils/group-utils";

/** Default group label for Espanso imports when the user doesn't
 *  type one. Slugified at write time via `slugifyGroup`. */
const DEFAULT_GROUP_LABEL = "Espanso import";

/**
 * B-139: honest summary of what a parse produced. Espanso packages
 * routinely use `{{vars}}`/forms/shell that this importer can't
 * represent — before this, those matches silently imported as
 * literal `{{corrupted}}` text with zero indication anything was
 * wrong. `espansoYamlToSnippets` now reports what it skipped and
 * why; this renders that into the one-line summary shown both as a
 * status message in the section and (for the conflict path) inside
 * the confirm modal.
 */
function formatSkipSummary(importedCount: number, skipped: EspansoSkip[]): string {
  const shown = skipped.slice(0, 3).map((s) => s.trigger);
  const names = skipped.length > 3 ? `${shown.join(", ")}, …` : shown.join(", ");
  if (importedCount === 0) {
    const plural = skipped.length === 1 ? "match uses" : "matches use";
    return `Nothing to import: ${skipped.length} ${plural} forms/scripts Snipsy doesn't support (${names})`;
  }
  return `${importedCount} imported, ${skipped.length} skipped: ${names} — use forms/scripts Snipsy doesn't support`;
}

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

    // B-139: status line for the skip summary. Hidden by default —
    // "zero-skip pack → no skip UI" is the pinned contract, so this
    // only ever shows when `skipped.length > 0`. `aria-live="polite"`
    // per the house pattern (matches `TextPromptModal`'s hint,
    // `AddSnippetModal`'s error div, etc.).
    const espansoStatusEl = espansoSection.createDiv({
      cls: "snipsy-espanso-skip-status",
      attr: { "aria-live": "polite" },
    });
    espansoStatusEl.hide();

    espansoInstallBtn.onclick = () => {
      espansoStatusEl.hide();
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
      // B-139: the importer now reports what it couldn't map
      // (`skipped`) alongside what it could (`snippets`).
      let parsed: { snippets: Record<string, string>; skipped: EspansoSkip[] };
      try {
        parsed = espansoYamlToSnippets(yamlText);
      } catch (err) {
        new Notice(`Failed to parse Espanso package: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }

      // B-139: nothing importable — surface why and stop before any
      // validation/write. This is a distinct case from "the pasted
      // YAML had zero matches at all" (unchanged, falls through to
      // "Installed 0 snippets" below like before B-139).
      if (parsed.skipped.length > 0 && Object.keys(parsed.snippets).length === 0) {
        const msg = formatSkipSummary(0, parsed.skipped);
        espansoStatusEl.setText(msg);
        espansoStatusEl.show();
        new Notice(msg);
        return;
      }

      // B-140: validate → cross-group collision gate → diff, via the
      // one planner shared with `PackageBrowser.installPackage` —
      // Espanso used to hand-copy this sequence and had already
      // diverged from the community-pack path (the exact duplication
      // shape that produced S-009: Espanso skipped
      // `validatePackageForInstall` for a year because a gate was
      // added on one path only). `planGroupedInstall` runs that
      // validation before the diff/write on every caller, and its
      // pinned collision semantics replace Espanso's old
      // "skip only on identical value" check — a same-key re-import of
      // an edited snippet now goes through the shared conflict preview
      // instead of a hard refusal (user-visible change, matches
      // community-pack behavior).
      const plan = planGroupedInstall(parsed.snippets, groupSlug, this.plugin.settings);

      if (!plan.validation.isValid) {
        const first = plan.validation.errors[0] ?? "Import failed validation";
        const more =
          plan.validation.errors.length > 1
            ? ` (and ${plan.validation.errors.length - 1} more)`
            : "";
        new Notice(`Cannot import Espanso package: ${first}${more}`);
        console.error("[snipsy] Espanso import validation failed", plan.validation.errors);
        return;
      }

      if (plan.collisions.length > 0) {
        const collisions = plan.collisions.join(", ");
        new Notice(`Skipped install: trigger name collision with existing snippets (${collisions})`);
        return;
      }

      // B-045: build the grouped map for the direct-install (no
      // conflicts) path below. Triggers stay reachable via
      // `<groupSlug>/<trigger>` keys — same shape as community packs.
      const incoming: Record<string, string> = {};
      for (const [trigger, replacement] of Object.entries(parsed.snippets)) {
        incoming[joinKey(groupSlug, trigger)] = replacement;
      }

      // B-139 skip summary is a PARSE-time concept — "how many matches
      // parsed vs. got skipped" — and stays constant regardless of
      // what the user later chooses in the conflict modal. Keep it
      // decoupled from the ux#7 "what actually changed" count below.
      const parsedCount = Object.keys(parsed.snippets).length;

      if (plan.diff.conflicts.length > 0) {
        // B-060: conflict modal title matches the section heading.
        const modal = new PackagePreviewModal(
          this.app,
          this.plugin,
          "Import from Espanso YAML",
          plan.diff,
        );
        modal.onConfirm = async (resolved) => {
          this.plugin.settings.snippets = resolved;
          await this.plugin.saveSettings();
          // Fold-in (ux#7): report what actually changed given the
          // user's per-conflict choices, not the full pack size — a
          // "keep everything" resolution used to still claim every
          // entry as "imported".
          const changedCount = countAppliedChanges(plan.diff, resolved);
          this.reportInstalled(espansoStatusEl, changedCount, parsedCount, rawGroupLabel, parsed.skipped);
        };
        modal.open();
        // B-139: the skip list must also be visible in the confirm
        // modal path, not just the eventual success Notice — inject
        // it as the modal's first block so the user sees it BEFORE
        // deciding how to resolve conflicts, without touching the
        // shared `PackagePreviewModal` class (also used by
        // `PackageBrowser`).
        if (parsed.skipped.length > 0) {
          const skipEl = modal.contentEl.createDiv({
            cls: "snipsy-espanso-skip-status",
            attr: { "aria-live": "polite" },
          });
          skipEl.setText(formatSkipSummary(parsedCount, parsed.skipped));
          modal.contentEl.insertBefore(skipEl, modal.contentEl.firstChild);
        }
      } else {
        // No conflicts: every incoming entry is either genuinely new
        // (`plan.diff.added`) or an identical-value no-op re-import
        // that `diffIncoming` silently drops — `plan.diff.added.length`
        // is the honest "actually changed" count (ux#7), not
        // `Object.keys(incoming).length`.
        void this.installFromIncoming(
          incoming,
          plan.diff.added.length,
          parsedCount,
          rawGroupLabel,
          espansoStatusEl,
          parsed.skipped,
        );
      }
    };
  }

  /** B-139: shared success-reporting tail for both the direct-install
   *  and conflict-resolved-install paths.
   *
   *  `changedCount` (ux#7, B-140) is what actually landed in
   *  `settings.snippets` given the user's keep/overwrite choices — 0
   *  when every conflict was resolved as "keep current" gets an
   *  honest "no changes" Notice instead of claiming an install that
   *  didn't happen. `parsedCount` (B-139) is the parse-time "how many
   *  matches parsed vs. skipped" figure fed to `formatSkipSummary` —
   *  independent of `changedCount`, since a skip is a parsing outcome,
   *  not a settings-write outcome. */
  private reportInstalled(
    statusEl: HTMLElement,
    changedCount: number,
    parsedCount: number,
    groupLabel: string,
    skipped: EspansoSkip[],
  ) {
    const base =
      changedCount === 0
        ? `No changes — "${groupLabel}" already matches your library`
        : `Installed ${changedCount} snippet${changedCount === 1 ? "" : "s"} into "${groupLabel}"`;

    if (skipped.length > 0) {
      const msg = formatSkipSummary(parsedCount, skipped);
      statusEl.setText(msg);
      statusEl.show();
      new Notice(`${base}. ${msg}`);
    } else {
      new Notice(base);
    }
  }

  /** Apply already-prefixed snippets to settings. Caller has done the
   *  collision check + diff computation. B-061: no re-parse.
   *  `changedCount` is `plan.diff.added.length` — see the ux#7 note at
   *  the call site. */
  private async installFromIncoming(
    incoming: Record<string, string>,
    changedCount: number,
    parsedCount: number,
    groupLabel: string,
    statusEl: HTMLElement,
    skipped: EspansoSkip[],
  ) {
    try {
      for (const [groupedKey, replacement] of Object.entries(incoming)) {
        this.plugin.settings.snippets[groupedKey] = replacement;
      }
      await this.plugin.saveSettings();
      this.reportInstalled(statusEl, changedCount, parsedCount, groupLabel, skipped);
    } catch (err) {
      new Notice(`Failed to install from YAML: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
