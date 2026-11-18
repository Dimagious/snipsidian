import { App, Notice } from "obsidian";
import type SnipSidianPlugin from "../../../main";
import {
  TEXT_SNIPPETS_GROUP_SLUG,
  TEXT_SNIPPETS_PLUGIN_ID,
  textSnippetsDataToSnippets,
  type TextSnippetsImportResult,
} from "../../../packages/text-snippets";
import { PackagePreviewModal } from "../Modals";
import { countAppliedChanges, planGroupedImport } from "../../../core/install-plan";
import { commitSnippets } from "../../../core/commit-snippets";
import { renderSettingGroup } from "../../utils/setting-group";
import { sanitizeForNotice } from "../../../shared/notice-text";
import { findLatestTextSnippetsBackup } from "../../../shared/text-snippets-backup";

const SOURCE_PLUGIN_ID = TEXT_SNIPPETS_PLUGIN_ID;
const GROUP_SLUG = TEXT_SNIPPETS_GROUP_SLUG;

const NOT_FOUND_MESSAGE = "Text Snippets settings not found in this vault";
const BACKUP_NOT_FOUND_MESSAGE = "No backup of the Text Snippets file found";

/** How many names a one-line summary lists before "…". */
const SUMMARY_SHOWN = 3;

/**
 * One-line, sanitized summary of a parse: imported count, skipped
 * records with reasons, and imported snippets that were changed on the
 * way (a tab stop Snipsy can't read, extra cursor markers). Every name and reason
 * comes from a file on disk (untrusted), so each goes through
 * `sanitizeForNotice` before it reaches a Notice or the DOM (B-034).
 */
export function formatTextSnippetsSummary(
  importedCount: number,
  parsed: Pick<TextSnippetsImportResult, "skipped" | "warnings"> &
    Partial<Pick<TextSnippetsImportResult, "notes">>,
): string {
  const parts = [`${importedCount} imported`];
  const { skipped, warnings, notes = [] } = parsed;
  if (skipped.length > 0) {
    const shown = skipped
      .slice(0, SUMMARY_SHOWN)
      .map((s) => `${sanitizeForNotice(s.trigger, 40)} (${sanitizeForNotice(s.reason, 80)})`);
    const more = skipped.length > SUMMARY_SHOWN ? ", …" : "";
    parts.push(`${skipped.length} skipped: ${shown.join(", ")}${more}`);
  }
  if (warnings.length > 0) {
    const shown = warnings
      .slice(0, SUMMARY_SHOWN)
      .map((w) => `${sanitizeForNotice(w.trigger, 40)} (${sanitizeForNotice(w.message, 80)})`);
    const more = warnings.length > SUMMARY_SHOWN ? ", …" : "";
    parts.push(`${warnings.length} changed: ${shown.join(", ")}${more}`);
  }
  for (const note of notes) parts.push(sanitizeForNotice(note, 200));
  return parts.join("; ");
}

function hasReport(parsed: TextSnippetsImportResult): boolean {
  return parsed.skipped.length > 0 || parsed.warnings.length > 0 || parsed.notes.length > 0;
}

/**
 * B-174: import snippets from the Text Snippets plugin
 * (`text-snippets-obsidian`). Same pipeline as `EspansoSection`: pure
 * parser -> `planGroupedImport` (which runs `validatePackageForInstall`,
 * S-009) -> always-on preview -> write. The other plugin's files
 * are only ever read.
 */
export class TextSnippetsSection {
  constructor(
    private app: App,
    private plugin: SnipSidianPlugin,
  ) {}

  /**
   * Under the Text Snippets id this plugin's own data.json IS the migrated
   * file, so the section is for recovery only: it appears when a backup of the
   * original exists (a conversion that failed, see the migration) and reads
   * that backup. Under `snipsidian` it reads the other plugin's data.json.
   * Async because finding a backup lists a folder; the `snipsidian` path
   * renders before the first await.
   */
  async render(root: HTMLElement): Promise<void> {
    const compat = this.isCompatId();
    if (compat) {
      let backup: string | null;
      try {
        backup = await findLatestTextSnippetsBackup(this.app.vault.adapter, this.pluginDir());
      } catch (err) {
        console.error("[snipsy] could not look for a Text Snippets backup", err);
        return;
      }
      if (backup === null) return;
    }

    const group = renderSettingGroup(root, "Text Snippets import");
    group.bodyEl.addClass("snipsy-text-snippets-section");

    let statusEl!: HTMLDivElement;
    group.addSetting((s) => {
      s.setName("Import snippets");
      s.setDesc(
        compat
          ? `Copies the snippets from the backup of the original Text Snippets file (text-snippets-backup*.json, the newest one) into the "${GROUP_SLUG}" group. The backup is not changed. Use it to recover snippets the automatic conversion did not bring over. The 500 snippet limit of imports applies here.`
          : `Copies the snippets of the Text Snippets plugin into the "${GROUP_SLUG}" group. Its own files are not changed. By default Snipsy expands a trigger as you type; turn off "Expand while typing" and turn on "Expand on Tab" in General to work the way Text Snippets did. Disable the group or turn on prefix mode if a trigger fires too often.`,
      );
      statusEl = s.controlEl.createDiv({
        cls: "snipsy-espanso-skip-status",
        attr: { "aria-live": "polite" },
      });
      statusEl.hide();
      s.addButton((b) => {
        b.setButtonText("Import").setCta();
        b.buttonEl.setAttr("aria-label", "Import snippets from the Text Snippets plugin");
        b.onClick(() => {
          void this.runImport(statusEl);
        });
      });
    });
  }

