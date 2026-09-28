import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

// scripts/site-check.cjs is a plain Node CommonJS script with no dependency
// on `obsidian` or the DOM, kept outside `src/` on purpose (it checks the
// static site in `site/`, not the plugin). `require` rather than a static
// import keeps that boundary explicit and sidesteps any ESM/CJS interop
// guessing for a `.cjs` file.
const require = createRequire(import.meta.url);

interface SiteCheckModule {
    SITE_URL: string;
    extractImageRefs: (html: string) => string[];
    findMissingImages: (html: string, availableImages: Set<string>) => string[];
    findDeadAnchors: (html: string) => string[];
    findBrokenRelativeRefs: (html: string, fileExists: (ref: string) => boolean) => string[];
    findClaudePathMentions: (html: string) => string[];
    stripToVisibleText: (html: string) => string;
    findTypographicDashes: (html: string) => string[];
    findMissingSiteFiles: (siteFiles: Set<string>) => string[];
    checkCanonicalUrl: (html: string, expectedUrl: string) => string[];
    findMissingVersionPlaceholders: (html: string) => string[];
    findHardcodedVersionStrings: (html: string) => string[];
    findThirdPartyRequestUrls: (html: string) => string[];
    runChecks: (
        html: string,
        opts: {
            availableImages: Set<string>;
            siteFileExists: (ref: string) => boolean;
            siteFiles: Set<string>;
            expectedUrl: string;
        }
    ) => string[];
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const siteCheck = require("../../scripts/site-check.cjs") as SiteCheckModule;
const {
    SITE_URL,
    extractImageRefs,
    findMissingImages,
    findDeadAnchors,
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
} = siteCheck;

const okOpts = () => ({
    availableImages: new Set<string>(["picker-light.png", "picker-dark.png"]),
    siteFileExists: (_ref: string) => true,
    siteFiles: new Set<string>(["index.html", "sitemap.xml", "robots.txt", "llms.txt"]),
    expectedUrl: SITE_URL,
});

const versionRow =
    '<div class="prop"><div class="k">version</div><div class="v">{{version}} <span>. Obsidian {{minAppVersion}} or later</span></div></div>';

const cleanPage = `<!doctype html><html><head>
<link rel="canonical" href="${SITE_URL}">
<meta property="og:url" content="${SITE_URL}">
</head><body>
${versionRow}
<a href="#install">install</a>
<a href="assets/apple-touch-icon.png">icon file</a>
<img src="img/picker-light.png" alt="ok">
<section id="install">install</section>
</body></html>`;

describe("site-check — a clean page", () => {
    it("runChecks reports no issues", () => {
        expect(runChecks(cleanPage, okOpts())).toEqual([]);
    });
});

describe("site-check — findMissingImages", () => {
    it("flags an img/ reference with no matching file under site/img/", () => {
        const html = `<img src="img/does-not-exist.png">`;
        expect(findMissingImages(html, new Set(["picker-light.png"]))).toEqual(["img/does-not-exist.png"]);
    });

    it("passes when the file is present under site/img/", () => {
        const html = `<img src="img/picker-light.png">`;
        expect(findMissingImages(html, new Set(["picker-light.png"]))).toEqual([]);
    });

    it("also reads an absolute og:image URL", () => {
        const html = `<meta property="og:image" content="${SITE_URL}img/social-preview.png">`;
        expect(extractImageRefs(html)).toEqual(["img/social-preview.png"]);
    });

    it("dedupes a src and a srcset pointing at the same file", () => {
        const html = `<source srcset="img/picker-dark.png"><img src="img/picker-dark.png">`;
        expect(extractImageRefs(html)).toEqual(["img/picker-dark.png"]);
    });
});

describe("site-check — findDeadAnchors", () => {
    it("flags an href=\"#x\" with no id=\"x\" on the page", () => {
        const html = `<a href="#nowhere">go</a><section id="install"></section>`;
        expect(findDeadAnchors(html)).toEqual(["nowhere"]);
    });

    it("passes when the id is present", () => {
        const html = `<a href="#install">go</a><section id="install"></section>`;
        expect(findDeadAnchors(html)).toEqual([]);
    });

    it("one dead anchor among several live ones is still reported, and only that one", () => {
        const html = `<a href="#a">a</a><a href="#b">b</a><a href="#missing">c</a><div id="a"></div><div id="b"></div>`;
        expect(findDeadAnchors(html)).toEqual(["missing"]);
    });

    it("does not mistake a JS string built from href=\"#\" + id for a real anchor", () => {
        const html = `<script>var a = '<a href="#' + e.id + '">x</a>';</script><section id="install"></section>`;
        expect(findDeadAnchors(html)).toEqual([]);
    });
});

describe("site-check — findBrokenRelativeRefs", () => {
    it("flags a relative link the fileExists callback rejects", () => {
        const html = `<a href="assets/ghost.png">x</a>`;
        expect(findBrokenRelativeRefs(html, () => false)).toEqual(["assets/ghost.png"]);
    });

    it("ignores anchors, img/ references and full URLs", () => {
        const html = `<a href="#x">x</a><img src="img/y.png"><a href="https://example.com">z</a>`;
        expect(findBrokenRelativeRefs(html, () => false)).toEqual([]);
    });

    it("passes when fileExists says yes", () => {
        const html = `<a href="assets/apple-touch-icon.png">x</a>`;
        expect(findBrokenRelativeRefs(html, () => true)).toEqual([]);
    });

    it("ignores a data: URI favicon", () => {
        const html = `<link rel="icon" href="data:image/svg+xml,%3Csvg%3E%3C/svg%3E">`;
        expect(findBrokenRelativeRefs(html, () => false)).toEqual([]);
    });
});

describe("site-check — findClaudePathMentions", () => {
    it("catches a leaked .claude path", () => {
        expect(findClaudePathMentions(`<!-- see .claude/private/notes.md -->`)).toEqual([".claude/private/notes.md"]);
    });

    it("a page with no mention of .claude is clean", () => {
        expect(findClaudePathMentions(`<p>Snipsy expands hotstrings.</p>`)).toEqual([]);
    });

    it("flags a .claude/skills/... path too: nothing is allow-listed on this site", () => {
        const html = `<code>.claude/skills/forum-helper/SKILL.md</code>`;
        expect(findClaudePathMentions(html)).toEqual([".claude/skills/forum-helper/SKILL.md"]);
    });
});

describe("site-check — findTypographicDashes", () => {
    it("catches an em dash in visible text", () => {
        expect(findTypographicDashes(`<p>Type a trigger — get the text.</p>`).length).toBe(1);
    });

    it("catches an en dash in visible text", () => {
        expect(findTypographicDashes(`<p>2020–2026</p>`).length).toBe(1);
    });

    it("does not flag a dash inside <script>, <style> or a comment", () => {
        const html = `<script>var x = "—";</script><style>.a::before{content:"–"}</style><!-- — --><p>fine.</p>`;
        expect(findTypographicDashes(html)).toEqual([]);
    });

    it("a page with only plain punctuation is clean", () => {
        expect(findTypographicDashes(`<p>Type a trigger, get the text.</p>`)).toEqual([]);
    });

    it("stripToVisibleText decodes a named dash entity before the scan sees it", () => {
        expect(stripToVisibleText(`<p>a&mdash;b</p>`)).toContain("—");
    });
});

describe("site-check — findMissingSiteFiles", () => {
    it("flags each of sitemap.xml, robots.txt and llms.txt that is missing", () => {
        expect(findMissingSiteFiles(new Set(["index.html"]))).toEqual(["sitemap.xml", "robots.txt", "llms.txt"]);
    });

    it("passes when all three are present, alongside other files", () => {
        expect(
            findMissingSiteFiles(new Set(["index.html", "sitemap.xml", "robots.txt", "llms.txt", "assets"]))
        ).toEqual([]);
    });
});

describe("site-check — checkCanonicalUrl", () => {
    it("flags a missing canonical link and a missing og:url", () => {
        const problems = checkCanonicalUrl(`<html></html>`, SITE_URL);
        expect(problems).toHaveLength(2);
    });

    it("flags a canonical link that points somewhere else", () => {
        const html = `<link rel="canonical" href="https://example.com/"><meta property="og:url" content="${SITE_URL}">`;
        const problems = checkCanonicalUrl(html, SITE_URL);
        expect(problems).toEqual([`canonical is "https://example.com/", expected "${SITE_URL}"`]);
    });

    it("passes when both match the expected URL", () => {
        const html = `<link rel="canonical" href="${SITE_URL}"><meta property="og:url" content="${SITE_URL}">`;
        expect(checkCanonicalUrl(html, SITE_URL)).toEqual([]);
    });
});

describe("site-check — findMissingVersionPlaceholders", () => {
    it("flags both placeholders missing from a page with no version row at all", () => {
        expect(findMissingVersionPlaceholders(`<p>no version here</p>`)).toEqual(["{{version}}", "{{minAppVersion}}"]);
    });

    it("flags only the one that is missing", () => {
        expect(findMissingVersionPlaceholders(`<p>{{version}}</p>`)).toEqual(["{{minAppVersion}}"]);
    });

    it("passes when both placeholders are present", () => {
        expect(findMissingVersionPlaceholders(versionRow)).toEqual([]);
    });
});

describe("site-check — findHardcodedVersionStrings", () => {
    it("flags a literal x.y.z sitting where {{version}} belongs", () => {
        const html = '<div class="prop"><div class="k">version</div><div class="v">1.3.2 . Obsidian 1.5.0 or later</div></div>';
        expect(findHardcodedVersionStrings(html)).toEqual(["1.3.2"]);
    });

    it("passes when the row uses the placeholders instead", () => {
        expect(findHardcodedVersionStrings(versionRow)).toEqual([]);
    });

    it("passes when there is no version row on the page at all", () => {
        expect(findHardcodedVersionStrings(`<p>1.3.2 is a fine sentence about a version, unrelated to the row.</p>`)).toEqual([]);
    });
});

describe("site-check — findThirdPartyRequestUrls", () => {
    it("flags a Google Fonts stylesheet link", () => {
        const html = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">`;
        expect(findThirdPartyRequestUrls(html)).toEqual(["https://fonts.googleapis.com/css2?family=Inter"]);
    });

    it("flags a preconnect hint", () => {
        const html = `<link rel="preconnect" href="https://fonts.gstatic.com">`;
        expect(findThirdPartyRequestUrls(html)).toEqual(["https://fonts.gstatic.com"]);
    });

    it("flags a font loaded through a CSS url() inside <style>", () => {
        const html = `<style>@font-face{src:url(https://fonts.gstatic.com/s/inter/a.woff2)}</style>`;
        expect(findThirdPartyRequestUrls(html)).toEqual(["https://fonts.gstatic.com/s/inter/a.woff2"]);
    });

    it("flags an external <script src>", () => {
        const html = `<script src="https://example.com/analytics.js"></script>`;
        expect(findThirdPartyRequestUrls(html)).toEqual(["https://example.com/analytics.js"]);
    });

    it("flags an external <img src>", () => {
        const html = `<img src="https://example.com/pixel.gif">`;
        expect(findThirdPartyRequestUrls(html)).toEqual(["https://example.com/pixel.gif"]);
    });

    it("does not flag an <a href> link: that is navigation, not a request", () => {
        const html = `<a href="https://github.com/Dimagious/snipsidian">GitHub</a>`;
        expect(findThirdPartyRequestUrls(html)).toEqual([]);
    });

    it("does not flag the canonical link or og:url meta, which are not fetching rels", () => {
        const html = `<link rel="canonical" href="${SITE_URL}"><meta property="og:url" content="${SITE_URL}">`;
        expect(findThirdPartyRequestUrls(html)).toEqual([]);
    });

    it("does not flag a local, relative asset", () => {
        const html = `<link rel="stylesheet" href="assets/site.css"><img src="img/picker-light.png">`;
        expect(findThirdPartyRequestUrls(html)).toEqual([]);
    });
});

describe("site-check — runChecks, mutated fixtures each fail on exactly one rule", () => {
    it("a missing image is the only reported issue", () => {
        const html = cleanPage.replace("img/picker-light.png", "img/missing.png");
        expect(runChecks(html, okOpts())).toEqual([
            'missing image: "img/missing.png" has no matching file under site/img/',
        ]);
    });

    it("a dead anchor is the only reported issue", () => {
        const html = cleanPage.replace('href="#install"', 'href="#gone"');
        expect(runChecks(html, okOpts())).toEqual(['dead anchor: href="#gone" has no id="gone" on the page']);
    });

    it("an em dash slipped into the copy is the only reported issue", () => {
        const html = cleanPage.replace("install</a>", "install — now</a>");
        expect(runChecks(html, okOpts())).toEqual([
            'typographic dash in visible text: "...}} or later install — now icon file ins..."',
        ]);
    });

    it("a hand-written version instead of the placeholder is the only reported issue", () => {
        const html = cleanPage.replace(
            "{{version}} <span>. Obsidian {{minAppVersion}} or later</span>",
            "1.3.2 <span>. Obsidian 1.5.0 or later</span>"
        );
        expect(runChecks(html, okOpts())).toEqual([
            'missing version placeholder: "{{version}}"',
            'missing version placeholder: "{{minAppVersion}}"',
            'hardcoded version "1.3.2" next to the version label; use {{version}}/{{minAppVersion}} instead',
        ]);
    });

    it("a reintroduced Google Fonts link is the only reported issue", () => {
        const html = cleanPage.replace(
            "</head>",
            '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter"></head>'
        );
        expect(runChecks(html, okOpts())).toEqual([
            'third-party request: "https://fonts.googleapis.com/css2?family=Inter"',
        ]);
    });
});

describe("assemble-site — substitutePlaceholders", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { substitutePlaceholders } = require("../../scripts/assemble-site.cjs") as {
        substitutePlaceholders: (html: string, manifest: { version: string; minAppVersion: string }) => string;
    };
    const manifest = { version: "1.3.2", minAppVersion: "1.5.0" };

    it("substitutes both placeholders on the happy path", () => {
        const html = "<p>{{version}} needs Obsidian {{minAppVersion}}+</p>";
        expect(substitutePlaceholders(html, manifest)).toBe("<p>1.3.2 needs Obsidian 1.5.0+</p>");
    });

    it("substitutes when only one placeholder is present", () => {
        const html = "<p>version {{version}} only</p>";
        expect(substitutePlaceholders(html, manifest)).toBe("<p>version 1.3.2 only</p>");
    });

    it("replaces every occurrence when a placeholder appears twice", () => {
        const html = "{{version}} and again {{version}}";
        expect(substitutePlaceholders(html, manifest)).toBe("1.3.2 and again 1.3.2");
    });

    it("is a no-op when there are no placeholders", () => {
        const html = "<p>nothing to replace here</p>";
        expect(substitutePlaceholders(html, manifest)).toBe(html);
    });
});
