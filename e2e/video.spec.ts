import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { createObsidianTest } from "obsidian-plugin-dev-kit/e2e";
import type { AppWithInternals, ObsidianHelpers } from "obsidian-plugin-dev-kit/e2e";
import { defaultSnippetsAsGroup } from "../src/store/presets";
import { APPEARANCE_PATH, DATA_PATH, TEXT_SNIPPETS_PATH, appearanceFile, catalogCache, dataJson } from "./capture-data";

/**
 * Clips for the YouTube overview (`.claude/brain/video-storyboard.md`): one continuous screen recording of the real
 * plugin in a real Obsidian per scene. Off unless VIDEO=1 (`VIDEO=1 npx playwright test e2e/video.spec.ts -c
 * playwright.video.config.ts`). Clips go to `out/video/clips` (not committed); `.claude/tools/video/assemble.sh` fits
 * them to the voice, adds subtitles and joins them.
 */
const { test, expect, onlyWhen } = createObsidianTest({ seedVault: "e2e/capture-vault", window: { width: 1152, height: 648 } });
onlyWhen("VIDEO");

const OUT = path.resolve(import.meta.dirname, "..", "out", "video", "clips");
const NOW = "2026-11-05T14:05:00";
const SIZE = { width: 1152, height: 648 };

test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);
test.beforeAll(() => fs.mkdirSync(OUT, { recursive: true }));

const g = (name: string, s: Record<string, string>): Record<string, string> =>
    Object.fromEntries(Object.entries(s).map(([k, v]) => [`${name}/${k}`, v]));

const LIBRARY = {
    snippets: {
        ...defaultSnippetsAsGroup(),
        ...g("mine", {
            "->": "→",
            day: "{{date:dddd, D MMMM}}",
            sync: "Meeting with $1 at $2 about $3$|",
        }),
        ...g("work", {
            meeting: "# Meeting $date\n\n**Attendees:** $|\n\n**Notes:**\n- ",
            "meet-1on1": "## 1:1 $date\n- Wins: $|\n- Blockers:",
            "meet-retro": "## Retro $date\n**Went well:** $|\n**To change:** ",
        }),
    },
    communityPackages: catalogCache(),
};

const TEXT_SNIPPETS = JSON.stringify({ snippets_file: ["sig : Best,$nl$Dmitriy", "прив : Привет!", "lgtm : Looks good to me"].join("\n") });

test.use({
    seed: {
        files: {
            [DATA_PATH]: dataJson(LIBRARY as never),
            [APPEARANCE_PATH]: JSON.stringify({ ...JSON.parse(appearanceFile("dark")) as object, baseFontSize: 24 }),
            [TEXT_SNIPPETS_PATH]: TEXT_SNIPPETS,
        },
    },
});

type EditorApp = AppWithInternals & {
    workspace: { activeEditor?: { editor?: { setValue(v: string): void; setCursor(p: { line: number; ch: number }): void; lineCount(): number; getLine(n: number): string; focus(): void } } };
};

/** Replaces the note's text and puts the caret at the end, or at (line, ch). */
async function setDoc(obsidian: ObsidianHelpers, text: string, at?: { line: number; ch: number }): Promise<void> {
    await obsidian.evaluate((app: EditorApp, arg: { text: string; at?: { line: number; ch: number } }) => {
        const ed = app.workspace.activeEditor?.editor;
        if (!ed) throw new Error("no active editor");
        ed.setValue(arg.text);
        const last = ed.lineCount() - 1;
        ed.setCursor(arg.at ?? { line: last, ch: ed.getLine(last).length });
        ed.focus();
    }, { text, at });
}

/** Appends text to the note and puts the caret at (end - back lines). */
async function append(obsidian: ObsidianHelpers, text: string, backLines = 0): Promise<void> {
    await obsidian.evaluate((app: EditorApp, arg: { text: string; back: number }) => {
        const ed = app.workspace.activeEditor?.editor;
        if (!ed) throw new Error("no active editor");
        const all = Array.from({ length: ed.lineCount() }, (_, i) => ed.getLine(i)).join("\n");
        ed.setValue(all + arg.text);
        const line = ed.lineCount() - 1 - arg.back;
        ed.setCursor({ line, ch: ed.getLine(line).length });
        ed.focus();
    }, { text, back: backLines });
}

async function record(win: Page, name: string, take: () => Promise<void>): Promise<void> {
    await win.screencast.start({ path: path.join(OUT, `${name}.webm`), size: SIZE, quality: 95 });
    try {
        await take();
    } finally {
        await win.screencast.stop();
    }
}

async function stage(win: Page, obsidian: ObsidianHelpers, demo: { freezeTime(d: string): Promise<void>; cleanUi(): Promise<void> }): Promise<void> {
    await win.setViewportSize(SIZE);
    await demo.freezeTime(NOW);
    await obsidian.openFile("Scratch.md");
    await demo.cleanUi();
    await obsidian.hideProperties();
    await win.addStyleTag({ content: ".markdown-source-view.mod-cm6 .cm-scroller { padding-top: 90px !important; } .modal-container { align-items: flex-start !important; padding-top: 48px !important; }" });
    await setDoc(obsidian, "");
}

