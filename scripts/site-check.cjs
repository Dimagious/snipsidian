#!/usr/bin/env node
/**
 * Checks the GitHub Pages site in `site/` before it deploys. Node, no
 * dependencies: the CI job that runs this has nothing installed yet beyond
 * `npm ci` for the plugin itself, and this script does not need any of that.
 *
 * Checked, all against `site/index.html` unless noted:
 *   - every `img/...` reference (src, srcset, or an absolute og/twitter image
 *     URL) resolves to a file that exists directly under `site/img/` — no
 *     rename mapping, no `docs/screens/` indirection; Snipsy's screenshots
 *     are checked into `site/img/` as-is
 *   - every `#anchor` link targets an `id` that exists on the page
 *   - every other relative link (assets/..., not an anchor, not a full URL)
 *     points at a file that exists under `site/`
 *   - no path contains `.claude` anywhere on the page (nothing is
 *     allow-listed: this repo has no legitimate `.claude` mention to publish)
 *   - no em dash or en dash in the page's visible text (tags, scripts and
 *     styles stripped first; a dash inside a `<code>` sample or a CSS
 *     `content:` bullet is out of scope for this check and reviewed by hand)
 *   - `sitemap.xml`, `robots.txt` and `llms.txt` exist next to `index.html`
 *   - the canonical link and the `og:url` meta tag both match the deployed
 *     URL
 *   - `{{version}}` and `{{minAppVersion}}` placeholders are present, and no
 *     literal x.y.z version string sits next to the version label instead
 *     (the page never hand-writes a version; `scripts/assemble-site.cjs`
 *     fills the placeholders in from `manifest.json` at deploy time)
 *   - no request to a third-party origin: a `<link>` that fetches something
 *     (stylesheet, icon, preconnect, ...), a `<script src>`, an `<img src>`/
 *     `srcset`, or a CSS `url(...)` pointing at an absolute `http(s)://` URL
 *     (an `<a href>` is a link, not a request, and stays exempt; fonts are
 *     self-hosted under `site/assets/fonts/` for exactly this reason)
 *
 * The functions above `main()` take plain strings, sets and maps, not the
 * filesystem, so they run the same way from the CI step and from
 * `src/test/site-check.test.ts`, on fixtures without a repo on disk.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const SITE_URL = "https://dimagious.github.io/snipsidian/";

// No `.claude` mention on this page is legitimate: unlike Dashy (which
// writes a real vault path into a reader-facing button), Snipsy's site has
// nothing under `.claude` worth publishing. Every match is a leak.
const ALLOWED_CLAUDE_MENTIONS = new Set();

/** Strips `<script>...</script>` bodies, so a JS string literal like `"#" + id` is never read as an HTML attribute. */
function stripScripts(html) {
    return html.replace(/<script[\s\S]*?<\/script>/gi, " ");
}

/** Every `img/...` path the page references: from `src`/`srcset` attributes and from absolute og/twitter image URLs. */
function extractImageRefs(html) {
    const noScripts = stripScripts(html);
    const refs = new Set();
    for (const m of noScripts.matchAll(/\b(?:src|srcset)="(img\/[^"]+)"/g)) {
        refs.add(m[1]);
    }
    const prefix = `${SITE_URL}img/`;
    for (const m of noScripts.matchAll(/content="([^"]+)"/g)) {
        if (m[1].startsWith(prefix)) {
            refs.add(`img/${m[1].slice(prefix.length)}`);
        }
    }
    return Array.from(refs).sort();
}

/**
 * Image references whose file name is not in `availableImages` (file names
 * present directly under `site/img/`).
 */
function findMissingImages(html, availableImages) {
    const missing = [];
    for (const ref of extractImageRefs(html)) {
        const name = ref.slice("img/".length);
        if (!availableImages.has(name)) {
            missing.push(ref);
        }
    }
    return missing;
}

/** Every `id="..."` on the page. */
function extractIds(html) {
    const ids = new Set();
    for (const m of stripScripts(html).matchAll(/\bid="([^"]+)"/g)) {
        ids.add(m[1]);
    }
    return ids;
}

/** Every `href="#..."` target, non-empty. */
function extractAnchorTargets(html) {
    const targets = [];
    for (const m of stripScripts(html).matchAll(/href="#([^"]+)"/g)) {
        targets.push(m[1]);
    }
    return targets;
}

/** Anchor targets with no matching `id` on the page. */
function findDeadAnchors(html) {
    const ids = extractIds(html);
    return extractAnchorTargets(html).filter((t) => !ids.has(t));
}

