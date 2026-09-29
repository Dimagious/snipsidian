import { App, Notice, Platform } from "obsidian";
import type SnipSidianPlugin from "../../main";
import type { IssueMeta } from "../../services/github-issue-url";
import { renderDefinitionGroups } from "../utils/setting-definitions";
import { createControlHost } from "../utils/settings-control-path";
import { buildAboutDefinitions, type AboutDefinitionsHandlers } from "./about-definitions";

/**
 * About tab. Renamed in spirit (the file keeps the legacy
 * `FeedbackTab` name — see SettingsTab.ts §2a). Per the 1.1.0
 * redesign, Google Forms is gone (B-008) and feedback flows through
 * GitHub issues so the project keeps a single feedback channel.
 *
 * UI redesign (2026-09): sections render as native "filled group"
 * containers via `renderSettingGroup` instead of the old bordered
 * `.snipsy-about-list` card. No "About Snipsy" page heading (B-153) —
 * the tab button already says "About", and removing it clears the
 * sentence-case scanner warning without lowercasing the product name.
 * A new "Website" row (B-048) links the live demo/docs site; version
 * footer is left-aligned with the content instead of centred.
 *
 * B-151/ADR-0007: the Feedback/Resources/More-from-the-author groups
 * are now driven by `about-definitions.ts`'s `buildAboutDefinitions()`
 * — the SAME `SettingDefinitionGroup[]` `SnipSidianSettingTab.
 * getSettingDefinitions()` returns on Obsidian 1.13+ — rendered here
 * through the `renderDefinitionGroups` adapter for < 1.13. The version
 * footer (finding #9) is the last row of that same "More from the
 * author" group (`buildVersionRow` in `about-definitions.ts`) — no
 * separate hand-rendered `.snipsy-about-version` div here any more,
 * so both render paths show it exactly once from one definition
 * instead of this file drawing it a second time only on < 1.13.
 */
export class FeedbackTab {
    constructor(
        private app: App,
        private plugin: SnipSidianPlugin,
    ) {}

    render(root: HTMLElement) {
        root.empty();

        const meta = this.collectMeta();
        const definitions = buildAboutDefinitions(meta, this.definitionHandlers());
        renderDefinitionGroups(root, definitions, createControlHost(this.plugin));
    }

    /** Exposes this tab's link-opener for `SettingsTab`'s 1.13+
     *  declarative tree (B-151/ADR-0007) — see `BasicTab.
     *  definitionHandlers()` for the same rationale. */
    definitionHandlers(): AboutDefinitionsHandlers {
        return { openLink: (href, label) => this.openLink(href, label) };
    }

    /** Exposes `collectMeta()` for `SettingsTab`'s 1.13+ declarative
     *  tree — same GitHub-issue-prefill meta `render()` computes below,
     *  just callable before this tab has rendered anything. */
    collectMetaForDefinitions(): IssueMeta {
        return this.collectMeta();
    }

    /** Shared link-opener for every button on this tab — opens a new
     *  browser tab, same pattern as `PackageSubmissionSection`'s
     *  submission-issue link. Reports a failure via Notice instead of
     *  swallowing it (CLAUDE.md §4). */
    private openLink(href: string, label: string): void {
        try {
            window.open(href, "_blank", "noopener,noreferrer");
        } catch (err) {
            new Notice(
                `Failed to open ${label}: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }

    /** Collects the platform/version meta we embed in GitHub issues so
     *  the user doesn't have to fill it out. Best-effort — any field
     *  the runtime can't supply is simply omitted. */
    private collectMeta() {
        const pluginVersion = this.plugin.manifest.version;
        const obsidianVersion = this.app.version;
        const platform = Platform.isDesktop ? "Desktop" : Platform.isMobile ? "Mobile" : undefined;
        return { pluginVersion, obsidianVersion, platform };
    }
}
