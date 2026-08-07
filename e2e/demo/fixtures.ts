import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { test as base } from "../fixtures";

/**
 * Demo recording fixture. Layers three overrides on top of the
 * regular E2E fixture so the visible state matches what the demo VO
 * describes:
 *
 *   1. `data.json` is reseeded with the six demo snippets (`:todo`,
 *      `:done`, `:callout`, `:today`, `:bold`, `:table`) — the e2e
 *      pristine vault only ships `brb`/`h1`/`callout`, which doesn't
 *      cover the scenes.
 *   2. `Welcome.md` is replaced by an empty `Snipsy demo.md` so the
 *      tab title reads "Snipsy demo" on camera and the editor starts
 *      blank.
 *   3. The Electron window is resized to 1280×720 at (0, 0) so the
 *      screen capture has a stable, predictable target region.
 *
 * Everything else (electron launch, trust-dialog handling, plugin
 * enable, editor wait) inherits from `e2e/fixtures.ts`.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SEED_DIR = path.join(__dirname, "seed");

/** Recording target resolution. Logical pixels — Retina captures at
 *  2× and is downscaled in FFmpeg post-processing. */
export const DEMO_VIEWPORT = { width: 1280, height: 720 } as const;

/** Sentinel file the fixture writes once the Obsidian window is
 *  sized + positioned. `scripts/record-demo.sh` polls for this file
 *  and reads the capture coords out of it before starting ffmpeg —
 *  the values include the macOS menu-bar offset and the actual
 *  per-display scaleFactor, so the crop region matches the window
 *  flush instead of guessing at retina 2×. */
const SENTINEL_PATH = path.join(os.tmpdir(), "snipsy-demo-ready.json");

export const test = base.extend({
    vaultPath: async ({ vaultPath: baseVaultPath }, use) => {
        // Reseed Snipsy data.json with the curated demo set. The
        // pristine vault ships `brb`/`h1`/`callout` only — we need
        // the full demo snippet set (`:todo`, `:done`, `:callout`,
        // `:today`, `:bold`, `:table`) before the plugin's onload()
        // reads the file.
        const pluginDataPath = path.join(
            baseVaultPath,
            ".obsidian",
            "plugins",
            "snipsidian",
            "data.json",
        );
        fs.copyFileSync(path.join(SEED_DIR, "data.json"), pluginDataPath);

        // Leave `Welcome.md` and the pristine `workspace.json`
        // untouched — Obsidian is picky about the workspace shape
        // and replacing it from outside risks a hang on load. The
        // demo file rename happens via Obsidian's API after the
        // workspace is up (see fixture for `win` below).

        await use(baseVaultPath);
    },

    win: async ({ win, app }, use) => {
        // Resize + position via the Electron main process. The work
        // area accounts for the macOS menu bar, so positioning at
        // (workArea.x, workArea.y) puts the window flush below the
        // menu bar without overlapping it. Returning the scaleFactor
        // and absolute screen-pixel bounds lets the recording
        // wrapper crop ffmpeg to exactly the window region.
        const layout = await app.evaluate(
            async (electron, { width, height }) => {
                const bw = electron.BrowserWindow.getAllWindows()[0];
                if (!bw) return null;
                const display = electron.screen.getPrimaryDisplay();
                const wa = display.workArea;
                bw.setBounds({ x: wa.x, y: wa.y, width, height });
                bw.setMenuBarVisibility(false);
                return {
                    windowX: wa.x,
                    windowY: wa.y,
                    width,
                    height,
                    scaleFactor: display.scaleFactor,
                    cropX: Math.round(wa.x * display.scaleFactor),
                    cropY: Math.round(wa.y * display.scaleFactor),
                    cropW: Math.round(width * display.scaleFactor),
                    cropH: Math.round(height * display.scaleFactor),
                };
            },
            DEMO_VIEWPORT,
        );

        // Let the window settle into its new geometry before
        // overlays inject.
        await win.waitForTimeout(400);

        // Drop the sentinel so the recording wrapper knows we're
        // ready to be captured. Stale files from a previous run
        // would mislead the wrapper, so the wrapper itself is
        // responsible for clearing the path before launch.
        if (layout) {
            fs.writeFileSync(SENTINEL_PATH, JSON.stringify(layout, null, 2));
        }

        await use(win);

        // Clean up so a follow-up rehearsal can't be misled by a
        // stale "ready" sentinel.
        try {
            fs.rmSync(SENTINEL_PATH, { force: true });
        } catch {
            // ignore
        }
    },
});

export { expect, ui } from "../fixtures";
