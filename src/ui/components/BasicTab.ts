import { App, Notice, Platform } from "obsidian";
import type SnipSidianPlugin from "../../main";
import type { HotkeysTabHandle } from "../../types";
import { isRecordOfString } from "../../shared/guards";
import { ImportPreviewModal } from "./Modals";
import { DEFAULT_SNIPPETS_GROUP, planRestoreDefaults } from "../../store/presets";
import { joinKey } from "../../store/keys";
import { validatePackageForInstall } from "../../services/package-validator";
import { sanitizeForNotice } from "../../shared/notice-text";
import { renderDefinitionGroups } from "../utils/setting-definitions";
import { createControlHost } from "../utils/settings-control-path";
import { buildGeneralDefinitions, type GeneralDefinitionsHandlers } from "./general-definitions";

/**
 * General tab. UI redesign (2026-09): sections render as native
 * "filled group" containers via `renderSettingGroup` — a sentence-case
 * heading over a `--background-primary-alt` group of `Setting` rows,
 * the same look Obsidian's own Editor/Hotkeys pages use, replacing the
 * old bordered-card + uppercase-subheading shell (AUDIT X1/X2). No
 * page heading above the first group (AUDIT X3) — the tab button
 * already says "General", and the tabpanel carries
 * `aria-labelledby` (SettingsTab.ts).
 *
 * B-151/ADR-0007: content is now driven by `general-definitions.ts`'s
 * `buildGeneralDefinitions()` — the SAME `SettingDefinitionGroup[]`
 * `SnipSidianSettingTab.getSettingDefinitions()` returns on Obsidian
 * 1.13+ — rendered here through the `renderDefinitionGroups` adapter
 * (`setting-definitions.ts`) for < 1.13. Section order (Expansion
 * first — it's the only real preference — then Commands, Backup,
 * Defaults) and every row's wording are unchanged from before this
 * refactor; only the "one row, two buttons" shape doesn't exist here
 * (General has none), so `BasicTab` itself now only owns the action
 * handlers, not the row markup.
 *
 * All actions here are equally-weighted utilities, so no buttons
 * carry `.setCta()`. Import flow opens `ImportPreviewModal` so the
 * user can preview merge vs replace before the write (B-038).
 *
 * Finding #2: `onDeclarativeChange`, when given, is called after a
 * write that changes the snippet/group counts the declarative
 * Snippets page entry's `displayValue` shows (Restore defaults,
 * Import confirm) — those are the only General-tab actions that
 * mutate `settings.snippets` while the tab ROOT stays visible (a
 * write made from inside the Snippets/Packages page itself doesn't
 * need this: the spike found the tab root already re-renders, and
 * re-evaluates `displayValue`, on navigating back out of a page).
 * `SnipSidianSettingTab` wires this to its own `refreshDeclarative()`
 * (`this.update()`, guarded to 1.13+) — a plain callback here, so
 * `BasicTab` itself stays free of any `requireApiVersion` branching.
 */
export class BasicTab {
    constructor(
        private app: App,
        private plugin: SnipSidianPlugin,
        private onDeclarativeChange?: () => void,
    ) {}

    render(root: HTMLElement) {
        root.empty();

        const definitions = buildGeneralDefinitions(this.plugin, this.definitionHandlers());
        renderDefinitionGroups(root, definitions, createControlHost(this.plugin));
    }

    /** Exposes this tab's action-row callbacks for `SettingsTab`'s
     *  1.13+ declarative tree (B-151/ADR-0007) — the SAME handlers
     *  `render()` feeds into `buildGeneralDefinitions()` for the
     *  pre-1.13 adapter path above, so each action's behaviour is
     *  defined in exactly one place regardless of which render path
     *  ends up calling it. */
    definitionHandlers(): GeneralDefinitionsHandlers {
        return {
            setHotkey: (commandId, commandName) => this.openHotkeyTab(commandId, commandName),
            exportJson: () => this.exportJson(),
            startImport: () => this.startImport(),
            revealDataFile: () => this.revealDataFile(),
            restoreDefaults: () => this.restoreDefaults(),
        };
    }

