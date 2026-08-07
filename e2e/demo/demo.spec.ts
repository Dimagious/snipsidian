import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test, ui } from "./fixtures";
import {
    beat,
    ensureVisible,
    hideSubtitle,
    injectOverlays,
    moveAndClick,
    showSubtitle,
    typeSlowly,
} from "./overlays";

/** Scene-boundary timestamps relative to the recording start
 *  (= the first call to `mark()`). Written as JSON to
 *  `$TMPDIR/snipsy-demo-marks.json` so `scripts/build-demo.sh` can
 *  delay each voice-over by the exact offset of its scene. */
const MARKS_PATH = path.join(os.tmpdir(), "snipsy-demo-marks.json");
let recordingStart = 0;
const marks: Record<string, number> = {};

function mark(name: string): void {
    const t = performance.now();
    if (recordingStart === 0) recordingStart = t;
    marks[name] = (t - recordingStart) / 1000; // seconds
    fs.writeFileSync(MARKS_PATH, JSON.stringify(marks, null, 2));
}

/**
 * README demo recording driver — eight scenes in one continuous take.
 *
 * Run modes:
 *   - `npm run demo:rehearse` — sets DEMO_REHEARSE=1 and walks the
 *     same selectors in --rehearse mode, asserting each one resolves
 *     without performing the recorded action. Use this to catch
 *     drift in the Snipsy UI before burning a video take.
 *   - `npm run demo:record` — full headed run with humanised pacing.
 *     Start your screen recorder (Cmd+Shift+5 region capture at
 *     0,0,1280,720, or run `scripts/record-demo.sh` for a ffmpeg
 *     wrapper) right after Obsidian's workspace settles.
 *
 * The fixture (see `./fixtures.ts`) reseeds the vault with a curated
 * snippet set (`:todo`, `:done`, `:callout`, `:today`, `:bold`,
 * `:table`) and resizes the Electron window to 1280×720 at (0, 0).
 *
 * Scene narration / subtitle copy is fixed in `SCENES` below — the
 * voice-over is recorded separately from this text so the two stay
 * exactly in sync.
 */

const REHEARSE = process.env.DEMO_REHEARSE === "1";

/** Pacing multiplier — bumped in rehearsal so we don't sit on
 *  unnecessary pauses while debugging selectors. */
const PACE = REHEARSE ? 0.25 : 1;
const wait = (ms: number) => Math.round(ms * PACE);

