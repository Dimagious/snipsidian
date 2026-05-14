/**
 * Build prefilled GitHub issue URLs. Replaces the Google Forms
 * dependency (B-008) — both feedback and package submission now go
 * through GitHub directly, which simplifies the privacy story (no
 * third-party form vendor) and keeps the feedback loop inside the
 * project's own issue tracker.
 *
 * GitHub natively supports `?title=` and `?body=` query parameters
 * on `/issues/new`, so we don't need an issue template file.
 */

const REPO_BASE = "https://github.com/Dimagious/snipsidian";

export interface IssueMeta {
    pluginVersion?: string;
    obsidianVersion?: string;
    platform?: string;
}

export type IssueKind = "bug" | "feature" | "feedback" | "package";

/** Render a meta block of `key: value` lines for the issue body. Empty
 *  values are skipped so the user doesn't see "Platform: ". */
function renderMeta(meta?: IssueMeta): string {
    if (!meta) return "";
    const lines: string[] = [];
    if (meta.pluginVersion) lines.push(`- Snipsy: ${meta.pluginVersion}`);
    if (meta.obsidianVersion) lines.push(`- Obsidian: ${meta.obsidianVersion}`);
    if (meta.platform) lines.push(`- Platform: ${meta.platform}`);
    return lines.length > 0 ? `\n\n---\n${lines.join("\n")}` : "";
}

/** Body templates for each issue kind. Kept short — the user is the
 *  one filling them out; a wall of prompts is friction. */
const TEMPLATES: Record<IssueKind, { titlePrefix: string; body: string }> = {
    bug: {
        titlePrefix: "[Bug] ",
        body:
            "**What happened?**\n\n\n" +
            "**What did you expect to happen?**\n\n\n" +
            "**Steps to reproduce**\n\n1. \n2. \n3. \n",
    },
    feature: {
        titlePrefix: "[Feature] ",
        body:
            "**What problem does this solve?**\n\n\n" +
            "**Proposed solution**\n\n\n" +
            "**Alternatives considered**\n\n",
    },
    feedback: {
        titlePrefix: "[Feedback] ",
        body: "**Your feedback**\n\n",
    },
    package: {
        titlePrefix: "[Package] ",
        body:
            "**Package name**\n\n\n" +
            "**Description**\n\n\n" +
            "**YAML**\n\n```yaml\n\n```\n",
    },
};

/** Builds a `/issues/new` URL with prefilled title + body. URL-encodes
 *  both components — GitHub respects `+` for spaces in title but `%20`
 *  is universally safe so we use `encodeURIComponent`. */
export function buildIssueUrl(opts: {
    kind: IssueKind;
    title?: string;
    body?: string;
    meta?: IssueMeta;
}): string {
    const tpl = TEMPLATES[opts.kind];
    const finalTitle = `${tpl.titlePrefix}${opts.title ?? ""}`.trim();
    const finalBody = `${opts.body ?? tpl.body}${renderMeta(opts.meta)}`;

    const params = new URLSearchParams();
    if (finalTitle) params.set("title", finalTitle);
    if (finalBody) params.set("body", finalBody);

    return `${REPO_BASE}/issues/new?${params.toString()}`;
}

/** Builds the URL for submitting a community package. The YAML is
 *  embedded in a fenced code block so reviewers can copy-paste it
 *  straight into the catalog repo. */
export function buildPackageSubmissionUrl(opts: {
    packageName: string;
    yaml: string;
    meta?: IssueMeta;
}): string {
    const body =
        `**Package name**\n${opts.packageName}\n\n` +
        `**YAML**\n\n\`\`\`yaml\n${opts.yaml.trim()}\n\`\`\`\n`;
    return buildIssueUrl({
        kind: "package",
        title: opts.packageName,
        body,
        meta: opts.meta,
    });
}
