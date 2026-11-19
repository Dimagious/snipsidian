import { test, expect, type SnipsyApp } from "./fixtures";
import type { ObsidianHelpers } from "obsidian-plugin-dev-kit/e2e";

/**
 * E2E (ADR-0008 with B-255, NOT run by the maker: needs a real Obsidian window): pattern rules on the Tab key.
 * "Expand on Tab" is on and "Expand while typing" is off, so only Tab can expand.
 *
 * Contract pinned here:
 *   - a separator rule expands on Tab, with nothing typed after it;
 *   - Tab with no literal trigger and no rule match still indents (the key is not taken);
 *   - the expansion's `$1` / `$2` fields work: Tab inside the session jumps to the next field;
 *   - one Cmd+Z after a Tab expansion gives back exactly what was typed;
 *   - with the caret inside a word, a rule whose match lies wholly after the caret does not expand.
 */

const PLUGIN_ID = "snipsidian";

interface PatternSeed {
    id: string;
    source: string;
    replacement: string;
    mode: "instant" | "separator";
}

async function setUp(obsidian: ObsidianHelpers, patterns: PatternSeed[]): Promise<void> {
    await obsidian.evaluate(
        async (app: SnipsyApp, arg: { id: string; patterns: PatternSeed[] }) => {
            const plugin = app.plugins.plugins[arg.id];
            if (!plugin?.settings || !plugin.saveSettings) throw new Error(`${arg.id} plugin is not loaded`);
            Object.assign(plugin.settings, {
                patterns: arg.patterns.map((p) => ({ ...p, enabled: true })),
                expansion: { onType: false, onTab: true },
            });
            await plugin.saveSettings();
        },
        { id: PLUGIN_ID, patterns },
    );
}

const DAY: PatternSeed = { id: "day", source: String.raw`/\bdd(\d+)$/`, replacement: "day {{1}}", mode: "separator" };

test.describe("[ADR-0008] patterns on Tab", () => {
    test.beforeEach(async ({ obsidian }) => {
        await obsidian.editor().clear();
    });

    test("a separator rule expands on Tab", async ({ win, obsidian }) => {
        await setUp(obsidian, [DAY]);
        await obsidian.editor().type("on dd5");
        // Typing does not expand with "Expand while typing" off: the text is still what was typed.
        expect(await obsidian.editor().text()).toBe("on dd5");
        await win.keyboard.press("Tab");
        await expect.poll(() => obsidian.editor().text()).toBe("on day 5");
    });

    test("Tab with no literal trigger and no rule match indents a list item", async ({ win, obsidian }) => {
        await setUp(obsidian, [DAY]);
        await obsidian.editor().type("- first\n");
        await obsidian.editor().type("second");
        await win.keyboard.press("Tab");
        expect(await obsidian.editor().text()).toMatch(/^- first\n\s+- second$/);
    });

    test("Tab inside the fields of a rule's expansion jumps to the next field", async ({ win, obsidian }) => {
        await setUp(obsidian, [
            { id: "mtg", source: String.raw`/mtg (\w+)$/`, replacement: "Meeting with {{1}} about $1 and $2", mode: "separator" },
        ]);
        await obsidian.editor().type("mtg Bob");
        await win.keyboard.press("Tab");
        await expect.poll(() => obsidian.editor().text()).toBe("Meeting with Bob about  and ");
        await obsidian.editor().type("topic");
        // Inside the session Tab is the session's: it jumps, it does not start another expansion.
        await win.keyboard.press("Tab");
        await obsidian.editor().type("notes");
        expect(await obsidian.editor().text()).toBe("Meeting with Bob about topic and notes");
    });

    test("one Cmd+Z after a Tab expansion gives back what was typed", async ({ win, obsidian }) => {
        await setUp(obsidian, [DAY]);
        await obsidian.editor().type("anchor line");
        await win.keyboard.press("Enter");
        // Fixed wait on purpose: CM6 groups undo events by the time between edits.
        await win.waitForTimeout(700);

        await obsidian.editor().type("on dd5");
        await win.keyboard.press("Tab");
        await expect.poll(() => obsidian.editor().text()).toContain("on day 5");

        await obsidian.press("Mod+Z");
        await expect.poll(() => obsidian.editor().text()).toContain("on dd5");
        // not expanded again a moment later. Fixed wait on purpose: the expected result is "nothing happens".
        await win.waitForTimeout(300);
        expect(await obsidian.editor().text()).toContain("on dd5");
        expect(await obsidian.editor().text()).not.toContain("day");
    });

    test("negative: with the caret before a tail the rule matches, Tab does not expand it", async ({ win, obsidian }) => {
        await setUp(obsidian, [{ id: "tail", source: String.raw`/dd(\d+)$/`, replacement: "day {{1}}", mode: "separator" }]);
        await obsidian.editor().type("abcdd5 x");
        await win.keyboard.press("Home");
        await win.keyboard.press("ArrowRight"); // a|bcdd5 x: the match `dd5` lies after the caret
        await win.keyboard.press("Tab");
        // Fixed wait on purpose: the expected result is "nothing happens" (Tab may indent, it must not expand).
        await win.waitForTimeout(300);
        const text = await obsidian.editor().text();
        expect(text).not.toContain("day");
        expect(text).toContain("bcdd5 x");
    });
});
