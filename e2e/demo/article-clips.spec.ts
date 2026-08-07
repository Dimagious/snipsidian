import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { expect, test, ui } from "./fixtures";
import {
    beat,
    hideSubtitle,
    injectCursor,
    injectSubtitleBar,
    moveAndClick,
    showSubtitle,
} from "./overlays";

/**
 * Article-clip recording driver. Two short, focused MP4 clips for the
 * "What 28 releases taught me" Dev.to article — separate from the
 * README demo (`demo.spec.ts`) because:
 *
 *   - Article clips are 3–10 seconds each, not 90+ seconds.
 *   - They loop seamlessly: each scene ends back at the empty editor
 *     so the autoplay-loop on the article page doesn't visibly jump.
 *   - No voice-over, no intro/outro cards — just the scene.
 *
 * Each test writes a marks JSON to `$TMPDIR/snipsy-article-marks-<scene>.json`
 * with scene-start / scene-end timestamps in the page's
 * `performance.now()` clock. `scripts/record-article-clips.sh` reads
 * these to trim the recorded webm to the scene window before
 * transcoding to H.264 MP4.
 *
 * Run order: tests are tagged so the shell script can invoke them
 * separately via `--grep`. Each test launches its own Electron
 * instance (own video file).
 */

/** Page-clock timestamp in seconds. Uses the page's `performance.now()`
 *  rather than Node's `performance.now()` because the page clock starts
 *  when the renderer attaches, which is when `recordVideo` begins
 *  capturing — so this value approximates "seconds into the recorded
 *  video" with sub-frame precision. */
async function pageNowSec(win: import("@playwright/test").Page): Promise<number> {
    return await win.evaluate(() => performance.now() / 1000);
}

function writeMarks(scene: string, start: number, end: number): void {
    const file = path.join(os.tmpdir(), `snipsy-article-marks-${scene}.json`);
    fs.writeFileSync(file, JSON.stringify({ start, end }, null, 2));
}

