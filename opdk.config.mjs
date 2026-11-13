import { defineConfig } from "obsidian-plugin-dev-kit";

export default defineConfig({
    demo: {
        // `npm run capture` copies the site pictures (`e2e/capture.spec.ts`, `demo.still(..., { out: "site" })`) to
        // `site/img` and the pictures of the community directory listing (`out: "listing"`) to `docs/listing`.
        outputs: { site: "site/img", listing: "docs/listing" },
    },
});
