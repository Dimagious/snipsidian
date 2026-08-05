import { App, DropdownComponent, Notice, Platform, ToggleComponent } from "obsidian";
import type SnipSidianPlugin from "../../main";
import type { HotkeysTabHandle } from "../../types";
import { isRecordOfString } from "../../shared/guards";
import { ImportPreviewModal } from "./Modals";
import { DEFAULT_SNIPPETS_GROUP, planRestoreDefaults } from "../../store/presets";
import { joinKey } from "../../store/keys";
import { validatePackageForInstall } from "../../services/package-validator";

/** B-137: default prefix char when the mode is on but the user
 *  hasn't picked one yet. Kept in sync with `plugin.ts`'s `getPrefix`
 *  fallback and `AddSnippetModal`'s hint computation. */
const DEFAULT_PREFIX_CHAR = ":";

/**
 * General tab. Visually aligned with the About tab: one section
 * heading at the top, then UPPERCASE-style subheadings (`<h4>`) and
 * bordered-list cards for each group. Help & Resources is gone —
 * it overlapped with the About tab, which is the canonical home for
 * documentation / community links.
 *
 * All actions here are equally-weighted utilities, so no buttons
 * carry `.setCta()` (HANDOFF §2c). Import flow opens
 * `ImportPreviewModal` so the user can preview merge vs replace
 * before the write (B-038).
 */
export class BasicTab {
    constructor(
        private app: App,
        private plugin: SnipSidianPlugin,
    ) {}

    render(root: HTMLElement) {
        root.empty();
        root.createEl("h3", { text: "Snipsy settings", cls: "snipsy-tab-heading" });

        // ---- Commands ----
        root.createEl("h4", { text: "Commands", cls: "snipsy-tab-subheading" });
        const commands = root.createDiv({ cls: "snipsy-about-list" });

        this.renderRow(commands, {
            title: "Insert snippet",
            description: "Open the snippet picker.",
            buttonText: "Set hotkey",
            onClick: () => this.openHotkeyTab("snipsidian:insert-snippet", "Insert snippet…"),
        });

        this.renderRow(commands, {
            title: "Open settings",
            description: "Jump straight to Snipsy settings.",
            buttonText: "Set hotkey",
            onClick: () => this.openHotkeyTab("snipsidian:open-settings", "Open settings"),
        });

        // ---- Expansion ----
        root.createEl("h4", { text: "Expansion", cls: "snipsy-tab-subheading" });
        const expansion = root.createDiv({ cls: "snipsy-about-list" });
        this.renderExpansionSettings(expansion);

        // ---- Backup ----
        root.createEl("h4", { text: "Backup", cls: "snipsy-tab-subheading" });
        const backup = root.createDiv({ cls: "snipsy-about-list" });

        this.renderRow(backup, {
            title: "Export snippets",
            description: "Download your library as JSON.",
            buttonText: "Export JSON",
            onClick: () => void this.exportJson(),
        });

        this.renderRow(backup, {
            title: "Import snippets",
            description: "Preview a JSON file before merge or replace.",
            buttonText: "Import JSON",
            onClick: () => this.startImport(),
        });

        this.renderRow(backup, {
            title: "Reveal data file",
            description: "Open the data file in your file manager.",
            buttonText: "Reveal",
            onClick: () => this.revealDataFile(),
        });

        // ---- Defaults ----
        root.createEl("h4", { text: "Defaults", cls: "snipsy-tab-subheading" });
        const defaults = root.createDiv({ cls: "snipsy-about-list" });

        this.renderRow(defaults, {
            title: "Restore default snippets",
            description:
                "Re-add missing built-in snippets to the Defaults group. Existing snippets are not changed.",
            buttonText: "Restore",
            onClick: () => void this.restoreDefaults(),
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
     * B-150: rendered as two `.snipsy-about-row` card rows (same shell
     * as the Commands/Backup/Defaults sections via `renderRowShell`)
     * instead of raw `new Setting(container)` items — Obsidian's
     * `.setting-item` chrome made these two rows look like floating
     * blocks inside the bordered-card container. The toggle/dropdown
     * mount into the row's action slot instead of a button.
     */
    private renderExpansionSettings(container: HTMLElement) {
        const current = this.plugin.settings.expansion ?? {};
        const requirePrefix = current.requirePrefix ?? false;
        const prefixChar = current.prefixChar ?? DEFAULT_PREFIX_CHAR;

        // Build both row shells first so DOM order (toggle row, then
        // dropdown row — the mount tests index into the Expansion
        // list by position) is independent of the order the
        // components below are wired up in.
        const toggleAction = this.renderRowShell(container, {
            title: "Require a prefix before triggers",
            description: "With this on, todo stays text; :todo expands.",
        });
        const dropdownAction = this.renderRowShell(container, {
            title: "Prefix character",
            description:
                "Which character must come right before a trigger when the toggle above is on.",
        });

        const dropdown = new DropdownComponent(dropdownAction)
            .addOption(":", ":")
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

        new ToggleComponent(toggleAction).setValue(requirePrefix).onChange(
            async (value: boolean) => {
                this.plugin.settings.expansion = {
                    ...this.plugin.settings.expansion,
                    requirePrefix: value,
                };
                await this.plugin.saveSettings();
                dropdown.setDisabled(!value);
            },
        );
    }

    /**
     * Shared card-row shell: a `.snipsy-about-row` with title/desc text
     * on the left and an action slot on the right. `renderRow` fills
     * the slot with a button; `renderExpansionSettings` mounts a real
     * `ToggleComponent`/`DropdownComponent` there instead (B-150).
     */
    private renderRowShell(
        parent: HTMLElement,
        opts: { title: string; description: string },
    ): HTMLElement {
        const row = parent.createDiv({ cls: "snipsy-about-row" });
        const text = row.createDiv({ cls: "snipsy-about-text" });
        text.createDiv({ cls: "snipsy-about-row-title", text: opts.title });
        text.createDiv({ cls: "snipsy-about-row-desc", text: opts.description });
        return row.createDiv({ cls: "snipsy-about-row-action-slot" });
    }

    private renderRow(
        parent: HTMLElement,
        opts: {
            title: string;
            description: string;
            buttonText: string;
            onClick: () => void;
        },
    ) {
        const action = this.renderRowShell(parent, opts);
        const btn = action.createEl("button", {
            cls: "snipsy-about-row-action",
            text: opts.buttonText,
            attr: { type: "button", "aria-label": `${opts.buttonText}: ${opts.title}` },
        });
        btn.addEventListener("click", opts.onClick);
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

    private revealDataFile() {
        try {
            if (Platform.isDesktop) {
                const adapter = this.app.vault.adapter as { getBasePath?: () => string };
                if (typeof adapter.getBasePath !== "function") {
                    throw new Error("Not supported on this platform");
                }
                const base: string = adapter.getBasePath();
                const configDir: string = this.app.vault.configDir;
                const path = `${base}/${configDir}/plugins/snipsidian/data.json`;
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
            } else {
                new Notice("File manager access is only available on desktop");
            }
        } catch (err) {
            new Notice(
                `Failed to reveal file: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }
}
