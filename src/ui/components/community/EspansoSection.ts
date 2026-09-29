import { App, Notice } from "obsidian";
import type SnipSidianPlugin from "../../../main";
import { espansoYamlToSnippets, type EspansoSkip } from "../../../packages/espanso";
import { PackagePreviewModal } from "../Modals";
import { countAppliedChanges, planGroupedInstall } from "../../../core/install-plan";
import { joinKey, slugifyGroup } from "../../../store/keys";
import { GroupManager } from "../../utils/group-utils";
import { renderSettingGroup } from "../../utils/setting-group";
import { formatTriggerList, sanitizeForNotice } from "../../../shared/notice-text";

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
 *
 * B-153/wording: dropped the em dash ("… — use forms/scripts …") for
 * a plain sentence.
 */
function formatSkipSummary(importedCount: number, skipped: EspansoSkip[]): string {
  // B-034 (finding #7): `s.trigger` is a raw Espanso match trigger
  // parsed straight out of pasted YAML — untrusted. Sanitize each
  // shown name before it reaches the status line / Notice.
  const shown = skipped.slice(0, 3).map((s) => sanitizeForNotice(s.trigger, 60));
  const names = skipped.length > 3 ? `${shown.join(", ")}, …` : shown.join(", ");
  if (importedCount === 0) {
    const plural = skipped.length === 1 ? "match uses" : "matches use";
    return `Nothing to import: ${skipped.length} ${plural} forms/scripts Snipsy doesn't support (${names})`;
  }
  return `${importedCount} imported, ${skipped.length} skipped: ${names}. Forms and scripts are not supported.`;
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
    // B-153/wording: "Import from Espanso YAML" (heading) becomes
    // "Espanso import" — the tab already reads as a packages surface,
    // and the section heading no longer needs to restate "Import".
    const group = renderSettingGroup(root, "Espanso import");
    const espansoSection = group.bodyEl;
    espansoSection.addClass("snipsy-espanso-section");

    // B-153/wording: the intro paragraph replaces the old two-line
    // "Paste YAML from the Espanso hub…" + "Browse packages at Espanso
    // hub" pair with one sentence, link on "Espanso hub".
    //
    // V2 fix (2026-09 UI-redesign follow-up): this used to be a bare
    // `createDiv` dropped directly into the group's body — it relied
    // on `.setting-items` itself carrying the row inset as container
    // padding, which held on Obsidian 1.12 but not 1.13 (verified
    // against the real 1.13.7 app.css): 1.13 moved that inset onto
    // each `.setting-item` row individually (`--setting-items-padding-x/-y`,
    // via `var(--setting-items-padding)` which no longer exists as a
    // single token) and gives the divider between rows via a
    // `::before` on the row rather than a plain `border-top`. A bare
    // div gets neither, so the paragraph sat flush against the box's
    // top-left corner instead of lining up with the rows below it.
    // Building it as a real (nameless) row's `descEl` — the same
    // pattern `PackageSubmissionSection`'s "Share a package" intro
    // already uses — gets the correct inset for free, on any Obsidian
    // version, because it's real row markup rather than our own guess
    // at the row's padding.
    group.addSetting((s) => {
      s.descEl.appendText(
        "Paste package YAML. Plain text triggers become snippets; forms and scripts are skipped. Find packages on the ",
      );
      const espansoLink = s.descEl.createEl("a", {
        text: "Espanso hub",
        href: "https://hub.espanso.org/search",
        cls: "snipsy-link",
      });
      espansoLink.setAttribute("target", "_blank");
      espansoLink.setAttribute("rel", "noopener noreferrer");
      s.descEl.appendText(".");
    });

    // B-045: ask for a group name so the imported triggers land
    // under `<group>/<trigger>` (mirrors how PackageBrowser groups
    // community packs by label). Without this, two Espanso imports
    // can't be told apart and there's no bulk-uninstall path.
    let groupInput!: HTMLInputElement;
    group.addSetting((s) => {
      s.setName("Group name").setDesc("Imported snippets go into this group.");
      s.addText((t) => {
        groupInput = t.inputEl;
        t.inputEl.addClass("snipsy-espanso-group-input");
        // B-153/wording: placeholder matches the computed default
        // instead of the old "e.g. Espanso import" hint prefix.
        t.setPlaceholder(DEFAULT_GROUP_LABEL);
        t.inputEl.setAttr("aria-label", "Group name for the imported snippets");
        t.setValue(this.nextDefaultGroupLabel());
      });
    });

    let espansoTextarea!: HTMLTextAreaElement;
    let espansoInstallBtn!: HTMLButtonElement;
    group.addSetting((s) => {
      s.setName("Package YAML");
      s.addTextArea((t) => {
        espansoTextarea = t.inputEl;
        t.inputEl.addClass("yaml-textarea");
        t.setPlaceholder("Paste package YAML here…");
        t.inputEl.setAttr("aria-label", "Espanso YAML to import");
      });
    });

    // B-139: status line for the skip summary. Hidden by default —
    // "zero-skip pack → no skip UI" is the pinned contract, so this
    // only ever shows when `skipped.length > 0`. `aria-live="polite"`
    // per the house pattern (matches `TextPromptModal`'s hint,
    // `AddSnippetModal`'s error div, etc.). Sits on the same row as
    // the Import button, next to the action it unlocks.
    let espansoStatusEl!: HTMLDivElement;
    group.addSetting((s) => {
      espansoStatusEl = s.controlEl.createDiv({
        cls: "snipsy-espanso-skip-status",
        attr: { "aria-live": "polite" },
      });
      espansoStatusEl.hide();
      // B-056 + B-059: button text is the verb form of the section's
      // purpose ("Import snippets").
      s.addButton((b) => {
        espansoInstallBtn = b.buttonEl;
        b.setButtonText("Import snippets").setCta();
      });
    });

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
        // B-034: the `yaml` package's parse errors embed a
        // pretty-printed excerpt of the OFFENDING SOURCE TEXT (the
        // pasted, untrusted YAML) — strip control characters and cap
        // the length before it reaches the Notice.
        const message = err instanceof Error ? err.message : String(err);
        new Notice(`Failed to parse Espanso package: ${sanitizeForNotice(message)}`);
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
        // B-034: validation errors can echo back an (untrusted) trigger
        // name from the pasted YAML — sanitize before the Notice.
        new Notice(`Cannot import Espanso package: ${sanitizeForNotice(`${first}${more}`)}`);
        console.error("[snipsy] Espanso import validation failed", plan.validation.errors);
        return;
      }

      if (plan.collisions.length > 0) {
        // B-034 (finding #7): `plan.collisions` are bare trigger names
        // parsed from the pasted YAML — untrusted, and previously
        // joined with no per-item or list-length cap.
        new Notice(
          `Skipped install: trigger name collision with existing snippets (${formatTriggerList(plan.collisions)})`,
        );
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
      // B-034 (finding #7): this is still on the untrusted-YAML
      // import path — sanitize before the Notice, same as every other
      // error surfaced from this flow.
      const message = err instanceof Error ? err.message : String(err);
      new Notice(`Failed to install from YAML: ${sanitizeForNotice(message)}`);
    }
  }
}
