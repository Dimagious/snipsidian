import type { Locator, Page } from "@playwright/test";
import type { DemoHelpers, ObsidianHelpers } from "obsidian-plugin-dev-kit/e2e";
import { APPEARANCE_PATH, CAPTURE_NOW, DATA_PATH, appearanceFile, dataJson, libraryForStills } from "./capture-data";
import { stills } from "./capture-fixtures";

const { test, expect, onlyWhen } = stills;

/**
 * The site pictures: 9 screens in a light and a dark take, 18 files in `site/img`.
 *
 * Taken from the running plugin, never from a mock, on the library in `capture-data.ts` and on the day in
 * `CAPTURE_NOW`. `demo.still` writes the PNGs to `.opdk/demo/stills` at 2x on any display, and `opdk demo`
 * publishes them to `site/img` (`demo.outputs.site` in `opdk.config.mjs`). Run on demand: `npm run capture`.
 */

onlyWhen("CAPTURE");
test.setTimeout(120_000);
// A take that fails its own theme check (below) is thrown away and taken again.
test.describe.configure({ retries: 3 });

/** 2x on any display, the page settled, no cursor arrow in the picture. */
const STILL = { settle: true, cursor: false, out: "site" } as const;

type Mode = "light" | "dark";
const BOTH: Mode[] = ["light", "dark"];

type Box = { x: number; y: number; width: number; height: number };


/** The window on the capture day, the theme the scene sets next and no notice on screen. */
async function setUp(obsidian: ObsidianHelpers, demoFreeze: (date: string) => Promise<void>): Promise<void> {
    await demoFreeze(CAPTURE_NOW);
    await obsidian.reload();
    await obsidian.clearNotices();
}

/** Waits until the open dialog is painted in `mode`. The theme class on the page is set at once, but Obsidian was seen
 *  to fall back to the system theme when its window took focus, and a dialog was drawn light in a dark take. So the
 *  colour itself is read, not the class. */
async function paintedAs(win: Page, mode: Mode): Promise<void> {
    await expect
        .poll(
            () =>
                win.evaluate(() => {
                    const el = document.querySelector(".modal") ?? document.body;
                    const [r = 0, g = 0, b = 0] = getComputedStyle(el).backgroundColor.match(/\d+(\.\d+)?/g)?.map(Number) ?? [];
                    return (r + g + b) / 3 < 128 ? "dark" : "light";
                }),
            { message: `the dialog was not painted in the ${mode} theme` },
        )
        .toBe(mode);
}

type StillOptions = Parameters<DemoHelpers["still"]>[1];

/** One picture: no notice on screen, the theme of the take read back before the shutter and after it. */
function shooter(win: Page, obsidian: ObsidianHelpers, demo: DemoHelpers) {
    return async (name: string, mode: Mode, options: StillOptions): Promise<void> => {
        await obsidian.clearNotices();
        await paintedAs(win, mode);
        await demo.still(name, options);
        await paintedAs(win, mode);
    };
}

/** The smallest box that holds every locator. */
async function union(...locators: Locator[]): Promise<Box> {
    const boxes: Box[] = [];
    for (const locator of locators) {
        const box = await locator.boundingBox();
        if (!box) throw new Error("capture: an element to clip to is not visible");
        boxes.push(box);
    }
    const x = Math.min(...boxes.map((b) => b.x));
    const y = Math.min(...boxes.map((b) => b.y));
    const right = Math.max(...boxes.map((b) => b.x + b.width));
    const bottom = Math.max(...boxes.map((b) => b.y + b.height));
    return { x, y, width: right - x, height: bottom - y };
}

/** A settings page from the top of its title bar to the bottom of `last`, as wide as its first card plus a margin: a
 *  picture of the page without the modal's frame, its close button or the note behind it. */
async function pageRegion(page: Locator, last: Locator): Promise<Box> {
    const [bar, card, end] = await Promise.all([
        page.locator(".setting-page-titlebar").boundingBox(),
        page.locator(".setting-page-content > *").first().boundingBox(),
        last.boundingBox(),
    ]);
    if (!bar || !card || !end) throw new Error("capture: the settings page is not visible");
    const margin = 12;
    return { x: card.x - margin, y: bar.y, width: card.width + 2 * margin, height: end.y + end.height - bar.y };
}

/** Opens a page of Snipsy's settings from the root list (Obsidian 1.13 and later: a row with a chevron). */
async function openSettingsPage(win: Page, name: "Snippets" | "Packages" | "Patterns"): Promise<void> {
    await win.locator(".setting-item.mod-navigable", { hasText: name }).first().click();
    const marker = { Snippets: "Add snippet", Packages: "Community packages", Patterns: "Add rule" }[name];
    await expect(win.locator(".vertical-tab-content").getByText(marker).first()).toBeVisible();
}

