import * as fs from "node:fs";
import { createObsidianTest } from "obsidian-plugin-dev-kit/e2e";

/**
 * Demo recording fixture: the kit's Obsidian fixture, set up so the visible
 * state matches what the demo voice-over describes.
 *
 *   1. `data.json` is the grouped demo set (`todo`, `done`, `callout`,
 *      `today`, `bold`); the e2e pristine vault does not cover the scenes.
 *   2. The Obsidian window is 1280x720, the size of the recorded video.
 *      `demo.spec.ts` asks Playwright for a video of that size; the kit
 *      records the Obsidian window with it and attaches the .webm to the
 *      test (`scripts/record-demo.sh` points `--output` at a temp folder
 *      and takes the file from there).
 *   3. Settings opens in the recorded window: the kit sets
 *      `settingsPopoutWindow: false` (Obsidian 1.13 would open a second
 *      window, which Playwright records into its own .webm).
 *
 * Everything else (launch, trust, plugin install, readiness) is the kit's.
 */

/** Recording target resolution, in logical pixels. */
export const DEMO_VIEWPORT = { width: 1280, height: 720 } as const;

const demoData: unknown = JSON.parse(
    fs.readFileSync(new URL("./seed/data.json", import.meta.url), "utf8"),
);

export const { test, expect, onlyWhen } = createObsidianTest({
    seedVault: "e2e-vault.pristine",
    data: { snipsidian: demoData as Record<string, unknown> },
    window: DEMO_VIEWPORT,
});

export { ui } from "../fixtures";
