/* scripts/build-vault.cjs */
const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const OUT = process.env.VAULT_PLUGIN;
if (!OUT) {
    console.error(
        'Set VAULT_PLUGIN to your plugin folder path and rerun. Example:\n' +
        'VAULT_PLUGIN="/absolute/path/to/vault/.obsidian/plugins/snipsidian" npm run build:vault'
    );
    process.exit(1);
}

const outFile = path.join(OUT, "main.js");
const watch = process.argv.includes("--watch");

function copyAssets() {
    for (const f of ["styles.css", "manifest.json"]) {
        if (fs.existsSync(f)) fs.copyFileSync(f, path.join(OUT, f));
    }
}

(async () => {
    const ctx = await esbuild.context({
        entryPoints: ["src/main.ts"],
        bundle: true,
        outfile: outFile,
        format: "cjs",
        platform: "node",
        target: "es2020",
        external: ["obsidian", "electron", "@codemirror/*"],
        plugins: [
            {
                name: "copy-assets",
                setup(build) {
                    build.onEnd((result) => {
                        copyAssets();
                        const ok = !result.errors?.length;
                        console.log(ok ? "[snipsidian] Built" : "[snipsidian] Build had errors");
                    });
                },
            },
        ],
        footer: {
            js: "module.exports = module.exports.default || module.exports;",
        }
    });

    await ctx.rebuild();

    if (watch) {
        await ctx.watch();
        console.log("[snipsidian] Watching for changes…");
    } else {
        await ctx.dispose();
    }
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
