import { test, expect, setHighlight } from "./fixtures";
import type { SnipsyApp } from "./fixtures";

/**
 * E2E (ADR-0008 steps 1-2, NOT run by the maker: needs a real Obsidian window): regex triggers ("patterns").
 *
 * Contract pinned here:
 *   - an instant rule fires at the character that completes the match, and Cmd+Z gives back exactly what was typed
 *     (the expansion is its own undo step, unlike a literal expansion, see expansion.spec.ts B-132);
 *   - a separator rule waits for a separator, and keeps it;
 *   - a capture before `$1` still lets Tab land in the right field;
 *   - nothing expands inside a fenced code block.
 */

interface PatternSeed {
    id: string;
    source: string;
    replacement: string;
    mode: "instant" | "separator";
}

async function setPatterns(
    obsidian: { evaluate: <T, A>(fn: (app: SnipsyApp, arg: A) => Promise<T> | T, arg: A) => Promise<T> },
    patterns: PatternSeed[],
): Promise<void> {
    await obsidian.evaluate(
        async (app: SnipsyApp, arg: PatternSeed[]) => {
            const plugin = app.plugins.plugins["snipsidian"];
            if (!plugin?.settings || !plugin.saveSettings) throw new Error("snipsidian plugin is not loaded");
            Object.assign(plugin.settings, {
                patterns: arg.map((p) => ({ ...p, enabled: true })),
            });
            await plugin.saveSettings();
        },
        patterns,
    );
}

