import { App, Notice, Platform } from "obsidian";
import type SnipSidianPlugin from "../../main";
import { buildIssueUrl } from "../../services/github-issue-url";
import { renderSettingGroup } from "../utils/setting-group";

const WEBSITE_URL = "https://dimagious.github.io/snipsidian/";
const DASHY_SITE_URL = "https://dimagious.github.io/dashsidian/";
const DASHY_OBSIDIAN_URL = "obsidian://show-plugin?id=dashsidian";

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
 */
export class FeedbackTab {
    constructor(
        private app: App,
        private plugin: SnipSidianPlugin,
    ) {}

    render(root: HTMLElement) {
        root.empty();

        const meta = this.collectMeta();

        // ---- Feedback ----
        const feedback = renderSettingGroup(root, "Feedback");
        feedback.addSetting((s) => {
            s.setName("Report a bug")
                .setDesc("File a bug report on GitHub. Includes plugin and Obsidian versions.")
                .addButton((b) =>
                    b
                        .setButtonText("Open issue")
                        .onClick(() => this.openLink(buildIssueUrl({ kind: "bug", meta }), "Report a bug")),
                );
        });
        feedback.addSetting((s) => {
            s.setName("Suggest a feature")
                .setDesc("Propose new functionality or improvements.")
                .addButton((b) =>
                    b
                        .setButtonText("Open issue")
                        .onClick(() =>
                            this.openLink(buildIssueUrl({ kind: "feature", meta }), "Suggest a feature"),
                        ),
                );
        });
        feedback.addSetting((s) => {
            s.setName("General feedback")
                .setDesc("Share your overall experience or get in touch.")
                .addButton((b) =>
                    b
                        .setButtonText("Open issue")
                        .onClick(() =>
                            this.openLink(buildIssueUrl({ kind: "feedback", meta }), "General feedback"),
                        ),
                );
        });

        // ---- Resources ----
        const resources = renderSettingGroup(root, "Resources");
        // B-048: "Website" is the first Resources row — links the live
        // demo/screenshots/docs site. Nothing in the plugin pointed at
        // the website before this.
        resources.addSetting((s) => {
            s.setName("Website")
                .setDesc("Live demo, screenshots and docs.")
                .addButton((b) =>
                    b.setButtonText("Open").onClick(() => this.openLink(WEBSITE_URL, "Website")),
                );
        });
        resources.addSetting((s) => {
            s.setName("Documentation")
                .setDesc("Read the docs and examples on GitHub.")
                .addButton((b) =>
                    b
                        .setButtonText("Open")
                        .onClick(() =>
                            this.openLink(
                                "https://github.com/Dimagious/snipsidian#readme",
                                "Documentation",
                            ),
                        ),
                );
        });
        resources.addSetting((s) => {
            s.setName("GitHub issues")
                .setDesc("Browse open and closed issues.")
                .addButton((b) =>
                    b
                        .setButtonText("Open")
                        .onClick(() =>
                            this.openLink(
                                "https://github.com/Dimagious/snipsidian/issues",
                                "GitHub issues",
                            ),
                        ),
                );
        });
        resources.addSetting((s) => {
            s.setName("Obsidian community")
                .setDesc("Get help from other Obsidian users in the forum.")
                .addButton((b) =>
                    b
                        .setButtonText("Open")
                        .onClick(() =>
                            this.openLink("https://forum.obsidian.md/", "Obsidian community"),
                        ),
                );
        });

        // ---- More from the author ----
        // Owner ask (not in the mockups): a tasteful, same-weight row
        // promoting Dashy, the author's other plugin — one line of
        // description, a primary action opening it in Obsidian's
        // community plugin browser, and a link to its site. No accent
        // banner — same row style as everything else in About.
        const author = renderSettingGroup(root, "More from the author");
        author.addSetting((s) => {
            s.setName("Dashy")
                .setDesc(
                    "A dashboard inside a note, built from Markdown blocks. No code needed.",
                )
                .addButton((b) =>
                    b
                        .setButtonText("Open in Obsidian")
                        .onClick(() => this.openLink(DASHY_OBSIDIAN_URL, "Dashy (community plugin browser)")),
                )
                .addButton((b) =>
                    b.setButtonText("Website").onClick(() => this.openLink(DASHY_SITE_URL, "Dashy website")),
                );
        });

        // ---- Version footer ----
        root.createDiv({ cls: "snipsy-about-version" }, (el) => {
            el.createSpan({ text: `Snipsy ${this.plugin.manifest.version}` });
            if (meta.obsidianVersion) {
                el.createSpan({ text: ` · Obsidian ${meta.obsidianVersion}` });
            }
            if (meta.platform) {
                el.createSpan({ text: ` · ${meta.platform}` });
            }
        });
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
