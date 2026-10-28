import type { CDPSession } from "@playwright/test";
import { test, expect, ui } from "./fixtures";

/**
 * E2E (B-191): expansion survives IME composition. Drives real
 * Chromium composition events via CDP (`Input.imeSetComposition` ->
 * compositionstart/update, `Input.insertText` -> commit +
 * compositionend), the same path an OS input method takes.
 *
 * Scenarios 3 and 4 are the Linux Wayland (text-input-v3) shapes: the
 * separator's only document change happens while `view.composing` is
 * true, so the B-141 gate blocks it and, before B-191, nothing ever
 * retried after the composition ended.
 */

async function compose(cdp: CDPSession, steps: string[], commit: string): Promise<void> {
    for (const s of steps) {
        await cdp.send("Input.imeSetComposition", {
            text: s,
            selectionStart: s.length,
            selectionEnd: s.length,
        });
    }
    await cdp.send("Input.insertText", { text: commit });
}

test.describe("[B-191] expansion with IME composition", () => {
    let cdp: CDPSession;

    test.beforeEach(async ({ app, win }) => {
        await ui.clearEditor(win);
        await win.locator(".cm-content").click();
        cdp = await app.context().newCDPSession(win);
    });

    test("trigger composed + committed, space typed after", async ({ win }) => {
        await compose(cdp, ["b", "br", "brb"], "brb");
        await win.keyboard.type(" ");
        await win.waitForTimeout(300);
        expect(await ui.editorText(win)).toBe("be right back ");
    });

    test("commit carries the separator", async ({ win }) => {
        await compose(cdp, ["b", "br", "brb"], "brb ");
        await win.waitForTimeout(300);
        expect(await ui.editorText(win)).toBe("be right back ");
    });

    test("every character is its own composition (Wayland-like)", async ({ win }) => {
        for (const c of "brb ") await compose(cdp, [c], c);
        await win.waitForTimeout(300);
        expect(await ui.editorText(win)).toBe("be right back ");
    });

    test("plain-typed trigger, separator arrives as a composition", async ({ win }) => {
        await ui.typeInEditor(win, "brb");
        await compose(cdp, [" "], " ");
        await win.waitForTimeout(300);
        expect(await ui.editorText(win)).toBe("be right back ");
    });

    test("trigger composed after an external link", async ({ win }) => {
        await ui.typeInEditor(win, "[x](https://a.b) ");
        await compose(cdp, ["b", "br", "brb"], "brb");
        await win.keyboard.type(" ");
        await win.waitForTimeout(300);
        expect(await ui.editorText(win)).toBe("[x](https://a.b) be right back ");
    });

    test("an open composition is never rewritten mid-flight", async ({ win }) => {
        await ui.typeInEditor(win, "brb");
        await cdp.send("Input.imeSetComposition", {
            text: " ",
            selectionStart: 1,
            selectionEnd: 1,
        });
        await win.waitForTimeout(300);
        // Preedit still open: the trigger must be untouched.
        expect(await ui.editorText(win)).toBe("brb ");
        await cdp.send("Input.insertText", { text: " " });
        await win.waitForTimeout(300);
        expect(await ui.editorText(win)).toBe("be right back ");
    });
});
