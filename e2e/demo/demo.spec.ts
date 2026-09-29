import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { test, ui } from "./fixtures";
import { beat, hideSubtitle, injectOverlays, moveAndClick, showSubtitle, typeSlowly } from "./overlays";

/**
 * README demo recording driver: six narrated scenes in one continuous
 * take, recorded by `scripts/record-demo.sh` and composed with the
 * voice-over by `scripts/build-demo.sh`.
 *
 *   1. todo / done           (voice/scene1.mp3)
 *   2. multi-line callout    (voice/scene2.mp3)
 *   3. fenced code is silent (voice/scene3.mp3)
 *   4. today -> $date        (voice/scene4.mp3)
 *   5. Settings: Add snippet (voice/scene5.mp3)
 *   6. Settings tab tour     (voice/scene6.mp3)
 *
 * Timing: every scene is padded to (its narration clip length +
 * SCENE_TAIL) so the voice-over never runs into the next scene. The
 * clip lengths are read from the MP3s with ffprobe for the language in
 * DEMO_LANG (en -> docs/screens/voice, ru -> docs/screens/voice-ru), so
 * each language gets its own take with its own pacing.
 *
 * Sync: right before scene 1 the spec flashes a full-window magenta
 * frame. build-demo.sh finds the last magenta frame in the raw video,
 * trims everything before it (Obsidian boot, warm-up) and places each
 * clip at its scene mark, so audio lines up to the frame.
 *
 * Settings: the demo fixture sets `settingsPopoutWindow: false`, so
 * Settings renders as a modal inside the recorded window instead of
 * Obsidian 1.13's separate popout window.
 *
 * DEMO_REHEARSE=1 (`npm run demo:rehearse`) runs the same flow without
 * the padding, to check selectors before burning a take.
 */

const REHEARSE = process.env.DEMO_REHEARSE === "1";
const LANG = process.env.DEMO_LANG === "ru" ? "ru" : "en";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VOICE_DIR = path.resolve(__dirname, "..", "..", "docs", "screens", LANG === "ru" ? "voice-ru" : "voice");

/** Seconds of breathing room after each narration clip. */
const SCENE_TAIL = 0.7;

function clipSeconds(name: string): number {
    const file = path.join(VOICE_DIR, `${name}.mp3`);
    const out = execFileSync("ffprobe", [
        "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file,
    ]).toString().trim();
    const secs = Number.parseFloat(out);
    if (!Number.isFinite(secs)) throw new Error(`ffprobe gave no duration for ${file}: "${out}"`);
    return secs;
}

/** Scene marks (seconds since the scene-1 mark), written as JSON so
 *  build-demo.sh can delay each clip to its scene. Per language, since
 *  each language is its own take. */
const MARKS_PATH = path.join(os.tmpdir(), `snipsy-demo-marks-${LANG}.json`);
let recordingStart = 0;
const marks: Record<string, number> = {};

function mark(name: string): void {
    const t = performance.now();
    if (recordingStart === 0) recordingStart = t;
    marks[name] = (t - recordingStart) / 1000;
    fs.writeFileSync(MARKS_PATH, JSON.stringify(marks, null, 2));
}

/** Wait until `seconds` have passed since the scene mark `name`. */
async function padTo(win: Page, name: string, seconds: number): Promise<void> {
    if (REHEARSE) return;
    const start = marks[name];
    if (start === undefined) throw new Error(`padTo: no mark "${name}"`);
    const elapsed = (performance.now() - recordingStart) / 1000 - start;
    const remaining = seconds - elapsed;
    if (remaining > 0) await win.waitForTimeout(Math.round(remaining * 1000));
    else console.warn(`[demo] ${name} ran ${(-remaining).toFixed(2)}s past its ${seconds.toFixed(2)}s budget`);
}

/** End a scene: pad to the budget minus the fade, then fade the caption. */
async function endScene(win: Page, name: string, budget: number): Promise<void> {
    await padTo(win, name, budget - 0.35);
    await hideSubtitle(win);
    await padTo(win, name, budget);
}

/** Human-paced typing into the focused editor. */
async function typeHuman(win: Page, text: string, delay = 55): Promise<void> {
    const editor = ui.activeEditor(win);
    const hasFocus = await editor.evaluate((el) => el.contains(activeDocument.activeElement));
    if (!hasFocus) await editor.click();
    await editor.pressSequentially(text, { delay });
}

