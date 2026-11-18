import { test, expect, seedSnippets, type SnipsyApp } from "./fixtures";
import type { ObsidianHelpers } from "obsidian-plugin-dev-kit/e2e";

/**
 * E2E (B-255, NOT run by the maker: needs a real Obsidian window): manual
 * expansion. "Expand on Tab" makes Tab expand the trigger before the caret;
 * "Expand while typing" off means typing a separator never expands.
 *
 * Contract pinned here:
 *   - Tab with no trigger before the caret still indents a list item
 *   - Tab right after a trigger expands it, no separator needed
 *   - inside a field session Tab is the session's (next field), never a new expansion
 *   - with typing off, a trigger followed by a space stays text
 */

const PLUGIN_ID = "snipsidian";

async function setExpansion(obsidian: ObsidianHelpers, expansion: { onType: boolean; onTab: boolean }): Promise<void> {
    await obsidian.evaluate(
        async (app: SnipsyApp, arg: { id: string; expansion: { onType: boolean; onTab: boolean } }) => {
            const plugin = app.plugins.plugins[arg.id];
            if (!plugin?.settings || !plugin.saveSettings) throw new Error(`${arg.id} plugin is not loaded`);
            plugin.settings.expansion = { ...plugin.settings.expansion, ...arg.expansion };
            await plugin.saveSettings();
        },
        { id: PLUGIN_ID, expansion },
    );
}

test.describe("[B-255] manual expansion", () => {
    test.beforeEach(async ({ obsidian }) => {
        await obsidian.editor().clear();
        await seedSnippets(obsidian, { brb: "be right back", lnk: "[$1]($2)" });
        await setExpansion(obsidian, { onType: false, onTab: true });
    });

    test("Tab indents a list item when no trigger sits before the caret", async ({ win, obsidian }) => {
        await obsidian.editor().type("- first\n");
        await obsidian.editor().type("second");
        await win.keyboard.press("Tab");
        expect(await obsidian.editor().text()).toMatch(/^- first\n\s+- second$/);
    });

    test("Tab expands the trigger before the caret, without a separator", async ({ win, obsidian }) => {
        await obsidian.editor().type("say brb");
        await win.keyboard.press("Tab");
        await expect.poll(() => obsidian.editor().text()).toBe("say be right back");
    });

    test("inside a field session Tab jumps to the next field instead of expanding", async ({ win, obsidian }) => {
        await obsidian.editor().type("lnk");
        await win.keyboard.press("Tab");
        await expect.poll(() => obsidian.editor().text()).toBe("[]()");
        await obsidian.editor().type("text");
        await win.keyboard.press("Tab");
        await obsidian.editor().type("url");
        expect(await obsidian.editor().text()).toBe("[text](url)");
    });

    test("with Expand while typing off, a trigger and a space stay text", async ({ obsidian }) => {
        await obsidian.editor().type("brb ");
        // An expansion is async (it runs after the editor update). Typing more
        // text with a second separator queues behind that cycle, so a pending
        // expansion of the first one would have landed before this is read.
        await obsidian.editor().type("more ");
        expect(await obsidian.editor().text()).toBe("brb more ");

        // Control: the same keystrokes DO expand once typing is on, so the
        // check above was not passing because the snippet never fires here.
        await obsidian.editor().clear();
        await setExpansion(obsidian, { onType: true, onTab: true });
        await obsidian.editor().type("brb ");
        await expect.poll(() => obsidian.editor().text()).toBe("be right back ");
    });
});