test.describe("Snipsy article clips", () => {
    test.setTimeout(120_000);

    /**
     * Hero clip — `todo` + space expands to `- [ ]`. Tiny, label-style
     * subtitle pinned at the bottom. Ends with the editor cleared so
     * the loop seam is invisible.
     */
    test("hero — todo expansion", async ({ win }) => {
        await injectSubtitleBar(win);
        await ui.clearEditor(win);
        await beat(win, 600);

        const sceneStart = await pageNowSec(win);

        await showSubtitle(win, "todo + space → Markdown task");
        await beat(win, 500);

        const editor = ui.activeEditor(win);
        await editor.click();
        // 90ms/char is slow enough to read the trigger before it
        // expands, fast enough to feel like a real keystroke pace.
        await editor.pressSequentially("todo ", { delay: 90 });
        await beat(win, 450);

        await editor.pressSequentially("Buy milk", { delay: 55 });
        await beat(win, 800);

        // Loop seam: clear editor but KEEP subtitle visible. The
        // first frame of the scene already shows the subtitle
        // (the 250 ms fade-in completes faster than the gap between
        // `pageNowSec` and the actual recorded frame), so for the
        // last frame to match we leave the subtitle on screen.
        await ui.clearEditor(win);
        await beat(win, 400);

        const sceneEnd = await pageNowSec(win);
        writeMarks("hero", sceneStart, sceneEnd);
    });

    /**
     * Packages clip — open Packages tab, install Markdown Essentials
     * pack, use `tbl3` (3-column Markdown table) from it. Cursor
     * overlay is injected because clicks matter; subtitle bar
     * narrates each beat.
     *
     * `tbl3` is chosen over a single-line trigger because the
     * 3-line table expansion is visually striking — viewers see
     * pipes-and-dashes materialise in one keystroke.
     *
     * The community catalog is pre-warmed once before the scene so
     * the pack card renders instantly on camera — without this the
     * viewer would watch a 1–3 second "Loading…" skeleton.
     */
    test("packages — install Markdown Essentials", async ({ win }) => {
        await injectSubtitleBar(win);
        await injectCursor(win);
        await ui.clearEditor(win);

        // Pre-warm: open Settings → Packages tab once invisibly so the
        // 24h GitHub-API cache populates with the catalog. Then close.
        // Frame zero of the recorded scene shows the cached catalog.
        await win.evaluate(() => {
            const a = (globalThis as unknown as {
                app?: {
                    setting?: {
                        open?: () => void;
                        openTabById?: (id: string) => void;
                    };
                };
            }).app;
            a?.setting?.open?.();
            a?.setting?.openTabById?.("snipsidian");
        });
        await beat(win, 400);

        const pkgTab = win.locator(
            'button[role="tab"][id="snipsy-tab-packages"]',
        );
        await pkgTab.click();

        // Wait for the Markdown Essentials row to render. ≤ 8s
        // allows for cold network; typical hit on a warm cache is
        // < 500ms.
        const packRow = win
            .locator(".package-row")
            .filter({ hasText: "Markdown Essentials" })
            .first();
        await packRow.waitFor({ state: "visible", timeout: 8_000 });

        // Close settings before the scene. Escape alone is unreliable
        // here — Obsidian's tab buttons sometimes swallow the keypress,
        // leaving Settings open. Call `app.setting.close()` directly
        // so the scene starts deterministically in editor view (the
        // first recorded frame must be the editor for the loop seam).
        await win.evaluate(() => {
            const a = (globalThis as unknown as {
                app?: { setting?: { close?: () => void } };
            }).app;
            a?.setting?.close?.();
        });
        await beat(win, 600);

        // Show the opening subtitle BEFORE marking sceneStart so frame
        // 0 of the trimmed clip already has the subtitle bar opaque
        // — otherwise the trim window might cut a frame before the
        // 250 ms fade-in completes, and the first frame would lack
        // the subtitle while the last frame has the final one (a
        // visible "subtitle pops in" at every loop restart).
        await showSubtitle(win, "Browse community packs");
        await beat(win, 350);

        // ──── Scene start ────
        const sceneStart = await pageNowSec(win);

        await win.evaluate(() => {
            const a = (globalThis as unknown as {
                app?: {
                    setting?: {
                        open?: () => void;
                        openTabById?: (id: string) => void;
                    };
                };
            }).app;
            a?.setting?.open?.();
            a?.setting?.openTabById?.("snipsidian");
        });
        // Settings re-mount tears overlays off the body; re-inject.
        await injectSubtitleBar(win);
        await injectCursor(win);
        await showSubtitle(win, "Browse community packs");
        await beat(win, 300);

        await moveAndClick(win, pkgTab, "Packages tab", {
            postClickDelay: 350,
        });
        await expect(packRow).toBeVisible();
        await beat(win, 400);

        // Beat 2 — Install
        await showSubtitle(win, "Install Markdown Essentials");
        await beat(win, 250);
        const installBtn = packRow.locator("button").filter({ hasText: "Install" });
        await moveAndClick(win, installBtn, "Install button", {
            postClickDelay: 400,
        });

        // Beat 3 — Preview modal
        await showSubtitle(win, "Preview the diff before it lands");
        const previewModal = win.locator(".modal-container").last();
        await expect(previewModal).toBeVisible({ timeout: 3_000 });
        await beat(win, 900);

        // Beat 4 — Confirm + close
        await showSubtitle(win, "Apply and close");
        await beat(win, 150);
        const applyBtn = win
            .locator(".modal-button-container button")
            .filter({ hasText: "Apply" });
        await moveAndClick(win, applyBtn, "Apply install", {
            postClickDelay: 350,
        });
        await beat(win, 250);
        await win.keyboard.press("Escape");
        await beat(win, 400);

        // Beat 5 — Use the new trigger. `tbl3` expands to a 3-line
        // 3-column markdown table; the cursor lands inside the first
        // data cell so the typed text appears under "H1".
        await showSubtitle(win, "tbl3 + space → Markdown table");
        // Editor lost focus while Settings was open; click back in.
        await injectSubtitleBar(win);
        await showSubtitle(win, "tbl3 + space → Markdown table");
        const editor = ui.activeEditor(win);
        await editor.click();
        await beat(win, 200);
        await editor.pressSequentially("tbl3 ", { delay: 90 });
        await beat(win, 500);
        await editor.pressSequentially("Project", { delay: 55 });
        await beat(win, 800);

        // Loop seam (see hero scene): clear editor but KEEP subtitle
        // visible so the last frame mirrors frame 0.
        await ui.clearEditor(win);
        await beat(win, 350);

        const sceneEnd = await pageNowSec(win);
        writeMarks("packages", sceneStart, sceneEnd);
    });
});