  private isCompatId(): boolean {
    return this.plugin.manifest.id === SOURCE_PLUGIN_ID;
  }

  private pluginDir(): string {
    return this.plugin.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.plugin.manifest.id}`;
  }

  /**
   * The text to import. Under `snipsidian`: the other plugin's data.json;
   * under the Text Snippets id: the newest backup of the original file.
   * `null` = not installed/never saved/no backup.
   */
  private async readSourceFile(): Promise<string | null> {
    const adapter = this.app.vault.adapter;
    if (this.isCompatId()) {
      const backup = await findLatestTextSnippetsBackup(adapter, this.pluginDir());
      return backup === null ? null : adapter.read(backup);
    }
    const path = `${this.app.vault.configDir}/plugins/${SOURCE_PLUGIN_ID}/data.json`;
    if (!(await adapter.exists(path))) return null;
    return adapter.read(path);
  }

  private async runImport(statusEl: HTMLElement): Promise<void> {
    statusEl.hide();

    let raw: string | null;
    try {
      raw = await this.readSourceFile();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      new Notice(`Could not read Text Snippets settings: ${sanitizeForNotice(message)}`);
      return;
    }
    if (raw === null) {
      new Notice(this.isCompatId() ? BACKUP_NOT_FOUND_MESSAGE : NOT_FOUND_MESSAGE);
      return;
    }

    let parsed: TextSnippetsImportResult;
    try {
      parsed = textSnippetsDataToSnippets(raw);
    } catch (err) {
      // The parser's messages can echo a slice of the file (JSON.parse
      // errors) — sanitize like every other untrusted-text Notice.
      const message = err instanceof Error ? err.message : String(err);
      new Notice(sanitizeForNotice(message));
      return;
    }

    if (Object.keys(parsed.snippets).length === 0) {
      const msg =
        parsed.skipped.length > 0
          ? `Nothing to import: ${formatTextSnippetsSummary(0, parsed)}`
          : "Nothing to import: Text Snippets has no snippets";
      statusEl.setText(msg);
      statusEl.show();
      new Notice(msg);
      return;
    }

    // S-009: validation (count/size/charset) runs inside the planner,
    // before the diff and before any write. B-184: triggers owned by
    // ANOTHER group are left out (listed as skipped), the rest proceeds.
    const plan = planGroupedImport(parsed.snippets, GROUP_SLUG, this.plugin.settings, {
      allowUnicodeLetters: true,
    });

    if (!plan.validation.isValid) {
      const first = plan.validation.errors[0] ?? "Import failed validation";
      const more =
        plan.validation.errors.length > 1
          ? ` (and ${plan.validation.errors.length - 1} more)`
          : "";
      new Notice(`Cannot import Text Snippets: ${sanitizeForNotice(`${first}${more}`)}`);
      console.error("[snipsy] Text Snippets import validation failed", plan.validation.errors);
      return;
    }

    const skippedAll = [
      ...parsed.skipped,
      ...plan.skippedCollisions.map((c) => ({ trigger: c.trigger, reason: c.reason })),
    ];
    // A trigger left out because another group owns it must not also be
    // reported as "changed" (its tab stops were never imported).
    const warningsKept = parsed.warnings.filter((w) =>
      Object.prototype.hasOwnProperty.call(plan.importable, w.trigger),
    );
    parsed = { ...parsed, skipped: skippedAll, warnings: warningsKept };
    const parsedCount = Object.keys(plan.importable).length;
    const summary = formatTextSnippetsSummary(parsedCount, parsed);
    if (parsedCount === 0) {
      // Every parsed trigger belongs to another group: nothing to write.
      const msg = `Nothing to import: ${summary}`;
      statusEl.setText(msg);
      statusEl.show();
      new Notice(msg);
      return;
    }

    // Always preview, even with zero conflicts: the user sees what will
    // land before anything is written (same as the community install).
    const modal = new PackagePreviewModal(
      this.app,
      this.plugin,
      "Import from Text Snippets",
      plan.diff,
    );
    modal.onConfirm = async (resolved) => {
      // The modal only logs a rejected onConfirm, so surface it here.
      try {
        // B-181: rolls the in-memory map back if the save rejects.
        await commitSnippets(this.plugin.settings, resolved, () => this.plugin.saveSettings());
        this.report(statusEl, countAppliedChanges(plan.diff, resolved), parsedCount, parsed);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        new Notice(`Failed to import Text Snippets: ${sanitizeForNotice(message)}`);
      }
    };
    modal.open();
    // Skipped records and warnings are visible BEFORE the user applies
    // (same injection as the Espanso flow).
    if (hasReport(parsed)) {
      const infoEl = modal.contentEl.createDiv({
        cls: "snipsy-espanso-skip-status",
        attr: { "aria-live": "polite" },
      });
      infoEl.setText(summary);
      modal.contentEl.insertBefore(infoEl, modal.contentEl.firstChild);
    }
  }

  private report(
    statusEl: HTMLElement,
    changedCount: number,
    parsedCount: number,
    parsed: TextSnippetsImportResult,
  ): void {
    const base =
      changedCount === 0
        ? `No changes: "${GROUP_SLUG}" already matches your library`
        : `Imported ${changedCount} snippet${changedCount === 1 ? "" : "s"} into "${GROUP_SLUG}"`;
    if (hasReport(parsed)) {
      const msg = formatTextSnippetsSummary(parsedCount, parsed);
      statusEl.setText(msg);
      statusEl.show();
      new Notice(`${base}. ${msg}`);
    } else {
      new Notice(base);
    }
  }
}