async function openPage(win: Page, obsidian: ObsidianHelpers, name: "Packages" | null): Promise<void> {
    await obsidian.openSettings("snipsidian");
    if (name) {
        await win.locator(".setting-item.mod-navigable", { hasText: name }).first().click();
        await expect(win.locator(".vertical-tab-content").getByText("Community packages").first()).toBeVisible();
    }
}

async function toggle(win: Page, name: string): Promise<void> {
    const row = win.locator(".setting-item", { has: win.locator(".setting-item-name", { hasText: name }) }).first();
    await row.scrollIntoViewIfNeeded();
    await row.locator(".checkbox-container").click();
}

test("scene 1: what it is", async ({ win, obsidian, demo }) => {
    await stage(win, obsidian, demo);
    await record(win, "scene-1", async () => {
        await demo.beat(1.5);
        await demo.typeSlowly("todo ", { delayMs: 110 });
        await demo.beat(0.8);
        await demo.typeSlowly("Call Sam on ", { delayMs: 70 });
        await demo.typeSlowly("today ", { delayMs: 110 });
        await expect.poll(() => obsidian.editor().text()).toContain("- [ ] Call Sam on 2026-11-05");
        await demo.beat(5);
    });
});

test("scene 2: it knows Markdown", async ({ win, obsidian, demo }) => {
    await stage(win, obsidian, demo);
    await record(win, "scene-2", async () => {
        await demo.beat(0.8);
        await demo.typeSlowly("h2 ", { delayMs: 110 });
        await demo.typeSlowly("Trip", { delayMs: 70 });
        await demo.beat(1.2);
        await append(obsidian, "\n");
        await demo.typeSlowly("note ", { delayMs: 110 });
        await demo.beat(0.6);
        await demo.typeSlowly("Bring the charger", { delayMs: 60 });
        await demo.beat(1.2);
        await append(obsidian, "\n\n```\n\n```", 1);
        await demo.beat(1);
        await demo.typeSlowly("todo ", { delayMs: 140 });
        await expect.poll(() => obsidian.editor().text()).toContain("```\ntodo \n```");
        await demo.beat(2.5);
        await append(obsidian, "\n\n");
        await demo.typeSlowly("table ", { delayMs: 110 });
        await demo.beat(4);
    });
});

test("scene 3: your own snippets", async ({ win, obsidian, demo }) => {
    await stage(win, obsidian, demo);
    await setDoc(obsidian, "Best,\nDmitriy");
    await record(win, "scene-3", async () => {
        await demo.beat(0.8);
        await obsidian.press("Mod+A");
        await demo.beat(0.6);
        await obsidian.runCommand("snipsidian:add-snippet-from-selection");
        const modal = win.locator(".modal", { hasText: "Trigger" }).last();
        await expect(modal).toBeVisible();
        await demo.beat(0.8);
        await demo.typeSlowly(modal.locator("input[type=text]").first(), "sig", { delayMs: 140 });
        await demo.beat(0.6);
        await demo.moveAndClick(modal.getByRole("button", { name: "Add snippet" }));
        await expect(modal).toHaveCount(0);
        await setDoc(obsidian, "");
        await demo.beat(0.5);
        await demo.typeSlowly("sig ", { delayMs: 130 });
        await expect.poll(() => obsidian.editor().text()).toContain("Dmitriy");
        await demo.beat(1.2);
        await append(obsidian, "\n\n");
        await demo.typeSlowly("Berlin -> ", { delayMs: 110 });
        await demo.typeSlowly("Prague", { delayMs: 70 });
        await demo.beat(1.2);
        await append(obsidian, "\n\n");
        await demo.typeSlowly("day ", { delayMs: 130 });
        await expect.poll(() => obsidian.editor().text()).toContain("Thursday, 5 November");
        await demo.beat(3);
    });
});

test("scene 4: fields you fill with Tab", async ({ win, obsidian, demo }) => {
    await stage(win, obsidian, demo);
    await record(win, "scene-4", async () => {
        await demo.beat(1.5);
        await demo.typeSlowly("sync ", { delayMs: 130 });
        await demo.beat(1.8);
        await demo.typeSlowly("Bob", { delayMs: 140 });
        await demo.beat(0.6);
        await obsidian.press("Tab");
        await demo.beat(0.6);
        await demo.typeSlowly("5pm", { delayMs: 140 });
        await demo.beat(0.6);
        await obsidian.press("Tab");
        await demo.beat(0.6);
        await demo.typeSlowly("budget", { delayMs: 120 });
        await demo.beat(1.2);
        await obsidian.press("Shift+Tab");
        await demo.beat(1.5);
        await obsidian.press("Tab");
        await obsidian.press("Tab");
        await expect.poll(() => obsidian.editor().text()).toContain("Meeting with Bob at 5pm about budget");
        await demo.beat(3.5);
        await append(obsidian, "\n\n");
        await demo.typeSlowly("brb", { delayMs: 140 });
        await demo.beat(0.8);
        const palette = await obsidian.openCommandPalette();
        await demo.typeSlowly(palette, "Expand trigger", { delayMs: 90 });
        await demo.beat(1.2);
        await obsidian.press("Enter");
        await expect.poll(() => obsidian.editor().text()).toContain("be right back");
        await demo.beat(4);
    });
});