async function openSnipsySettings(win: Page): Promise<void> {
    await win.evaluate(() => {
        const a = (globalThis as unknown as {
            app: { setting: { open(): void; openTabById(id: string): void } };
        }).app;
        a.setting.open();
        a.setting.openTabById("snipsidian");
    });
    await win.locator("#snipsy-tab-snippets").waitFor({ state: "visible", timeout: 10_000 });
    await fitSettingsModal(win);
    const shots = process.env.DEMO_SHOTS;
    if (shots) {
        fs.mkdirSync(shots, { recursive: true });
        await win.screenshot({ path: path.join(shots, `settings-${Date.now()}.png`) });
    }
}

/** Keep the settings modal clear of the caption bar: at 1280x720 it
 *  otherwise runs down to where the caption sits. Shrinks it and lifts
 *  it a little; the content inside is untouched. */
async function fitSettingsModal(win: Page): Promise<void> {
    await win.evaluate(() => {
        const el = document.querySelector<HTMLElement>(".modal.mod-settings");
        if (!el) throw new Error("fitSettingsModal: no .modal.mod-settings");
        const vh = window.innerHeight;
        el.style.height = `${vh - 150}px`;
        el.style.maxHeight = `${vh - 150}px`;
        el.style.marginBottom = "70px";
    });
}

/** Empty the cursor's line through the editor API. */
async function clearCurrentLine(win: Page): Promise<void> {
    await win.evaluate(() => {
        const ed = (globalThis as unknown as {
            app: { workspace: { activeEditor: { editor: {
                getCursor(): { line: number; ch: number };
                setLine(n: number, text: string): void;
                setCursor(pos: { line: number; ch: number }): void;
            } } | null } };
        }).app.workspace.activeEditor?.editor;
        if (!ed) throw new Error("clearCurrentLine: no active editor");
        const { line } = ed.getCursor();
        ed.setLine(line, "");
        ed.setCursor({ line, ch: 0 });
    });
}

async function closeSettings(win: Page): Promise<void> {
    await win.evaluate(() => {
        (globalThis as unknown as { app: { setting: { close(): void } } }).app.setting.close();
    });
    await win.locator(".mod-settings").waitFor({ state: "detached", timeout: 5_000 });
}

