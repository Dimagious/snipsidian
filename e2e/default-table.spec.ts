import { test, expect, seedSnippets } from "./fixtures";
import { DEFAULT_SNIPPETS } from "../src/presets";

/** What the page function reading the caret touches. */
interface EditorApp {
    workspace: {
        activeEditor?: { editor?: { getCursor(): { line: number; ch: number }; setCursor(line: number, ch: number): void } } | null;
    };
}

/** The slice of Obsidian's `app` the page function below touches (it runs inside the app, so it has no import). */
interface LeafApp {
    workspace: {
        activeLeaf: {
            getViewState(): { state?: Record<string, unknown> };
            setViewState(state: unknown): Promise<void>;
        } | null;
    };
}

/**
 * B-208: the default `table` snippet. The separator the user types lands right after the expansion; a space after
 * the last pipe made Live Preview's table widget show a 4th column. The snippet now ends with a newline, so the
 * separator sits on the line below the table. Typed through the real editor, then read back from the rendered table.
 */
test.describe("default `table` snippet (B-208)", () => {
    test("types `table ` into a 3 x 3 table: 3 cells per row in the Live Preview widget", async ({ obsidian, win }) => {
        const table = DEFAULT_SNIPPETS.table;
        if (table === undefined) throw new Error("the default `table` snippet is gone");
        await obsidian.editor().clear();
        await seedSnippets(obsidian, { table });
        // Live Preview, not Source mode, so the table is a rendered widget once the caret leaves it.
        await obsidian.evaluate(async (app: LeafApp) => {
            const leaf = app.workspace.activeLeaf;
            if (!leaf) throw new Error("no active leaf");
            const state = leaf.getViewState();
            state.state = { ...state.state, mode: "source", source: false };
            await leaf.setViewState(state);
        });

        await obsidian.editor().type("intro\n\ntable ");
        const text = await obsidian.editor().text();
        expect(text).toBe(
            "intro\n\n| H1 | H2 | H3 |\n| --- | --- | --- |\n|  | | |\n| | | |\n ",
        );

        // The caret sits in the first body cell (`$|`): line 4, right after the pipe and the space.
        const caret = await obsidian.evaluate((app: EditorApp) => app.workspace.activeEditor?.editor?.getCursor());
        expect(caret).toEqual({ line: 4, ch: 2 });

        // The main use: what is typed next lands in body row 1, cell 1. Raw keyboard input, because the kit's
        // `editor().type()` clicks into the wrong place in a table widget.
        await win.keyboard.type("abc");
        // Obsidian's table editor re-pads the columns once a cell is edited, so compare the cells, not the spaces.
        const typed = (await obsidian.editor().text()).split("\n").slice(2, 6);
        const cellsOf = (line: string | undefined): string[] => (line ?? "").split("|").slice(1, -1).map((c) => c.trim());
        expect(typed.map(cellsOf)).toEqual([
            ["H1", "H2", "H3"],
            ["---", "---", "---"],
            ["abc", "", ""],
            ["", "", ""],
        ]);

        // Move the caret out of the table (`Control+Home` does nothing on macOS) so the widget renders, then count
        // the cells of each row.
        await obsidian.evaluate((app: EditorApp) => app.workspace.activeEditor?.editor?.setCursor(0, 0));
        const rows = win.locator(".workspace-leaf.mod-active .cm-content table tr");
        await expect.poll(() => rows.count(), { message: "the table widget did not render" }).toBe(3);
        const cells = await rows.evaluateAll((trs) => trs.map((tr) => tr.querySelectorAll("th, td").length));
        expect(cells).toEqual([3, 3, 3]);
    });
});
