import { Notice, type Plugin } from "obsidian";
import { AddSnippetModal, type SnippetOpResult } from "./Modals";
import { applyAddSnippet } from "../../core/snippet-ops";
import { splitKey } from "../../store/keys";
import type { SnipSidianSettings } from "../../types";

/** The slice of the plugin this flow needs. */
interface SettingsHost extends Plugin {
    settings: SnipSidianSettings;
    saveSettings(): Promise<void>;
}

/**
 * B-175: open the Add-snippet modal with the replacement prefilled from
 * the editor selection (kept verbatim, newlines and `$` included). Saving
 * goes through `applyAddSnippet` — the same validation + write path as
 * the Settings "Add snippet" button.
 */
export function openAddSnippetFromSelection(plugin: SettingsHost, selection: string): void {
    const modal = new AddSnippetModal(
        plugin.app,
        async (snippet): Promise<SnippetOpResult> => {
            const plan = applyAddSnippet(snippet, plugin.settings);
            if (!plan.ok) return { ok: false, error: plan.reason };
            await plugin.saveSettings();
            new Notice(`Snippet "${splitKey(plan.data.key).name}" added`);
            return { ok: true };
        },
        plugin.settings.expansion,
        selection,
    );
    modal.open();
}