/** Full-window magenta frame used as the audio sync point. */
async function syncFlash(win: Page): Promise<void> {
    await win.evaluate(() => {
        const el = document.createElement("div");
        el.id = "snipsy-demo-sync";
        el.style.cssText = "position:fixed;inset:0;background:#ff00ff;z-index:2147483647";
        document.body.appendChild(el);
    });
    await win.waitForTimeout(500);
    await win.evaluate(() => document.getElementById("snipsy-demo-sync")?.remove());
    // Let the removal paint before the mark.
    await win.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

test.describe("Snipsy README demo", () => {
    test.setTimeout(REHEARSE ? 120_000 : 240_000);

    test("six-scene continuous take", async ({ win }) => {
        const budget = {
            s1: clipSeconds("scene1") + SCENE_TAIL,
            s2: clipSeconds("scene2") + SCENE_TAIL,
            s3: clipSeconds("scene3") + SCENE_TAIL,
            s4: clipSeconds("scene4") + SCENE_TAIL,
            s5: clipSeconds("scene5") + SCENE_TAIL,
            s6: clipSeconds("scene6") + SCENE_TAIL,
        };

        // Warm-up (trimmed from the final video): load the Packages
        // catalog once so the tab tour shows it instead of a spinner,
        // then leave Settings on the Snippets tab.
        await openSnipsySettings(win);
        await win.locator("#snipsy-tab-packages").click();
        await win
            .getByRole("button", { name: /Install|Reinstall/ })
            .first()
            .waitFor({ state: "visible", timeout: 30_000 });
        await win.locator("#snipsy-tab-snippets").click();
        await win.waitForTimeout(300);
        await closeSettings(win);

        await injectOverlays(win);
        await ui.clearEditor(win);
        await win.mouse.move(1180, 640);
        await beat(win, 400);

        await syncFlash(win);
        mark("scene-1");

        // Scene 1: first expansion (todo + done). Triggers are stored
        // without a colon because `:` is a delimiter for the engine.
        await test.step("scene 1: todo and done", async () => {
            await beat(win, 500);
            await showSubtitle(win, "todo  →  - [ ]");
            await typeHuman(win, "todo ");
            await beat(win, 700);
            await typeHuman(win, "Buy milk");
            await win.keyboard.press("Enter");
            // Obsidian continues the task list with a fresh "- [ ] ";
            // clear it so the second trigger starts a clean line.
            await clearCurrentLine(win);
            await beat(win, 1200);
            await showSubtitle(win, "done  →  - [x]");
            await typeHuman(win, "done ");
            await beat(win, 500);
            await typeHuman(win, "Call mom");
            await endScene(win, "scene-1", budget.s1);
        });

        await test.step("scene 2: multi-line callout", async () => {
            mark("scene-2");
            await ui.clearEditor(win);
            await showSubtitle(win, "Multi-line snippets: the cursor lands where you type");
            await beat(win, 400);
            await typeHuman(win, "callout ");
            await beat(win, 1200);
            await typeHuman(win, "Deadline on Friday");
            await endScene(win, "scene-2", budget.s2);
        });

        await test.step("scene 3: silent inside code", async () => {
            mark("scene-3");
            await ui.clearEditor(win);
            await showSubtitle(win, "Inside code or YAML? Snipsy stays silent.");
            await beat(win, 300);
            // Inside a fenced code block: the trigger must NOT fire.
            await typeHuman(win, "```");
            await win.keyboard.press("Enter");
            await typeHuman(win, "todo ");
            await beat(win, 2200);
            // Step outside the fence and try again: it fires.
            await win.keyboard.press("ArrowDown");
            await win.keyboard.press("ArrowDown");
            await win.keyboard.press("End");
            await win.keyboard.press("Enter");
            await typeHuman(win, "todo Outside the fence");
            await endScene(win, "scene-3", budget.s3);
        });

        await test.step("scene 4: $date", async () => {
            mark("scene-4");
            await ui.clearEditor(win);
            await showSubtitle(win, "today  →  $date  (always current)");
            await beat(win, 400);
            await typeHuman(win, "today ");
            await beat(win, 1200);
            await typeHuman(win, " daily journal entry");
            await endScene(win, "scene-4", budget.s4);
        });

        await test.step("scene 5: add a snippet in Settings", async () => {
            mark("scene-5");
            await showSubtitle(win, "Settings → Snipsy → Add snippet");
            await openSnipsySettings(win);
            await beat(win, 500);

            const addBtn = win.locator("button.snippet-action.mod-cta", { hasText: "Add snippet" }).first();
            await moveAndClick(win, addBtn, "Add snippet", { postClickDelay: 500 });

            const modal = win.locator(".modal:has(.snipsidian-modal)").last();
            await modal.waitFor({ state: "visible" });
            await typeSlowly(win, modal.locator("input[type=text]").first(), "sig", "trigger", 70);
            await typeSlowly(win, modal.locator("textarea").first(), "Best,\nDmitriy", "replacement", 45);
            await beat(win, 300);
            await moveAndClick(win, modal.getByRole("button", { name: "Add snippet" }), "submit", {
                postClickDelay: 600,
            });

            // Back to the note to use the new trigger.
            await closeSettings(win);
            await ui.clearEditor(win);
            await typeHuman(win, "sig ");
            await endScene(win, "scene-5", budget.s5);
        });

        await test.step("scene 6: tab tour", async () => {
            mark("scene-6");
            await openSnipsySettings(win);

            const tabs = [
                { id: "snippets", subtitle: "Snippets: manage, group, search your library" },
                { id: "packages", subtitle: "Packages: community catalog + Espanso import" },
                { id: "general", subtitle: "General: hotkeys, prefix mode, backup" },
                { id: "about", subtitle: "About: docs, feedback, community" },
            ];
            // Spread the tabs evenly over the narration.
            const slot = (budget.s6 - 0.8) / tabs.length;
            for (const [i, tab] of tabs.entries()) {
                await showSubtitle(win, tab.subtitle);
                await moveAndClick(win, win.locator(`#snipsy-tab-${tab.id}`), `${tab.id} tab`, {
                    postClickDelay: 300,
                });
                await padTo(win, "scene-6", 0.3 + slot * (i + 1));
            }
            await endScene(win, "scene-6", budget.s6);
            await closeSettings(win);
        });

        // Short hold on the editor before the outro card cuts in (the
        // outro narration plays on the card itself).
        mark("scene-end");
        await beat(win, 1000);
        mark("recording-end");
    });
});