/** Every relative link or asset reference: not an anchor, not `img/...` (checked separately), not a full URL, a data URI or a mail/tel link. */
function extractRelativeRefs(html) {
    const refs = new Set();
    for (const m of stripScripts(html).matchAll(/\b(?:href|src)="([^"]+)"/g)) {
        const v = m[1];
        if (
            v === "" ||
            v.startsWith("#") ||
            v.startsWith("img/") ||
            v.startsWith("http://") ||
            v.startsWith("https://") ||
            v.startsWith("mailto:") ||
            v.startsWith("tel:") ||
            v.startsWith("data:")
        ) {
            continue;
        }
        refs.add(v);
    }
    return Array.from(refs).sort();
}

/** Relative refs for which `fileExists(ref)` is false. `fileExists` takes a path relative to `site/`. */
function findBrokenRelativeRefs(html, fileExists) {
    return extractRelativeRefs(html).filter((ref) => !fileExists(ref));
}

/**
 * Any occurrence of `.claude` anywhere in the page source: this repository
 * has no allowed mention, so every match is a leak of local, private
 * working state into a published file.
 */
function findClaudePathMentions(html) {
    const matches = [];
    const re = /\.claude[^\s"'<>]*/g;
    let m;
    while ((m = re.exec(html)) !== null) {
        if (!ALLOWED_CLAUDE_MENTIONS.has(m[0])) {
            matches.push(m[0]);
        }
    }
    return matches;
}

const NAMED_ENTITIES = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    mdash: "—",
    ndash: "–",
};

function decodeEntities(text) {
    return text
        .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
        .replace(/&([a-zA-Z]+);/g, (whole, name) => (name in NAMED_ENTITIES ? NAMED_ENTITIES[name] : whole));
}

/** The text a reader actually sees: comments, `<script>` and `<style>` bodies and every tag stripped, entities decoded. */
function stripToVisibleText(html) {
    const withoutHidden = html
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ");
    return decodeEntities(withoutHidden);
}

/** Em dashes and en dashes in visible text, each with a short surrounding snippet for the error list. */
function findTypographicDashes(html) {
    const text = stripToVisibleText(html);
    const found = [];
    const re = /[–—]/g;
    let m;
    while ((m = re.exec(text)) !== null) {
        const start = Math.max(0, m.index - 24);
        const end = Math.min(text.length, m.index + 25);
        found.push(text.slice(start, end).replace(/\s+/g, " ").trim());
    }
    return found;
}

/** Missing entries from `["sitemap.xml", "robots.txt", "llms.txt"]`, given the set of file names present next to `index.html`. */
function findMissingSiteFiles(siteFiles) {
    return ["sitemap.xml", "robots.txt", "llms.txt"].filter((f) => !siteFiles.has(f));
}

/** The canonical link and the `og:url` meta both present and equal to `expectedUrl`; returns a list of problems, empty if fine. */
function checkCanonicalUrl(html, expectedUrl) {
    const problems = [];
    const canonical = html.match(/<link rel="canonical" href="([^"]+)">/);
    const ogUrl = html.match(/<meta property="og:url" content="([^"]+)">/);
    if (!canonical) problems.push("no <link rel=\"canonical\"> tag");
    else if (canonical[1] !== expectedUrl) problems.push(`canonical is "${canonical[1]}", expected "${expectedUrl}"`);
    if (!ogUrl) problems.push('no <meta property="og:url"> tag');
    else if (ogUrl[1] !== expectedUrl) problems.push(`og:url is "${ogUrl[1]}", expected "${expectedUrl}"`);
    return problems;
}

const REQUIRED_VERSION_PLACEHOLDERS = ["{{version}}", "{{minAppVersion}}"];

/** Which of `{{version}}`/`{{minAppVersion}}` are missing from the page. Both must be present; `assemble-site.cjs` fills them in from `manifest.json` at deploy time. */
function findMissingVersionPlaceholders(html) {
    return REQUIRED_VERSION_PLACEHOLDERS.filter((placeholder) => !html.includes(placeholder));
}

/** A literal x.y.z version string sitting next to the "version" property label instead of the `{{version}}`/`{{minAppVersion}}` placeholders. */
function findHardcodedVersionStrings(html) {
    const row = html.match(/>version<\/div>\s*<div class="v">([\s\S]{0,200}?)<\/div>\s*<\/div>/);
    if (!row) return [];
    const semver = row[1].match(/\b\d+\.\d+\.\d+\b/);
    return semver ? [semver[0]] : [];
}

// A `<link>` with one of these `rel` values makes the browser fetch its
// `href`; `canonical`, `alternate` and the like just point at a URL and are
// not requests, so they are not in this set.
const FETCHING_LINK_RELS = new Set([
    "stylesheet",
    "icon",
    "shortcut icon",
    "preload",
    "prefetch",
    "preconnect",
    "dns-prefetch",
    "apple-touch-icon",
    "manifest",
]);

