import type { ElectronApplication, Locator, Page } from "@playwright/test";
import type { DemoHelpers, ObsidianHelpers } from "obsidian-plugin-dev-kit/e2e";
import { APPEARANCE_PATH, CAPTURE_NOW, DATA_PATH, appearanceFile, dataJson, libraryOfDefaults } from "./capture-data";
import { desktopFilms } from "./capture-fixtures";

const { test, expect, onlyWhen } = desktopFilms;

/**
 * The README film of the Patterns page: add the typography set, then type `1/2` and `-->` in a note. A silent film of
 * stills in the real Obsidian (dark theme, one caption bar under each step). `opdk demo patterns` encodes it to
 * `docs/screens/patterns.gif` (and the MP4 and poster of the site, see `opdk.config.mjs`). Run on demand:
 * `npm run build && CAPTURE=1 npx playwright test e2e/film-patterns.spec.ts && npx opdk demo`.
 */

onlyWhen("CAPTURE");
test.setTimeout(180_000);
// A film whose frames came out in the wrong theme fails and is recorded again.
test.describe.configure({ retries: 3 });

interface Scene {
    app: ElectronApplication;
    win: Page;
    obsidian: ObsidianHelpers;
    demo: DemoHelpers;
}

type Film = ReturnType<DemoHelpers["film"]>;

function editorOf(win: Page): Locator {
    return win.locator(".cm-content[contenteditable=true]").first();
}

/** Sets the content size of the window and waits until the page reports it. */
async function resize(scene: Scene, size: { width: number; height: number }): Promise<void> {
    await scene.app.evaluate(({ BrowserWindow }, s) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(s.width, s.height);
    }, size);
    await expect.poll(() => scene.win.evaluate(() => [window.innerWidth, window.innerHeight])).toEqual([size.width, size.height]);
}

/** A frame, after checking the window is still dark: Obsidian was seen to fall back to the system theme. */
async function frame(scene: Scene, film: Film, hold: number): Promise<void> {
    await expect(scene.win.locator("body")).toHaveClass(/theme-dark/);
    await film.shot({ hold, settle: true });
}

/** Types `text` in chunks of `step` characters and takes a frame after each, so a GIF shows the typing. */
async function typeFrames(scene: Scene, film: Film, text: string, step = 3, hold = 0.3): Promise<void> {
    for (let i = 0; i < text.length; i += step) {
        await scene.demo.typeSlowly(text.slice(i, i + step));
        await frame(scene, film, hold);
    }
}

/** The note opens with a heading so the eye lands on it; the typed lines follow under it. */
const NOTE_HEAD = "# Typography\n\n";
/** The note text is large (the settings keep their own UI font size, `--font-text-size` only touches the editor). */
const NOTE_FONT_SIZE = "30px";

async function cursorToEnd(win: Page): Promise<void> {
    await win.keyboard.press(process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End");
}

test.describe("patterns", () => {
    test.use({ seed: { files: { [DATA_PATH]: dataJson(libraryOfDefaults()), [APPEARANCE_PATH]: appearanceFile("dark"), "Scratch.md": NOTE_HEAD } } });

    test("patterns: add the typography set, then type 1/2 and -->", async ({ app, win, obsidian, demo }) => {
        const scene = { app, win, obsidian, demo };
        await resize(scene, { width: 800, height: 500 });
        await demo.freezeTime(CAPTURE_NOW);
        await obsidian.setTheme({ mode: "dark" });
        await obsidian.openFile("Scratch.md", { mode: "live" });
        await demo.cleanUi();
        await obsidian.clearNotices();
        await win.evaluate((size) => activeDocument.body.style.setProperty("--font-text-size", size), NOTE_FONT_SIZE);
        await demo.moveAndClick(editorOf(win));
        await cursorToEnd(win);
        await demo.hideCursor();
        const film = demo.film({ name: "patterns", kind: "desktop", cursor: false });
        await frame(scene, film, 0.9);

        demo.caption("Patterns > Add typography set");
        await obsidian.openSettings("snipsidian");
        await win.locator(".setting-item.mod-navigable", { hasText: "Patterns" }).first().click();
        const add = win.getByRole("button", { name: "Add typography set" });
        await expect(add).toBeVisible();
        await frame(scene, film, 1.8);
        await demo.moveAndClick(add);
        await expect(win.locator(".snipsy-pattern-row")).toHaveCount(32);
        await obsidian.clearNotices();
        await win.mouse.move(2, 2);
        await demo.hideCursor();
        demo.caption("32 rules: fractions, arrows, comparisons");
        await frame(scene, film, 2.2);

        await obsidian.closeSettings();
        await demo.moveAndClick(editorOf(win));
        await cursorToEnd(win);
        await demo.hideCursor();
        demo.caption("1/2 + space  ->  a half");
        await typeFrames(scene, film, "1/2", 3, 0.6);
        await typeFrames(scene, film, " ", 1, 1.6);
        await expect.poll(() => obsidian.editor().text()).toBe(`${NOTE_HEAD}½ `);

        await win.keyboard.press("Enter");
        await expect.poll(() => obsidian.editor().text()).toBe(`${NOTE_HEAD}½ \n`);
        demo.caption("--> turns into an arrow at once");
        await typeFrames(scene, film, "a ", 2, 0.4);
        await typeFrames(scene, film, "--", 2, 0.5);
        await typeFrames(scene, film, ">", 1, 1.0);
        await typeFrames(scene, film, " b", 2, 2.4);
        await expect.poll(() => obsidian.editor().text()).toBe(`${NOTE_HEAD}½ \na → b`);
    });
});