    /** B-131: bring back shipped defaults the user previously deleted.
     *  Additive only — `planRestoreDefaults` skips any trigger name that
     *  already exists in any group, so nothing is overwritten and no
     *  `getDict` collisions are introduced. Gated through
     *  `validatePackageForInstall` like every other write path into
     *  `settings.snippets`. */
    private async restoreDefaults() {
        const plan = planRestoreDefaults(this.plugin.settings.snippets);
        const count = Object.keys(plan).length;
        if (count === 0) {
            new Notice("All default snippets are already in your library");
            return;
        }

        const v = validatePackageForInstall({ label: "Defaults", snippets: plan });
        if (!v.isValid) {
            new Notice(`Cannot restore defaults: ${v.errors.join("; ")}`);
            return;
        }

        for (const [trigger, replacement] of Object.entries(plan)) {
            this.plugin.settings.snippets[joinKey(DEFAULT_SNIPPETS_GROUP, trigger)] = replacement;
        }
        await this.plugin.saveSettings();
        new Notice(`Restored ${count} default snippet${count === 1 ? "" : "s"}`);
        this.onDeclarativeChange?.();
    }

    /**
     * Opens the Hotkeys tab and, per the established community
     * pattern, prefills its search box with the command's display
     * name so the user lands on an already-filtered list instead of
     * scroll-hunting through every command in the vault. The search
     * box is undocumented internal API — typed via `HotkeysTabHandle`
     * in `src/types.ts` and feature-detected in
     * `applyHotkeySearchQuery` rather than force-cast — so the
     * scroll-into-view stays as a best-effort fallback regardless of
     * whether the search prefill worked.
     */
    private openHotkeyTab(commandId: string, commandName: string) {
        this.app.setting.open();
        const tab = this.app.setting.openTabById("hotkeys");
        this.applyHotkeySearchQuery(tab, commandName);
        window.setTimeout(() => {
            const hotkeyTab = activeDocument.querySelector(
                `.setting-item[data-id="${commandId}"]`,
            );
            if (hotkeyTab) {
                hotkeyTab.scrollIntoView({ behavior: "smooth", block: "center" });
            }
        }, 100);
    }

    /** Best-effort: filters the Hotkeys pane via its internal
     *  (undocumented) search box. Tries `setQuery` first, then the
     *  raw `searchComponent`; no-ops silently if neither shape is
     *  present so a future Obsidian internals change never throws —
     *  the caller's scroll-into-view fallback still runs either way. */
    private applyHotkeySearchQuery(tab: HotkeysTabHandle | undefined, query: string): void {
        if (!tab) return;
        if (typeof tab.setQuery === "function") {
            tab.setQuery(query);
            return;
        }
        const search = tab.searchComponent;
        if (search && typeof search.setValue === "function") {
            search.setValue(query);
            search.onChanged?.();
        }
    }