/** Every absolute `http(s)://` URL the page would actually make a request to: a fetching `<link>`, a `<script src>`, an `<img>`/`<source>` `src`/`srcset`, or a CSS `url(...)` inside a `<style>` block. An `<a href>` is not a request and is not included. */
function findThirdPartyRequestUrls(html) {
    const urls = [];

    for (const m of html.matchAll(/<link\b([^>]*)>/gi)) {
        const tag = m[1];
        const rel = tag.match(/\brel="([^"]+)"/i);
        const href = tag.match(/\bhref="(https?:\/\/[^"]+)"/i);
        if (href && rel && FETCHING_LINK_RELS.has(rel[1].toLowerCase())) {
            urls.push(href[1]);
        }
    }
    for (const m of html.matchAll(/<script\b[^>]*\bsrc="(https?:\/\/[^"]+)"/gi)) {
        urls.push(m[1]);
    }
    for (const m of html.matchAll(/<(?:img|source)\b[^>]*\b(?:src|srcset)="(https?:\/\/[^"]+)"/gi)) {
        urls.push(m[1]);
    }
    for (const block of html.match(/<style[\s\S]*?<\/style>/gi) || []) {
        for (const m of block.matchAll(/url\(\s*['"]?(https?:\/\/[^'")]+)['"]?\s*\)/gi)) {
            urls.push(m[1]);
        }
    }
    return urls;
}

/** Runs every check against one page and returns a list of human-readable issue strings, empty when the page is clean. */
function runChecks(html, { availableImages, siteFileExists, siteFiles, expectedUrl }) {
    const issues = [];

    for (const ref of findMissingImages(html, availableImages)) {
        issues.push(`missing image: "${ref}" has no matching file under site/img/`);
    }
    for (const target of findDeadAnchors(html)) {
        issues.push(`dead anchor: href="#${target}" has no id="${target}" on the page`);
    }
    for (const ref of findBrokenRelativeRefs(html, siteFileExists)) {
        issues.push(`broken relative link: "${ref}" does not exist under site/`);
    }
    for (const mention of findClaudePathMentions(html)) {
        issues.push(`.claude path leaked into the page: "${mention}"`);
    }
    for (const snippet of findTypographicDashes(html)) {
        issues.push(`typographic dash in visible text: "...${snippet}..."`);
    }
    for (const missing of findMissingSiteFiles(siteFiles)) {
        issues.push(`missing site file: "${missing}"`);
    }
    for (const problem of checkCanonicalUrl(html, expectedUrl)) {
        issues.push(`canonical URL: ${problem}`);
    }
    for (const placeholder of findMissingVersionPlaceholders(html)) {
        issues.push(`missing version placeholder: "${placeholder}"`);
    }
    for (const version of findHardcodedVersionStrings(html)) {
        issues.push(`hardcoded version "${version}" next to the version label; use {{version}}/{{minAppVersion}} instead`);
    }
    for (const url of findThirdPartyRequestUrls(html)) {
        issues.push(`third-party request: "${url}"`);
    }

    return issues;
}

function main() {
    const root = path.resolve(__dirname, "..");
    const siteDir = path.join(root, "site");

    const html = fs.readFileSync(path.join(siteDir, "index.html"), "utf8");
    const availableImages = new Set(fs.readdirSync(path.join(siteDir, "img")));
    const siteFiles = new Set(fs.readdirSync(siteDir));
    const siteFileExists = (rel) => fs.existsSync(path.join(siteDir, rel));

    const issues = runChecks(html, { availableImages, siteFileExists, siteFiles, expectedUrl: SITE_URL });

    if (issues.length > 0) {
        console.error(`[site-check] ${issues.length} issue(s) found in site/index.html:\n`);
        for (const issue of issues) {
            console.error(`  - ${issue}`);
        }
        process.exit(1);
    }

    console.log("[site-check] site/ is clean.");
}

module.exports = {
    SITE_URL,
    extractImageRefs,
    findMissingImages,
    extractIds,
    extractAnchorTargets,
    findDeadAnchors,
    extractRelativeRefs,
    findBrokenRelativeRefs,
    findClaudePathMentions,
    stripToVisibleText,
    findTypographicDashes,
    findMissingSiteFiles,
    checkCanonicalUrl,
    findMissingVersionPlaceholders,
    findHardcodedVersionStrings,
    findThirdPartyRequestUrls,
    runChecks,
};

if (require.main === module) {
    main();
}
