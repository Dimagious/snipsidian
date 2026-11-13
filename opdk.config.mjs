import { defineConfig } from "obsidian-plugin-dev-kit";

export default defineConfig({
    demo: {
        // `npm run capture` copies the site pictures (`e2e/capture.spec.ts`, `demo.still(..., { out: "site" })`) here.
        outputs: { site: "site/img" },
    },
});
