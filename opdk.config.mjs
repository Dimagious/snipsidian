import { defineConfig } from "obsidian-plugin-dev-kit";

export default defineConfig({
    demo: {
        // `npm run capture` copies the site pictures (`e2e/capture.spec.ts`, `demo.still(..., { out: "site" })`) to
        // `site/img` and the pictures of the community directory listing (`out: "listing"`) to `docs/listing`.
        outputs: { site: "site/img", listing: "docs/listing" },
        // 1000 px is the width GitHub shows a README at; 128 colours at 10 fps keeps a typing film small.
        gif: { colors: 128, fps: 10, width: 1000 },
        films: {
            // It types a trigger and shows what it became, so the first frame is not the last: a hard cut. The MP4 and
            // the poster are for the site (`site/img/clip-patterns.mp4` and `.jpg`).
            patterns: { loop: "off" },
        },
    },
});
