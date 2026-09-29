import type { SettingDefinitionEmpty, SettingDefinitionGroup, SettingDefinitionRender } from "obsidian";
import { buildIssueUrl, type IssueMeta } from "../../services/github-issue-url";
import type { SnipsyActionDef } from "../utils/setting-definitions";

const WEBSITE_URL = "https://dimagious.github.io/snipsidian/";
const DASHY_SITE_URL = "https://dimagious.github.io/dashsidian/";
const DASHY_OBSIDIAN_URL = "obsidian://show-plugin?id=dashsidian";

export interface AboutDefinitionsHandlers {
    openLink(href: string, label: string): void;
}

/**
 * Builds the About tab's content as a `SettingDefinitionGroup[]` —
 * single source of truth for both render paths (B-151/ADR-0007), same
 * as `general-definitions.ts`. `FeedbackTab.render()` feeds this
 * through `renderDefinitionGroups` below 1.13; `SnipSidianSettingTab.
 * getSettingDefinitions()` returns it directly on 1.13+. The version
 * footer is the last row of "More from the author" (finding #9) — a
 * plain `SettingDefinitionEmpty` row (`buildVersionRow` below), so
 * both paths show it exactly once from the one definition, instead of
 * `FeedbackTab` hand-rendering a separate `.snipsy-about-version` div
 * only on the pre-1.13 path (which would now double it there).
 *
 * Search coverage (B-151 target behaviour): the Snippets/Packages
 * `page` entries are only searchable by their own name (spike report,
 * Q2) — no `aliases` field exists on `SettingDefinitionPage`. An
 * earlier draft added a fake "Espanso hub" Resources row purely to
 * carry "espanso"/"import"/"package"/"catalog" aliases — rejected
 * (finding #5): it duplicated the Packages page entry and read as a
 * decoy search target rather than a row anyone would click for its
 * own sake. "import" already has an honest home on General's "Import
 * snippets" row (`general-definitions.ts`); "espanso"/"catalog" have
 * no honest row to sit on today and are simply not searchable outside
 * the "Packages" page-entry name itself — a disclosed, low-cost gap,
 * not a fabricated fix.
 *
 * Each group's `items` array is its own unannotated `const` (not
 * nested inline inside the group's object literal) for the same
 * excess-property-freshness reason documented in
 * `general-definitions.ts` — `SnipsyActionDef`'s adapter-only
 * `buttonText` field gets rejected if the array literal is checked
 * against the outer `SettingDefinitionGroup` annotation directly.
 */
export function buildAboutDefinitions(
    meta: IssueMeta,
    handlers: AboutDefinitionsHandlers,
): SettingDefinitionGroup[] {
    const feedbackItems = [
        {
            name: "Report a bug",
            desc: "File a bug report on GitHub. Includes plugin and Obsidian versions.",
            buttonText: "Open issue",
            action: () => handlers.openLink(buildIssueUrl({ kind: "bug", meta }), "Report a bug"),
        } satisfies SnipsyActionDef,
        {
            name: "Suggest a feature",
            desc: "Propose new functionality or improvements.",
            buttonText: "Open issue",
            action: () =>
                handlers.openLink(buildIssueUrl({ kind: "feature", meta }), "Suggest a feature"),
        } satisfies SnipsyActionDef,
        {
            // Finding #4: an `action` row renders as accent link text
            // with no button on 1.13+ (spike report, Q2) — the name
            // alone has to say what clicking does. "General feedback"
            // read as a category label, not something to click.
            name: "Send general feedback",
            desc: "Share your overall experience or get in touch.",
            buttonText: "Open issue",
            action: () =>
                handlers.openLink(buildIssueUrl({ kind: "feedback", meta }), "Send general feedback"),
        } satisfies SnipsyActionDef,
    ];

    const resourcesItems = [
        {
            name: "Website",
            desc: "Live demo, screenshots and docs.",
            buttonText: "Open",
            action: () => handlers.openLink(WEBSITE_URL, "Website"),
        } satisfies SnipsyActionDef,
        {
            name: "Documentation",
            desc: "Read the docs and examples on GitHub.",
            buttonText: "Open",
            action: () =>
                handlers.openLink("https://github.com/Dimagious/snipsidian#readme", "Documentation"),
        } satisfies SnipsyActionDef,
        {
            name: "GitHub issues",
            desc: "Browse open and closed issues.",
            buttonText: "Open",
            action: () =>
                handlers.openLink("https://github.com/Dimagious/snipsidian/issues", "GitHub issues"),
        } satisfies SnipsyActionDef,
        {
            name: "Obsidian community",
            desc: "Get help from other Obsidian users in the forum.",
            buttonText: "Open",
            action: () => handlers.openLink("https://forum.obsidian.md/", "Obsidian community"),
        } satisfies SnipsyActionDef,
    ];

    // Owner ask (not in the mockups): a tasteful, same-weight row
    // promoting Dashy, the author's other plugin — one line of
    // description, a primary action into Obsidian's community plugin
    // browser, and a link to its site. Two buttons on one row is
    // beyond what a single-callback `action` definition can express,
    // so this is a `render` row (Obsidian's own escape hatch for
    // exactly this case) instead — both render paths still build it
    // from this one definition.
    const authorItems = [
        {
            name: "Dashy",
            desc: "A dashboard inside a note, built from Markdown blocks. No code needed.",
            render: (setting) => {
                setting
                    .addButton((b) =>
                        b
                            .setButtonText("Open in Obsidian")
                            .onClick(() =>
                                handlers.openLink(DASHY_OBSIDIAN_URL, "Dashy (community plugin browser)"),
                            ),
                    )
                    .addButton((b) =>
                        b
                            .setButtonText("Website")
                            .onClick(() => handlers.openLink(DASHY_SITE_URL, "Dashy website")),
                    );
            },
        } satisfies SettingDefinitionRender,
        buildVersionRow(meta),
    ];

    return [
        { type: "group", heading: "Feedback", items: feedbackItems },
        { type: "group", heading: "Resources", items: resourcesItems },
        { type: "group", heading: "More from the author", items: authorItems },
    ];
}

/**
 * Finding #9: the version footer, restored as a plain
 * `SettingDefinitionEmpty` row — same "Snipsy X.Y.Z · Obsidian
 * <version> · <platform>" text the pre-1.13 `.snipsy-about-version`
 * div used to build from three separate spans, now one `desc` string.
 * `searchable: false` because a version string is noise in search
 * results, not something a user searches for by name.
 */
function buildVersionRow(meta: IssueMeta): SettingDefinitionEmpty {
    const parts = [`Snipsy ${meta.pluginVersion ?? "?"}`];
    if (meta.obsidianVersion) parts.push(`Obsidian ${meta.obsidianVersion}`);
    if (meta.platform) parts.push(meta.platform);
    return {
        name: "Version",
        desc: parts.join(" · "),
        searchable: false,
    };
}