test("scene 5: find and install", async ({ win, obsidian, demo }) => {
    await stage(win, obsidian, demo);
    await record(win, "scene-5", async () => {
        await demo.beat(0.8);
        await obsidian.runCommand("snipsidian:insert-snippet");
        const search = win.getByRole("combobox", { name: "Search snippet" });
        await expect(search).toBeVisible();
        await demo.typeSlowly(search, "meet", { delayMs: 160 });
        await demo.beat(2.5);
        await obsidian.press("Enter");
        await demo.beat(2);
        await openPage(win, obsidian, "Packages");
        await demo.beat(1.5);
        const install = win.getByRole("button", { name: "Install Meetings", exact: true });
        await install.scrollIntoViewIfNeeded();
        await demo.beat(0.8);
        await demo.moveAndClick(install);
        const preview = win.locator(".modal", { hasText: "new snippet" }).last();
        await expect(preview).toBeVisible();
        await demo.beat(2.5);
        await demo.moveAndClick(preview.getByRole("button", { name: "Apply" }));
        await demo.beat(3);
    });
});

test("scene 6: coming from Text Snippets", async ({ win, obsidian, demo }) => {
    await stage(win, obsidian, demo);
    await record(win, "scene-6", async () => {
        await demo.beat(0.5);
        await openPage(win, obsidian, "Packages");
        const button = win.getByRole("button", { name: "Import snippets from the Text Snippets plugin" });
        await button.scrollIntoViewIfNeeded();
        await demo.beat(2);
        await demo.moveAndClick(button);
        const preview = win.locator(".modal", { hasText: "Import from Text Snippets" }).last();
        await expect(preview).toBeVisible();
        await demo.beat(3);
        await demo.moveAndClick(preview.getByRole("button", { name: "Apply" }));
        await demo.beat(1.5);
        await obsidian.closeSettings();
        await setDoc(obsidian, "");
        await demo.beat(0.5);
        await demo.typeSlowly("sig ", { delayMs: 140 });
        await demo.beat(1.2);
        await append(obsidian, "\n\n");
        await demo.typeSlowly("прив ", { delayMs: 150 });
        await expect.poll(() => obsidian.editor().text()).toContain("Привет!");
        await demo.beat(4);
    });
});

test("scene 7: no surprises", async ({ win, obsidian, demo }) => {
    await stage(win, obsidian, demo);
    await record(win, "scene-7", async () => {
        await demo.beat(0.5);
        await openPage(win, obsidian, null);
        await demo.beat(0.8);
        await toggle(win, "Require a prefix before triggers");
        await demo.beat(1.2);
        await obsidian.closeSettings();
        await setDoc(obsidian, "");
        await demo.typeSlowly("now ", { delayMs: 140 });
        await demo.beat(0.8);
        await demo.typeSlowly(":now ", { delayMs: 140 });
        await expect.poll(() => obsidian.editor().text()).toBe("now 14:05 ");
        await demo.beat(1.5);
        await openPage(win, obsidian, null);
        await toggle(win, "Require a prefix before triggers");
        await toggle(win, "Highlight expansions");
        await demo.beat(1.2);
        await obsidian.closeSettings();
        await append(obsidian, "\n\n");
        await demo.typeSlowly("brb ", { delayMs: 140 });
        await demo.beat(1.2);
        await obsidian.press("Backspace");
        await expect.poll(() => obsidian.editor().text()).toContain("brb");
        await demo.beat(1.8);
        // the catalog: Settings, Community plugins, Browse, search for Snipsy (needs the network)
        await obsidian.openSettings("community-plugins");
        await demo.beat(0.8);
        await demo.moveAndClick(win.getByRole("button", { name: "Browse" }).first());
        const search = win.locator(".community-modal-search input, .community-modal input[type=search]").first();
        await expect(search).toBeVisible({ timeout: 20_000 });
        await demo.beat(1);
        await demo.typeSlowly(search, "Snipsy", { delayMs: 150 });
        const item = win.locator(".community-item", { hasText: "Snipsy" }).first();
        await expect(item).toBeVisible({ timeout: 20_000 });
        await demo.beat(1.2);
        await demo.moveAndClick(item);
        await demo.beat(4);
    });
});
