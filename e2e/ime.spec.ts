import { test, expect } from "./fixtures";

/**
 * E2E (B-191): expansion survives IME composition. Drives real
 * Chromium composition events (`Input.imeSetComposition` ->
 * compositionstart/update, `Input.insertText` -> commit +
 * compositionend), the same path an OS input method takes.
 * `obsidian.editor().compose()` sends them over a CDP session.
 *
 * Scenarios 3 and 4 are the Linux Wayland (text-input-v3) shapes: the
 * separator's only document change happens while `view.composing` is
 * true, so the B-141 gate blocks it and, before B-191, nothing ever
 * retried after the composition ended.
 */

test.describe("[B-191] expansion with IME composition", () => {
    test.beforeEach(async ({ obsidian }) => {
        await obsidian.editor().clear();
    });

    test("trigger composed + committed, space typed after", async ({ win, obsidian }) => {
        await obsidian.editor().compose("brb");
        await win.keyboard.type(" ");
        await expect.poll(() => obsidian.editor().text()).toBe("be right back ");
    });

    test("commit carries the separator", async ({ obsidian }) => {
        await obsidian.editor().compose("brb ");
        await expect.poll(() => obsidian.editor().text()).toBe("be right back ");
    });

    test("every character is its own composition (Wayland-like)", async ({ obsidian }) => {
        await obsidian.editor().compose("brb ", { chunking: "character" });
        await expect.poll(() => obsidian.editor().text()).toBe("be right back ");
    });

    test("plain-typed trigger, separator arrives as a composition", async ({ obsidian }) => {
        await obsidian.editor().type("brb");
        await obsidian.editor().compose(" ");
        await expect.poll(() => obsidian.editor().text()).toBe("be right back ");
    });

    test("trigger composed after an external link", async ({ win, obsidian }) => {
        await obsidian.editor().type("[x](https://a.b) ");
        await obsidian.editor().compose("brb");
        await win.keyboard.type(" ");
        await expect.poll(() => obsidian.editor().text()).toBe("[x](https://a.b) be right back ");
    });

    // `compose()` always commits; this scenario leaves a preedit open, so it
    // keeps a raw CDP session.
    test("an open composition is never rewritten mid-flight", async ({ win, obsidian }) => {
        await obsidian.editor().type("brb");
        const cdp = await win.context().newCDPSession(win);
        await cdp.send("Input.imeSetComposition", {
            text: " ",
            selectionStart: 1,
            selectionEnd: 1,
        });
        // Fixed wait on purpose: the preedit is open, so the expected result is "nothing changes" and there is no
        // state to wait for. The pause gives a wrongful rewrite time to show up before the assertion.
        await win.waitForTimeout(300);
        // Preedit still open: the trigger must be untouched.
        expect(await obsidian.editor().text()).toBe("brb ");
        await cdp.send("Input.insertText", { text: " " });
        await expect.poll(() => obsidian.editor().text()).toBe("be right back ");
    });
});
