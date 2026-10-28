import { test, expect, ui } from "./fixtures";

/**
 * E2E (B-176, NOT run by the maker: needs a real Obsidian window): the
 * opt-in "Highlight expansions" setting and the Backspace undo window.
 *
 * Pristine vault seed: `brb` -> "be right back".
 *
 * Contract pinned here:
 *   - `brb ` expands; the mark class appears on the inserted text.
 *   - Backspace right after restores `brb ` exactly (trigger + the typed
 *     space), and the restored trigger does NOT expand again.
 *   - After moving the caret away, Backspace is native (deletes one char).
 *   - Setting off (default): Backspace is native, no mark class.
 *   - Cmd+Z after a Backspace-undo re-applies the expansion (own history
 *     step); Cmd+Z after a plain expansion keeps the B-132 behaviour.
 */

async function setHighlight(win: import("@playwright/test").Page, on: boolean) {
    await win.evaluate(async (value) => {
        const plugin = (globalThis as unknown as {
            app?: {
                plugins?: {
                    plugins?: {
                        snipsidian?: {
                            settings: { expansion?: { highlight?: boolean } };
                            saveSettings: () => Promise<void>;
                        };
                    };
                };
            };
        }).app?.plugins?.plugins?.snipsidian;
        if (!plugin) throw new Error("snipsidian plugin not loaded");
        plugin.settings.expansion = { ...plugin.settings.expansion, highlight: value };
        await plugin.saveSettings();
    }, on);
}

test.describe("[B-176] expansion highlight + Backspace undo", () => {
    test.beforeEach(async ({ win }) => {
        await setHighlight(win, true);
        await ui.clearEditor(win);
    });

    test.afterEach(async ({ win }) => {
        await setHighlight(win, false);
    });

    test("the expanded text carries the mark class", async ({ win }) => {
        await ui.typeInEditor(win, "brb ");
        await expect(win.locator(".cm-content .snipsy-expanded")).toHaveText("be right back");
    });

    test("Backspace right after the expansion restores `brb ` and does not re-expand", async ({ win }) => {
        await ui.typeInEditor(win, "brb ");
        expect(await ui.editorText(win)).toBe("be right back ");
        await win.keyboard.press("Backspace");
        expect(await ui.editorText(win)).toBe("brb ");
        await expect(win.locator(".cm-content .snipsy-expanded")).toHaveCount(0);
        // still not expanded a moment later
        await win.waitForTimeout(300);
        expect(await ui.editorText(win)).toBe("brb ");
    });

    test("typing on after the restore continues after the space", async ({ win }) => {
        await ui.typeInEditor(win, "brb ");
        await win.keyboard.press("Backspace");
        await ui.typeInEditor(win, "x");
        expect(await ui.editorText(win)).toBe("brb x");
    });

    test("negative: after moving the caret away, Backspace is native", async ({ win }) => {
        await ui.typeInEditor(win, "brb ");
        await win.keyboard.press("ArrowLeft");
        await win.keyboard.press("ArrowRight");
        await win.keyboard.press("Backspace");
        expect(await ui.editorText(win)).toBe("be right back");
        await expect(win.locator(".cm-content .snipsy-expanded")).toHaveCount(0);
    });

    test("negative: typing another character closes the window", async ({ win }) => {
        await ui.typeInEditor(win, "brb x");
        await win.keyboard.press("Backspace");
        expect(await ui.editorText(win)).toBe("be right back ");
    });

    test("Cmd+Z after a Backspace-undo re-applies the expansion", async ({ win }) => {
        await ui.typeInEditor(win, "brb ");
        await win.keyboard.press("Backspace");
        await win.keyboard.press("Meta+Z");
        expect(await ui.editorText(win)).toBe("be right back ");
    });

    test("[B-132] with highlight on, undo after an expansion behaves as before", async ({ win }) => {
        // Mirrors expansion.spec.ts B-132: CM6 groups the typed trigger and
        // the untagged expansion into one undo event, so an anchor line plus
        // a wait past the grouping window gives a clean boundary. One Cmd+Z
        // removes trigger + expansion together and must not re-expand.
        await ui.typeInEditor(win, "anchor line");
        await win.keyboard.press("Enter");
        await win.waitForTimeout(700);
        await ui.typeInEditor(win, "brb ");
        expect(await ui.editorText(win)).toContain("be right back");

        await win.keyboard.press("Meta+Z");
        await win.waitForTimeout(300);
        let text = await ui.editorText(win);
        expect(text).toContain("anchor line");
        expect(text).not.toContain("be right back");
        expect(text).not.toContain("brb");

        await win.waitForTimeout(300);
        text = await ui.editorText(win);
        expect(text).toContain("anchor line");
        expect(text).not.toContain("be right back");
        expect(text).not.toContain("brb");
        await expect(win.locator(".cm-content .snipsy-expanded")).toHaveCount(0);
    });

    test("setting off: no mark and Backspace is native", async ({ win }) => {
        await setHighlight(win, false);
        await ui.typeInEditor(win, "brb ");
        await expect(win.locator(".cm-content .snipsy-expanded")).toHaveCount(0);
        await win.keyboard.press("Backspace");
        expect(await ui.editorText(win)).toBe("be right back");
    });
});