test.describe("Snipsy README demo", () => {
    test.setTimeout(REHEARSE ? 90_000 : 240_000);

    test("eight-scene continuous take", async ({ win }) => {
        // Inject overlays once up-front. Settings open/close in
        // scenes 7-8 may re-mount portions of the DOM; we re-inject
        // before each scene that needs them.
        await injectOverlays(win);
        await ui.clearEditor(win);
        await beat(win, wait(900));

        mark("scene-1");

        // ---------------------------------------------------------------
        // Scene 1 — first expansion (todo + done)
        //
        // Snipsy's engine treats `:` as a separator (delimiters.ts),
        // so triggers stored as `:todo` are unreachable through
        // keystroke expansion — the trigger candidate after a space
        // is the text BETWEEN delimiters, i.e. `todo` (no colon).
        // Seed keys therefore have no colon prefix.
        // ---------------------------------------------------------------
        await test.step("scene 1: first expansion", async () => {
            // VO: ~9.7s. Visual budget ~10.4s.
            await showSubtitle(win, "todo  →  - [ ]");
            await beat(win, wait(600));
            if (!REHEARSE) {
                await ui.typeInEditor(win, "todo ");
                await beat(win, wait(700));
                await ui.typeInEditor(win, "Buy milk");
                await win.keyboard.press("Enter");
                await beat(win, wait(1100));
            }

            await showSubtitle(win, "done  →  - [x]");
            if (!REHEARSE) {
                await ui.typeInEditor(win, "done ");
                await beat(win, wait(500));
                await ui.typeInEditor(win, "Call mom");
                await beat(win, wait(5800));
            }
            await hideSubtitle(win);
            await beat(win, wait(500));
        });

        // ---------------------------------------------------------------
        // Scene 2 — multi-line callout, cursor on line 2
        // ---------------------------------------------------------------
        await test.step("scene 2: multi-line callout", async () => {
            mark("scene-2");
            // VO: ~7s. Visual budget ~7.7s.
            await ui.clearEditor(win);
            await showSubtitle(win, "Multi-line snippets — cursor lands where you'll type");
            await beat(win, wait(500));
            if (!REHEARSE) {
                await ui.typeInEditor(win, "callout ");
                await beat(win, wait(1300));
                await ui.typeInEditor(win, "Deadline on Friday");
                await beat(win, wait(4400));
            }
            await hideSubtitle(win);
            await beat(win, wait(500));
        });

        // ---------------------------------------------------------------
        // Scene 3 — markdown-aware: no expansion inside code fence
        // ---------------------------------------------------------------
        await test.step("scene 3: markdown-aware", async () => {
            mark("scene-3");
            // VO: ~8.1s. Visual budget ~8.8s.
            await ui.clearEditor(win);
            await showSubtitle(win, "Inside code or YAML? Snipsy stays silent.");
            await beat(win, wait(400));
            if (!REHEARSE) {
                // Inside a fenced code block — trigger must NOT fire.
                await ui.typeInEditor(win, "```");
                await win.keyboard.press("Enter");
                await ui.typeInEditor(win, "todo ");
                await beat(win, wait(2400));

                // Walk back outside the fence and try again — fires.
                await win.keyboard.press("ArrowDown");
                await win.keyboard.press("ArrowDown");
                await win.keyboard.press("End");
                await win.keyboard.press("Enter");
                await ui.typeInEditor(win, "todo Outside the fence");
                await beat(win, wait(4400));
            }
            await hideSubtitle(win);
            await beat(win, wait(500));
        });

        // ---------------------------------------------------------------
        // Scene 4 — variables ($date)
        // ---------------------------------------------------------------
        await test.step("scene 4: variables", async () => {
            mark("scene-4");
            // VO: ~6.5s. Visual budget ~7.2s.
            await ui.clearEditor(win);
            await showSubtitle(win, "today  →  $date   (always current)");
            await beat(win, wait(500));
            if (!REHEARSE) {
                await ui.typeInEditor(win, "today ");
                await beat(win, wait(1300));
                await ui.typeInEditor(win, " — daily journal entry");
                await beat(win, wait(3900));
            }
            await hideSubtitle(win);
            await beat(win, wait(500));
        });

        // Scenes 5 (picker) and 6 (wrap-selection) intentionally
        // skipped in the README demo — `SnippetPickerModal` currently
        // ships without CSS rules for its result rows, so the picker
        // renders as a vertical textdump. Tracked as B-115 in
        // .claude/brain/backlog.md. Re-introduce these scenes once
        // the picker is styled.

        // ---------------------------------------------------------------
        // Scene 7 — add a custom snippet from Settings
        // ---------------------------------------------------------------
        await test.step("scene 7: add custom snippet", async () => {
            mark("scene-5");
            await showSubtitle(win, "Settings → Snipsy → Add snippet");

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
            await injectOverlays(win); // Settings re-mount may tear them off
            await beat(win, wait(700));

            if (REHEARSE) {
                await ensureVisible(
                    win,
                    'button[role="tab"][id="snipsy-tab-snippets"]',
                    "Snippets tab",
                );
                await ensureVisible(
                    win,
                    'button[aria-label="Add snippet"], button:has-text("Add snippet")',
                    "Add snippet toolbar button",
                );
            } else {
                // Make sure we're on the Snippets tab — it's the
                // landing tab in 1.1.0+, but pristine state is good
                // to assert.
                const snippetsTab = win.locator(
                    'button[role="tab"][id="snipsy-tab-snippets"]',
                );
                if (await snippetsTab.isVisible().catch(() => false)) {
                    const isActive = await snippetsTab.getAttribute("aria-selected");
                    if (isActive !== "true") {
                        await moveAndClick(win, snippetsTab, "Snippets tab", {
                            postClickDelay: 500,
                        });
                    }
                }

                const addBtn = win
                    .getByRole("button", { name: "Add snippet" })
                    .first();
                await moveAndClick(win, addBtn, "toolbar Add snippet", {
                    postClickDelay: 700,
                });

                const triggerInput = win.getByRole("textbox", {
                    name: "Example: :hello",
                });
                await typeSlowly(win, triggerInput, "sig", "trigger input");

                const replacementInput = win.getByRole("textbox", {
                    name: "Example: hello, world!",
                });
                await typeSlowly(
                    win,
                    replacementInput,
                    "Best,\nDmitriy",
                    "replacement input",
                    30,
                );
                await beat(win, wait(500));

                const submit = win
                    .getByRole("button", { name: "Add snippet" })
                    .nth(1);
                await moveAndClick(win, submit, "modal Add snippet submit", {
                    postClickDelay: 800,
                });

                // Close Settings and demonstrate the new trigger.
                await win.keyboard.press("Escape");
                await beat(win, wait(700));
                await injectOverlays(win);
                await ui.clearEditor(win);
                await ui.typeInEditor(win, "sig ");
                await beat(win, wait(1100));
            }
            await hideSubtitle(win);
            await beat(win, wait(400));
        });

        // ---------------------------------------------------------------
        // Scene 8 — tab tour: Snippets → Packages → General → About
        //
        // One-line marketing subtitle per tab. The viewer's already
        // seen Snippets in scene 7; we revisit briefly so the tour
        // feels complete, then move through the rest.
        // ---------------------------------------------------------------
        await test.step("scene 8: tab tour", async () => {
            mark("scene-6");
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
            await injectOverlays(win);
            await beat(win, wait(700));

            const tabs: Array<{ id: string; label: string; subtitle: string }> = [
                {
                    id: "snipsy-tab-snippets",
                    label: "Snippets tab",
                    subtitle: "Snippets — manage, group, search your library",
                },
                {
                    id: "snipsy-tab-packages",
                    label: "Packages tab",
                    subtitle: "Packages — community catalog + Espanso import",
                },
                {
                    id: "snipsy-tab-general",
                    label: "General tab",
                    subtitle: "General — hotkeys, backup, export / import",
                },
                {
                    id: "snipsy-tab-about",
                    label: "About tab",
                    subtitle: "About — docs, feedback, community",
                },
            ];

            // VO: ~12.1s. Visual budget ~12.8s. Per-tab dwell ~2.8s
            // (postClickDelay 700 + beat 2100) × 4 tabs = 11.2s, plus
            // setup overhead.
            for (const tab of tabs) {
                const btn = win.locator(`button[role="tab"][id="${tab.id}"]`);
                if (REHEARSE) {
                    await ensureVisible(win, btn, tab.label);
                    continue;
                }
                await showSubtitle(win, tab.subtitle);
                await moveAndClick(win, btn, tab.label, {
                    postClickDelay: 700,
                });
                await beat(win, wait(2100));
            }

            await hideSubtitle(win);
            await beat(win, wait(400));

            // Close Settings to return to the editor for the tail.
            if (!REHEARSE) {
                await win.keyboard.press("Escape");
                await beat(win, wait(700));
            }
        });

        // ---------------------------------------------------------------
        // Final beat: hold on the editor so the outro VO (~2.9s) has
        // somewhere to play before the outro card cuts in.
        // ---------------------------------------------------------------
        mark("scene-end");
        await beat(win, wait(3500));
        mark("recording-end");
    });
});
