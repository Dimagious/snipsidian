import { App, Notice, Platform } from "obsidian";
import type SnipSidianPlugin from "../../main";
import { buildIssueUrl } from "../../services/github-issue-url";

/**
 * About tab. Renamed in spirit (the file keeps the legacy
 * `FeedbackTab` name — see SettingsTab.ts §2a). Per the 1.1.0
 * redesign, Google Forms is gone (B-008) and feedback flows through
 * GitHub issues so the project keeps a single feedback channel.
 *
 * Layout is a plain list of rows — one icon-less row per resource.
 * No CTAs; everything here is equally-weighted.
 */
export class FeedbackTab {
    constructor(
        private app: App,
        private plugin: SnipSidianPlugin,
    ) {}

    render(root: HTMLElement) {
        root.empty();
        root.createEl("h3", { text: "About Snipsy", cls: "snipsy-tab-heading" });

        const meta = this.collectMeta();

        // ---- Feedback ----
        root.createEl("h4", { text: "Feedback", cls: "snipsy-tab-subheading" });
        const feedbackList = root.createDiv({ cls: "snipsy-about-list" });

        this.renderAboutRow(feedbackList, {
            title: "Report a bug",
            description: "File a bug report on GitHub. Includes plugin and Obsidian versions.",
            buttonText: "Open issue",
            href: buildIssueUrl({ kind: "bug", meta }),
        });

        this.renderAboutRow(feedbackList, {
            title: "Suggest a feature",
            description: "Propose new functionality or improvements.",
            buttonText: "Open issue",
            href: buildIssueUrl({ kind: "feature", meta }),
        });

        this.renderAboutRow(feedbackList, {
            title: "General feedback",
            description: "Share your overall experience or get in touch.",
            buttonText: "Open issue",
            href: buildIssueUrl({ kind: "feedback", meta }),
        });

        // ---- Resources ----
        root.createEl("h4", { text: "Resources", cls: "snipsy-tab-subheading" });
        const resourceList = root.createDiv({ cls: "snipsy-about-list" });

        this.renderAboutRow(resourceList, {
            title: "Documentation",
            description: "Read the docs and examples on GitHub.",
            buttonText: "Open",
            href: "https://github.com/Dimagious/snipsidian#readme",
        });

        this.renderAboutRow(resourceList, {
            title: "GitHub issues",
            description: "Browse open and closed issues.",
            buttonText: "Open",
            href: "https://github.com/Dimagious/snipsidian/issues",
        });

        this.renderAboutRow(resourceList, {
            title: "Obsidian community",
            description: "Get help from other Obsidian users in the forum.",
            buttonText: "Open",
            // Pure obfuscation pattern kept from the legacy tab — keeps
            // bots from auto-pinging the forum from compiled bundles.
            href: `https://${["forum", "obsidian", "md"].join(".")}/`,
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

    private renderAboutRow(
        parent: HTMLElement,
        opts: { title: string; description: string; buttonText: string; href: string },
    ) {
        const row = parent.createDiv({ cls: "snipsy-about-row" });

        const text = row.createDiv({ cls: "snipsy-about-text" });
        text.createDiv({ cls: "snipsy-about-row-title", text: opts.title });
        text.createDiv({ cls: "snipsy-about-row-desc", text: opts.description });

        const btn = row.createEl("button", {
            cls: "snipsy-about-row-action",
            text: opts.buttonText,
            attr: { type: "button", "aria-label": `${opts.buttonText}: ${opts.title}` },
        });
        btn.addEventListener("click", () => {
            try {
                window.open(opts.href, "_blank", "noopener,noreferrer");
            } catch (err) {
                new Notice(
                    `Failed to open link: ${err instanceof Error ? err.message : String(err)}`,
                );
            }
        });
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
