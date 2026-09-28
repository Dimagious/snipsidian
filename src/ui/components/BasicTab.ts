import { App, Notice, Platform } from "obsidian";
import type SnipSidianPlugin from "../../main";
import type { HotkeysTabHandle } from "../../types";
import { isRecordOfString } from "../../shared/guards";
import { ImportPreviewModal } from "./Modals";
import { DEFAULT_SNIPPETS_GROUP, planRestoreDefaults } from "../../store/presets";
import { joinKey } from "../../store/keys";
import { validatePackageForInstall } from "../../services/package-validator";
import { renderSettingGroup } from "../utils/setting-group";

/** B-137: default prefix char when the mode is on but the user
 *  hasn't picked one yet. Kept in sync with `plugin.ts`'s `getPrefix`
 *  fallback and `AddSnippetModal`'s hint computation. */
const DEFAULT_PREFIX_CHAR = ":";

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
 * Section order: Expansion first (it's the only real preference),
 * then Commands, Backup, Defaults — the old order put Commands first.
 *
 * All actions here are equally-weighted utilities, so no buttons
 * carry `.setCta()`. Import flow opens `ImportPreviewModal` so the
 * user can preview merge vs replace before the write (B-038).
 */
export class BasicTab {
    constructor(
        private app: App,
        private plugin: SnipSidianPlugin,
    ) {}

    render(root: HTMLElement) {
        root.empty();

        this.renderExpansionSettings(root);
        this.renderCommands(root);
        this.renderBackup(root);
        this.renderDefaults(root);
    }

    private renderCommands(root: HTMLElement) {
        const group = renderSettingGroup(root, "Commands");
        group.addSetting((s) => {
            s.setName("Insert snippet")
                .setDesc("Open the snippet picker.")
                .addButton((b) =>
                    b
                        .setButtonText("Set hotkey")
                        .onClick(() => this.openHotkeyTab("snipsidian:insert-snippet", "Insert snippet…")),
                );
        });
        group.addSetting((s) => {
            s.setName("Open settings")
                .setDesc("Jump straight to this plugin's settings.")
                .addButton((b) =>
                    b
                        .setButtonText("Set hotkey")
                        .onClick(() => this.openHotkeyTab("snipsidian:open-settings", "Open settings")),
                );
        });
    }

    private renderBackup(root: HTMLElement) {
        const group = renderSettingGroup(root, "Backup");
        group.addSetting((s) => {
            s.setName("Export snippets")
                .setDesc("Download your library as JSON.")
                .addButton((b) => b.setButtonText("Export JSON").onClick(() => void this.exportJson()));
        });
        group.addSetting((s) => {
            s.setName("Import snippets")
                .setDesc("Preview a JSON file before merge or replace.")
                .addButton((b) => b.setButtonText("Import JSON").onClick(() => this.startImport()));
        });

        // B-047: on mobile this row is skipped entirely rather than
        // rendered as a dead end that can only fail ("File manager
        // access is only available on desktop").
        if (Platform.isDesktop) {
            group.addSetting((s) => {
                s.setName("Reveal data file")
                    .setDesc("Show the data file in your file manager.")
                    .addButton((b) => b.setButtonText("Show in folder").onClick(() => this.revealDataFile()));
            });
        }
    }

    private renderDefaults(root: HTMLElement) {
        const group = renderSettingGroup(root, "Defaults");
        group.addSetting((s) => {
            s.setName("Restore default snippets")
                .setDesc(
                    "Re-add missing built-in snippets. Existing snippets are not changed.",
                )
                .addButton((b) => b.setButtonText("Restore").onClick(() => void this.restoreDefaults()));
        });
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
    }

    /**
     * B-137: opt-in trigger-prefix mode. One global toggle + a
     * prefix-char dropdown (":" or ";"), dropdown disabled while the
     * toggle is off. Scope guard per the backlog item: ONE global
     * mode, no per-snippet opt-out.
     *
     * Redesign: real `Setting` rows inside the "Expansion" group
     * (previously hand-rolled card rows, B-150, to dodge Obsidian's
     * `.setting-item` look — that's now the look we want). When the
     * toggle is off, the whole Prefix-character row dims (not just
     * the dropdown glyph), so the dependency between the two rows is
     * visible at a glance (AUDIT: "disabled state is only a faint
     * glyph").
     */
    private renderExpansionSettings(root: HTMLElement) {
        const current = this.plugin.settings.expansion ?? {};
        const requirePrefix = current.requirePrefix ?? false;
        const prefixChar = current.prefixChar ?? DEFAULT_PREFIX_CHAR;

        const group = renderSettingGroup(root, "Expansion");

        let dropdownRowEl: HTMLElement | null = null;
        let dropdownDisable: ((disabled: boolean) => void) | null = null;

        group.addSetting((s) => {
            s.setName("Require a prefix before triggers").setDesc(
                "With this on, todo stays text; :todo expands.",
            );
            s.addToggle((t) =>
                t.setValue(requirePrefix).onChange(async (value: boolean) => {
                    this.plugin.settings.expansion = {
                        ...this.plugin.settings.expansion,
                        requirePrefix: value,
                    };
                    await this.plugin.saveSettings();
                    dropdownDisable?.(!value);
                    dropdownRowEl?.toggleClass("snipsy-row-disabled", !value);
                }),
            );
        });

        group.addSetting((s) => {
            s.setName("Prefix character").setDesc(
                "Which character must come right before a trigger when the toggle above is on.",
            );
            dropdownRowEl = s.settingEl;
            dropdownRowEl.toggleClass("snipsy-row-disabled", !requirePrefix);
            s.addDropdown((d) => {
                d.addOption(":", ":")
                    .addOption(";", ";")
                    .setValue(prefixChar)
                    .setDisabled(!requirePrefix)
                    .onChange(async (value: string) => {
                        this.plugin.settings.expansion = {
                            ...this.plugin.settings.expansion,
                            prefixChar: value,
                        };
                        await this.plugin.saveSettings();
                    });
                dropdownDisable = (disabled) => {
                    d.setDisabled(disabled);
                };
            });
        });
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
                    },
                }).open();
            } catch (err) {
                new Notice(
                    `Import failed: ${err instanceof Error ? err.message : String(err)}`,
                );
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
