import { test, expect } from "./fixtures";
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