    /**
     * B-144: `<a download>` blob-anchor is a silent no-op in iOS
     * WKWebView (and other mobile WebViews) — no error, no Notice,
     * nothing happens; the settings UI promises a backup path mobile
     * users can't actually use. Desktop keeps the anchor-download
     * path unchanged; mobile writes the export into the vault instead.
     */
    private async exportJson() {
        const data = JSON.stringify(this.plugin.settings.snippets, null, 2);

        if (!Platform.isDesktop) {
            await this.exportJsonToVaultOrClipboard(data);
            return;
        }

        const blob = new Blob([data], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = createEl("a");
        a.href = url;
        a.download = "snipsidian-snippets.json";
        a.click();
        URL.revokeObjectURL(url);
    }

    /** Mobile export path. Tries the plain filename first; a name
     *  collision (or any other `vault.create` failure) retries once
     *  with a timestamp appended. If both attempts fail, falls back
     *  to the system clipboard so the user still gets *something*,
     *  with an honest Notice either way. */
    private async exportJsonToVaultOrClipboard(data: string) {
        const base = "snipsidian-snippets.json";
        if (await this.tryCreateExportFile(base, data)) return;

        const timestamped = `snipsidian-snippets-${Date.now()}.json`;
        if (await this.tryCreateExportFile(timestamped, data)) return;

        try {
            if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
                throw new Error("Clipboard API not available");
            }
            await navigator.clipboard.writeText(data);
            new Notice("Export copied to clipboard");
        } catch (err) {
            new Notice(
                `Export failed: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }

    /** Returns `true` on success (and fires the success Notice);
     *  `false` on failure so the caller can retry/fall back. */
    private async tryCreateExportFile(filename: string, data: string): Promise<boolean> {
        try {
            await this.app.vault.create(filename, data);
            new Notice(`Exported to ${filename} in your vault`);
            return true;
        } catch (err) {
            console.error("[snipsy] failed to export to vault", filename, err);
            return false;
        }
    }

    private startImport() {
        const input = createEl("input");
        input.type = "file";
        input.accept = ".json";
        input.onchange = async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;

            try {
                const text = await file.text();
                const parsed: unknown = JSON.parse(text);
                if (!isRecordOfString(parsed)) {
                    new Notice(
                        "Invalid JSON: must be an object of { trigger: replacement } strings",
                    );
                    return;
                }

                new ImportPreviewModal(this.app, {
                    current: this.plugin.settings.snippets,
                    incoming: parsed,
                    onConfirm: async (mode) => {
                        this.plugin.settings.snippets =
                            mode === "replace"
                                ? parsed
                                : { ...this.plugin.settings.snippets, ...parsed };
                        await this.plugin.saveSettings();
                        const count = Object.keys(parsed).length;
                        new Notice(
                            mode === "replace"
                                ? `Replaced library with ${count} snippet${count === 1 ? "" : "s"}`
                                : `Merged ${count} snippet${count === 1 ? "" : "s"}`,
                        );
                        this.onDeclarativeChange?.();
                    },
                }).open();
            } catch (err) {
                // B-034: `JSON.parse` can echo a slice of the pasted
                // file's own (untrusted) text into its error message —
                // strip control characters and cap the length before
                // it reaches the Notice.
                const message = err instanceof Error ? err.message : String(err);
                new Notice(`Import failed: ${sanitizeForNotice(message)}`);
            }
        };
        input.click();
    }

    /** B-047: on failure, tells the user what actually happened
     *  ("Electron shell not available" was internals jargon) and, when
     *  the path was successfully computed, shows it with a Copy path
     *  action — so the user can still get to the file manually. The
     *  underlying error still goes to the console with context
     *  (CLAUDE.md §4: never swallow errors). This row only renders on
     *  desktop (`renderBackup` above), but the method stays defensive
     *  about `Platform.isDesktop` in case it's ever reached another
     *  way (e.g. a stale reference held across a platform change). */
    private revealDataFile() {
        if (!Platform.isDesktop) {
            new Notice("File manager access is only available on desktop");
            return;
        }
        let path: string | undefined;
        try {
            const adapter = this.app.vault.adapter as { getBasePath?: () => string };
            if (typeof adapter.getBasePath !== "function") {
                throw new Error("Not supported on this platform");
            }
            const base: string = adapter.getBasePath();
            const configDir: string = this.app.vault.configDir;
            path = `${base}/${configDir}/plugins/snipsidian/data.json`;
            const electron = (
                window as {
                    require?: (m: string) => {
                        shell?: { showItemInFolder?: (p: string) => void };
                    };
                }
            ).require?.("electron");
            if (!electron?.shell?.showItemInFolder) {
                throw new Error("Electron shell not available");
            }
            electron.shell.showItemInFolder(path);
        } catch (err) {
            console.error("[snipsy] failed to reveal data file", err);
            this.showRevealFailureNotice(path);
        }
    }

    /** Builds the B-047 failure notice: plain-language message, plus
     *  the computed path (when we got far enough to have one) and a
     *  Copy path button, so a failed file-manager launch still leaves
     *  the user with something actionable. */
    private showRevealFailureNotice(path: string | undefined): void {
        // `Notice`'s message type is `string | DocumentFragment`.
        // Obsidian's own `DocumentFragment` augment (obsidian.d.ts)
        // extends `Node`, and `Node` is where `createEl`/`createDiv`/
        // `createSpan` live — so a fragment built via the global
        // `createFragment()` gets the same helpers `HTMLElement` does,
        // no bare `document.*`/`createElement` needed.
        const frag = createFragment((el) => {
            el.createEl("b", { text: "Could not open the file manager." });
            if (path) {
                el.createEl("br");
                el.appendText("Data file: ");
                el.createEl("code", { text: path });
                const row = el.createDiv({ cls: "snipsy-notice-row" });
                const copyBtn = row.createEl("button", {
                    text: "Copy path",
                    attr: { type: "button" },
                });
                copyBtn.addEventListener("click", () => {
                    void navigator.clipboard?.writeText(path).then(
                        () => new Notice("Path copied"),
                        (err: unknown) => {
                            console.error("[snipsy] failed to copy data file path", err);
                            new Notice("Could not copy the path");
                        },
                    );
                });
            }
        });
        new Notice(frag, 0);
    }
}
