import { defineConfig } from "obsidian-plugin-dev-kit";

export default defineConfig({
    scan: {
        // The integration layer (wdio, Android) is a dev-only test harness with its own tsconfig and lint
        // config (`npm run it:lint`). It never ships in main.js, and its findings (untyped wdio imports,
        // node:child_process) say nothing about the plugin.
        ignore: ["integration/**"],
    },
});