/** The Espanso file of the import picture: four matches, one of them a form, which the plugin leaves out. */
const ESPANSO_YAML = `matches:
  - trigger: ":sig"
    replace: "Best,\\nDmitriy$|$"
  - trigger: ":paste"
    replace: "> {{clipboard}}"
  - trigger: ":ymd"
    replace: "{{d}}"
    vars:
      - name: d
        type: date
        params:
          format: "%Y-%m-%d"
  - trigger: ":ask"
    form: "Hi [[name]]"
`;

/** One Obsidian per theme. The theme is also written to the vault's `appearance.json`, so a window that falls back to
 *  the system theme when it takes focus (seen with the machine's own user at the keyboard) still reads the take's. */
for (const mode of BOTH) {
    test.describe(`${mode} theme`, () => {
        test.use({
            seed: {
                files: {
                    [DATA_PATH]: dataJson(libraryForStills()),
                    [APPEARANCE_PATH]: appearanceFile(mode),
                },
            },
        });

    test("picker", async ({ win, obsidian, demo }) => {
        const shoot = shooter(win, obsidian, demo);
        await setUp(obsidian, (date) => demo.freezeTime(date));
        await demo.cleanUi();
        await demo.themes([mode], async () => {
            await obsidian.settle();
            await obsidian.runCommand("snipsidian:insert-snippet");
            const modal = win.locator(".modal", { has: win.locator(".snippet-picker-modal") });
            const filter = win.locator(".snippet-picker-modal input[role='combobox']");
            await expect(filter).toBeVisible();
            await filter.fill("da");
            await expect(win.locator(".snippet-picker-modal .snippet-item[aria-selected='true'] .snippet-name")).toHaveText("today");
            await expect(win.locator(".snippet-picker-modal .snippet-item")).toHaveCount(7);
            await shoot("picker", mode, { clip: modal, padding: 24, ...STILL });
            await win.keyboard.press("Escape");
            await expect(win.locator(".snippet-picker-modal")).toHaveCount(0);
        });
    });

    test("settings: root and prefix", async ({ app, win, obsidian, demo }) => {
        const shoot = shooter(win, obsidian, demo);
        await setUp(obsidian, (date) => demo.freezeTime(date));
        // The Expansion group has six rows now and does not fit the usual 800 px: a taller window keeps the whole
        // group inside the dialog, so the picture shows no edge of it.
        await app.evaluate(({ BrowserWindow }) => {
            BrowserWindow.getAllWindows()[0]?.setContentSize(1200, 1100);
        });
        await expect.poll(() => win.evaluate(() => window.innerHeight)).toBe(1100);
        await demo.themes([mode], async () => {
            const content = await obsidian.openSettings("snipsidian");
            await paintedAs(win, mode);
            await obsidian.settle();
            const entries = content.locator(".setting-group").first();
            const expansion = content.locator(".setting-group.snipsy-expansion");
            // The prefix switch, not the first one: Expand while typing and Expand on Tab come before it.
            const toggle = expansion.locator(".setting-item.mod-toggle", { hasText: "Require a prefix before triggers" }).locator(".checkbox-container");
            // Off first, as it ships.
            await expect(toggle).not.toHaveClass(/is-enabled/);
            await shoot("settings-root", mode, { clip: await union(entries, expansion), padding: 8, ...STILL });
            await toggle.click();
            await expect(toggle).toHaveClass(/is-enabled/);
            await shoot("prefix", mode, { clip: await union(expansion), padding: 8, ...STILL });
            // Back to the shipped state for the other theme.
            await toggle.click();
            await expect(toggle).not.toHaveClass(/is-enabled/);
            await obsidian.closeSettings();
        });
    });

    test("settings: Snippets page, groups and Add snippet", async ({ win, obsidian, demo }) => {
        const shoot = shooter(win, obsidian, demo);
        await setUp(obsidian, (date) => demo.freezeTime(date));
        await demo.themes([mode], async () => {
            await obsidian.openSettings("snipsidian");
            await paintedAs(win, mode);
            await openSettingsPage(win, "Snippets");
            await obsidian.settle();
            const page = win.locator(".setting-page.vertical-tab-content");

            await page.getByRole("button", { name: "Select snippets" }).click();
            await page.getByRole("button", { name: "Expand group Callouts" }).click();
            await page.getByRole("button", { name: "Expand group Meetings" }).click();
            for (const trigger of ["1on1", "ai", "dec"]) {
                await page.locator(`[aria-label="Select snippet ${trigger}"]`).click();
            }
            await expect(page.getByText("3 selected")).toBeVisible();
            await obsidian.settle();
            const lastRow = page.locator(".snippet-row", { hasText: "Decision" });
            // No row under the mouse: its hover buttons would be in the picture.
            await win.mouse.move(2, 2);
            await obsidian.settle();
            await shoot("groups", mode, { clip: await pageRegion(page, lastRow), ...STILL });

            // Leave selection mode, collapse again, and open the dialog.
            await page.getByRole("button", { name: "Done selecting" }).click();
            await page.getByRole("button", { name: "Collapse group Callouts" }).click();
            await page.getByRole("button", { name: "Collapse group Meetings" }).click();
            await page.getByRole("button", { name: "Add snippet" }).first().click();
            const modal = win.locator(".modal", { has: win.getByRole("textbox", { name: "Example: brb" }) });
            await win.getByRole("textbox", { name: "Example: brb" }).fill(":sig");
            await win.getByRole("textbox", { name: "Example: hello, world!" }).fill("Best,\nDmitriy");
            await modal.locator(".setting-item", { hasText: "Group" }).locator("input").fill("work");
            await expect(modal.getByText("Will expand when you type: sig")).toBeVisible();
            await shoot("add-snippet", mode, { clip: modal, padding: 24, ...STILL });
            await modal.getByRole("button", { name: "Cancel" }).click();
            await expect(modal).toHaveCount(0);
            await obsidian.closeSettings();
        });
    });

    test("settings: Patterns page, Try it on 1/23", async ({ win, obsidian, demo }) => {
        const shoot = shooter(win, obsidian, demo);
        await setUp(obsidian, (date) => demo.freezeTime(date));
        await demo.themes([mode], async () => {
            await obsidian.openSettings("snipsidian");
            await paintedAs(win, mode);
            await openSettingsPage(win, "Patterns");
            await obsidian.settle();
            const page = win.locator(".setting-page.vertical-tab-content");
            await expect(page.locator(".snipsy-pattern-row")).toHaveCount(32);

            // The first rule, 1/2, fires after a separator. Open it and try Instant: Try it shows why that fires early.
            await page.locator(".snipsy-pattern-row").first().locator(".snipsy-pattern-main").click();
            const editor = page.locator(".snipsy-pattern-editor");
            await expect(editor).toBeVisible();
            await editor.getByLabel("Fires", { exact: true }).selectOption("instant");
            await editor.getByLabel("Try it", { exact: true }).fill("1/23");
            await expect(editor.locator(".snipsy-tryit-result")).toHaveText("\u00bd3");
            await expect(editor.locator(".snipsy-tryit-status")).toHaveText("Fired at 1/2, before 3. To type 1/23, choose After a separator.");
            await win.mouse.move(2, 2);
            await obsidian.settle();
            // From the title bar to the bottom of the open rule.
            await shoot("patterns", mode, { clip: await pageRegion(page, page.locator(".snipsy-pattern-row.is-open")), ...STILL });

            // Nothing was saved: back to the shipped state for the other theme.
            await editor.getByRole("button", { name: "Cancel" }).click();
            await expect(editor).toHaveCount(0);
            await obsidian.closeSettings();
        });
    });

    test("settings: Packages page, conflict and Espanso import", async ({ win, obsidian, demo }) => {
        const shoot = shooter(win, obsidian, demo);
        await setUp(obsidian, (date) => demo.freezeTime(date));
        await demo.themes([mode], async () => {
            await obsidian.openSettings("snipsidian");
            await paintedAs(win, mode);
            await openSettingsPage(win, "Packages");
            await obsidian.settle();

            const page = win.locator(".setting-page.vertical-tab-content");
            const rows = page.locator(".package-row");
            await expect(rows).toHaveCount(13);

            // The top of the page: the title bar and as many whole rows as the window shows.
            const view = await page.boundingBox();
            if (!view) throw new Error("capture: the Packages page is not visible");
            let last = rows.first();
            for (let i = 0; i < 13; i++) {
                const box = await rows.nth(i).boundingBox();
                if (box && box.y + box.height <= view.y + view.height - 8) last = rows.nth(i);
            }
            await shoot("packages", mode, { clip: await pageRegion(page, last), ...STILL });

            // Reinstalling Daily Journal: its `grtd` already exists with other text.
            await rows.filter({ hasText: "Daily Journal" }).getByRole("button", { name: "Reinstall" }).click();
            const preview = win.locator(".modal", { hasText: "7 new snippets, 1 conflict" });
            await expect(preview).toBeVisible();
            await obsidian.settle();
            await shoot("conflict", mode, { clip: preview, padding: 24, ...STILL });
            await preview.getByRole("button", { name: "Cancel" }).click();
            await expect(preview).toHaveCount(0);

            // Espanso import: paste, preview, apply; the result line stays under the box.
            const group = page.locator(".setting-group:has(.snipsy-espanso-section)");
            await group.scrollIntoViewIfNeeded();
            await group.getByLabel("Group name for the imported snippets").fill("Espanso base");
            const yaml = group.getByLabel("Espanso YAML to import");
            await yaml.fill(ESPANSO_YAML);
            // The box is a few lines high, as the plugin draws it; stretch it as a user does with its corner handle so the
            // whole file shows, and read it from the first line.
            await yaml.evaluate((el: HTMLTextAreaElement) => { el.style.height = "330px"; el.scrollTop = 0; });
            await group.getByRole("button", { name: "Import snippets" }).click();
            const importPreview = win.locator(".modal", { hasText: "Import from Espanso YAML" });
            await expect(importPreview).toBeVisible();
            await importPreview.getByRole("button", { name: "Apply" }).click();
            await expect(group.locator(".snipsy-espanso-skip-status")).toContainText("3 imported, 1 skipped: ask");
            await group.evaluate((el) => el.scrollIntoView({ block: "start" }));
            await win.mouse.move(2, 2);
            await obsidian.settle();
            await shoot("espanso", mode, { clip: await union(group), padding: 8, ...STILL });
            await obsidian.closeSettings();
        });
    });
    });
}