test.describe("[ADR-0008] patterns", () => {
    test.beforeEach(async ({ obsidian }) => {
        await obsidian.editor().clear();
    });

    test("an instant rule fires when the match is complete, and one Cmd+Z gives back what was typed", async ({ win, obsidian }) => {
        await setPatterns(obsidian, [{ id: "arrow", source: "/->$/", replacement: "→", mode: "instant" }]);
        await obsidian.editor().type("anchor line");
        await win.keyboard.press("Enter");
        // Fixed wait on purpose: CM6 groups undo events by the time between edits.
        await win.waitForTimeout(700);

        await obsidian.editor().type("a ->");
        await expect.poll(() => obsidian.editor().text()).toContain("a →");

        await obsidian.press("Mod+Z");
        await expect.poll(() => obsidian.editor().text()).toContain("a ->");
        // not expanded again a moment later. Fixed wait on purpose: the expected result is "nothing happens".
        await win.waitForTimeout(300);
        expect(await obsidian.editor().text()).toContain("a ->");
    });

    // Obsidian's "Auto pair brackets" is on by default and the vault keeps it: `(` inserts `()`, and the typed `)` only
    // steps over the closer (no document change, no userEvent). The rule has to fire on that step.
    test("an instant rule ending in a closer fires with auto-paired brackets, and one Cmd+Z gives back what was typed", async ({ win, obsidian }) => {
        await setPatterns(obsidian, [{ id: "copyright", source: String.raw`/\(c\)$/i`, replacement: "\u00a9", mode: "instant" }]);
        await obsidian.editor().type("anchor line");
        await win.keyboard.press("Enter");
        // Fixed wait on purpose: CM6 groups undo events by the time between edits.
        await win.waitForTimeout(700);

        await obsidian.editor().type("x (c)");
        await expect.poll(() => obsidian.editor().text()).toContain("x \u00a9");
        // nothing is left behind: the typed closer was the last character of the match
        expect(await obsidian.editor().text()).not.toContain("(");

        await obsidian.press("Mod+Z");
        await expect.poll(() => obsidian.editor().text()).toContain("x (c)");
        // not expanded again a moment later. Fixed wait on purpose: the expected result is "nothing happens".
        await win.waitForTimeout(300);
        expect(await obsidian.editor().text()).toContain("x (c)");
    });

    test("a typo fixed inside the auto-paired brackets keeps the rule", async ({ win, obsidian }) => {
        await setPatterns(obsidian, [{ id: "copyright", source: String.raw`/\(c\)$/i`, replacement: "\u00a9", mode: "instant" }]);
        await obsidian.editor().type("anchor line");
        await win.keyboard.press("Enter");
        await obsidian.editor().type("x (v");
        await win.keyboard.press("Backspace"); // inside the pair: only the typo goes, the editor's `)` stays
        await obsidian.editor().type("c)");
        await expect.poll(() => obsidian.editor().text()).toContain("x \u00a9");
        expect(await obsidian.editor().text()).not.toContain("(");
    });

    // The editor wrote `()` for the typed `(`. A rule that replaces the opener takes the closer too, so the result is
    // what the same typing gives with auto-pair off, and one Cmd+Z gives back the pair with the caret between.
    test("an instant rule ending in the opener leaves no stray closer, and one Cmd+Z restores the pair", async ({ win, obsidian }) => {
        await setPatterns(obsidian, [{ id: "sad", source: String.raw`/:\($/`, replacement: "\u2639", mode: "instant" }]);
        await obsidian.editor().type("anchor line");
        await win.keyboard.press("Enter");
        // Fixed wait on purpose: CM6 groups undo events by the time between edits.
        await win.waitForTimeout(700);

        await obsidian.editor().type("x :(");
        await expect.poll(() => obsidian.editor().text()).toContain("x \u2639");
        expect(await obsidian.editor().text()).not.toContain("\u2639)");

        await obsidian.press("Mod+Z");
        await expect.poll(() => obsidian.editor().text()).toContain("x :()");
        // the caret is back between the brackets: the next character lands inside the pair
        await win.waitForTimeout(300);
        await obsidian.editor().type("a");
        await expect.poll(() => obsidian.editor().text()).toContain("x :(a)");
    });

    // Same pair, undone with Highlight + Backspace instead of Cmd+Z: the caret has to come back between the brackets too.
    test("with highlight on, Backspace after a rule that took the closer restores the pair with the caret inside", async ({ win, obsidian }) => {
        await setHighlight(obsidian, true);
        try {
            await setPatterns(obsidian, [{ id: "sad", source: String.raw`/:\($/`, replacement: "\u2639", mode: "instant" }]);
            await obsidian.editor().type("anchor line");
            await win.keyboard.press("Enter");

            await obsidian.editor().type("x :(");
            await expect.poll(() => obsidian.editor().text()).toContain("x \u2639");
            await win.keyboard.press("Backspace");
            await expect.poll(() => obsidian.editor().text()).toContain("x :()");
            // not expanded again a moment later. Fixed wait on purpose: the expected result is "nothing happens".
            await win.waitForTimeout(300);
            expect(await obsidian.editor().text()).toContain("x :()");
            await obsidian.editor().type("a");
            await expect.poll(() => obsidian.editor().text()).toContain("x :(a)");
        } finally {
            await setHighlight(obsidian, false);
        }
    });

    test("a separator rule waits for the separator and keeps it", async ({ obsidian }) => {
        await setPatterns(obsidian, [
            { id: "frac", source: String.raw`/(\d+)\/(\d+)$/`, replacement: "{{1}}⁄{{2}}", mode: "separator" },
        ]);
        await obsidian.editor().type("take 3/4");
        expect(await obsidian.editor().text()).toBe("take 3/4");
        await obsidian.editor().type(" ");
        await expect.poll(() => obsidian.editor().text()).toBe("take 3⁄4 ");
    });

    test("a capture before $1: Tab lands in the field after the captured text", async ({ win, obsidian }) => {
        await setPatterns(obsidian, [
            { id: "mtg", source: String.raw`/mtg (\w+)$/`, replacement: "Meeting with {{1}} about $1 and $2", mode: "separator" },
        ]);
        await obsidian.editor().type("mtg Bob ");
        await expect.poll(() => obsidian.editor().text()).toBe("Meeting with Bob about  and  ");
        await obsidian.editor().type("topic");
        await win.keyboard.press("Tab");
        await obsidian.editor().type("notes");
        expect(await obsidian.editor().text()).toBe("Meeting with Bob about topic and notes ");
    });

    test("negative: nothing expands inside a fenced code block", async ({ win, obsidian }) => {
        await setPatterns(obsidian, [{ id: "arrow", source: "/->$/", replacement: "→", mode: "instant" }]);
        await obsidian.editor().type("```");
        await win.keyboard.press("Enter");
        await obsidian.editor().type("a ->");
        // Fixed wait on purpose: the expected result is "nothing happens".
        await win.waitForTimeout(300);
        expect(await obsidian.editor().text()).toContain("a ->");
    });
});
