#!/usr/bin/env node
/**
 * Assembles the deployable `_site/` directory: a straight copy of `site/`.
 * Unlike Dashy, Snipsy's screenshots already live under `site/img/` as
 * checked-in files, so there is no `docs/screens/` merge step here.
 *
 * Also fills in `{{version}}` and `{{minAppVersion}}` from `manifest.json`.
 * `site/index.html` never hand-writes a version: the Pages workflow deploys
 * from a release tag (see `.github/workflows/pages.yml`), so `manifest.json`
 * at that commit is already the version that just shipped.
 */
"use strict";

const fs = require("fs");
const path = require("path");

function copyDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const from = path.join(src, entry.name);
        const to = path.join(dest, entry.name);
        if (entry.isDirectory()) copyDir(from, to);
        else fs.copyFileSync(from, to);
    }
}

/** Replaces `{{version}}` and `{{minAppVersion}}` with the values from `manifest` (`{version, minAppVersion}`). */
function substitutePlaceholders(html, manifest) {
    return html.replaceAll("{{version}}", manifest.version).replaceAll("{{minAppVersion}}", manifest.minAppVersion);
}

function assemble(root) {
    const siteDir = path.join(root, "site");
    const outDir = path.join(root, "_site");
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

    fs.rmSync(outDir, { recursive: true, force: true });
    copyDir(siteDir, outDir);

    const indexPath = path.join(outDir, "index.html");
    fs.writeFileSync(indexPath, substitutePlaceholders(fs.readFileSync(indexPath, "utf8"), manifest));

    return outDir;
}

if (require.main === module) {
    const out = assemble(path.resolve(__dirname, ".."));
    console.log(`[assemble-site] wrote ${out}`);
}

module.exports = { assemble, substitutePlaceholders };