/**
 * The pictures of the community directory listing: the whole window, dark, 2400 x 1600 (the directory shows 3:2).
 * `opdk demo` copies them to `docs/listing` (`demo.outputs.listing`); the listing itself is updated by hand.
 */
test.describe("listing", () => {
    const mode: Mode = "dark";
    test.use({
        seed: {
            files: {
                [DATA_PATH]: dataJson(libraryForStills()),
                [APPEARANCE_PATH]: appearanceFile(mode),
            },
            // The note starts with its own heading: Obsidian's inline title above it would show the name twice.
            config: { showInlineTitle: false },
        },
    });
    const WINDOW = { settle: true, cursor: false, out: "listing" } as const;

    test("listing: note, picker, settings, Snippets and Packages", async ({ win, obsidian, demo }) => {
        const shoot = shooter(win, obsidian, demo);
        await setUp(obsidian, (date) => demo.freezeTime(date));
        await demo.themes([mode], async () => {
            await obsidian.openFile("Weekly sync.md");
            await expect(win.locator(".markdown-source-view .callout").first()).toBeVisible();
            await win.mouse.move(2, 2);
            await obsidian.settle();
            await shoot("listing-1-note", mode, WINDOW);

            await obsidian.runCommand("snipsidian:insert-snippet");
            const filter = win.locator(".snippet-picker-modal input[role='combobox']");
            await expect(filter).toBeVisible();
            await filter.fill("dj");
            await expect(win.locator(".snippet-picker-modal .snippet-item[aria-selected='true'] .snippet-name")).toHaveText("dj");
            await shoot("listing-2-picker", mode, WINDOW);
            await win.keyboard.press("Escape");
            await expect(win.locator(".snippet-picker-modal")).toHaveCount(0);

            await obsidian.openSettings("snipsidian");
            await paintedAs(win, mode);
            await obsidian.settle();
            await shoot("listing-3-settings", mode, WINDOW);

            await openSettingsPage(win, "Snippets");
            const page = win.locator(".setting-page.vertical-tab-content");
            await page.getByRole("button", { name: "Expand group Journal" }).click();
            await page.getByRole("button", { name: "Expand group Meetings" }).click();
            await win.mouse.move(2, 2);
            await obsidian.settle();
            await shoot("listing-4-snippets", mode, WINDOW);
            await obsidian.closeSettings();

            await obsidian.openSettings("snipsidian");
            await paintedAs(win, mode);
            await openSettingsPage(win, "Packages");
            await expect(win.locator(".setting-page.vertical-tab-content .package-row")).toHaveCount(13);
            await win.mouse.move(2, 2);
            await obsidian.settle();
            await shoot("listing-5-packages", mode, WINDOW);
            await obsidian.closeSettings();
        });
    });
});
