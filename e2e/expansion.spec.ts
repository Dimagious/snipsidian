import { test, expect, ui } from "./fixtures";

/**
 * E2E: snippet expansion fires on real keystrokes in the Obsidian
 * editor.
 *
 * Why E2E and not just integration: the keystroke→expansion path is
 * already covered at the adapter level via `MockEditor`. The
 * adapter uses a synthetic editor that doesn't fully simulate
 * CodeMirror 6's event semantics. This spec proves the wiring at
 * cm6-bridge → tryExpandAtSeparator → engine actually fires when a
 * human types into the live CM6 editor.
 *
 * Important: every keystroke must go through `pressSequentially`,
 * NOT `fill()`. Playwright codegen records `fill()` by default,
 * which synthesises a single DOM mutation. Snipsy's cm6-bridge
 * listens to per-keystroke events, so `fill()` skips expansion
 * entirely. The `ui.typeInEditor` helper enforces this.
 *
 * Test seed: the pristine vault's
 * `.obsidian/plugins/snipsidian/data.json` pre-installs:
 *   - `brb`     → "be right back"
 *   - `h1`      → "# $|"
 *   - `callout` → "> [!note]\n> $|"
 */

test.describe("expansion fires in the real editor", () => {
    test.beforeEach(async ({ win }) => {
        await ui.clearEditor(win);
    });

    test("`brb<space>` expands to `be right back`", async ({ win }) => {
        await ui.typeInEditor(win, "brb ");
        const text = await ui.editorText(win);
        expect(text).toContain("be right back");
        expect(text).not.toContain("brb");
    });

    test("unknown triggers stay untouched", async ({ win }) => {
        await ui.typeInEditor(win, "nonexistent ");
        const text = await ui.editorText(win);
        expect(text).toContain("nonexistent");
        // The text we typed should literally be in the document.
        expect(text).not.toContain("be right back");
    });

    test("`h1<space>` expands to `# ` and cursor lands at the marker", async ({
        win,
    }) => {
        await ui.typeInEditor(win, "h1 ");
        // Type some text after the expansion — it should appear at
        // the cursor position (the `$|` marker). If the cursor
        // landed somewhere else, the text would be on the wrong line
        // or before the `#`.
        await ui.typeInEditor(win, "Hello");
        const text = await ui.editorText(win);
        expect(text).toContain("# Hello");
        expect(text).not.toContain("h1");
    });

    test("`callout<space>` expands to multi-line and cursor lands on the second line (B-010)", async ({
        win,
    }) => {
        await ui.typeInEditor(win, "callout ");
        // After the expansion the document is `> [!note]\n> ` and the
        // cursor is right after the `> ` on line 2. Typing more text
        // should appear INSIDE the callout (after `> `), proving the
        // cursor's `lineDelta` made it to line 2 — that's the B-010
        // regression we baked tests for at the engine level. This
        // spec proves it E2E.
        await ui.typeInEditor(win, "inside");
        const text = await ui.editorText(win);
        expect(text).toContain("[!note]");
        expect(text).toContain("> inside");
    });

    test("[B-108] expansion fires at column 0 of a non-first line", async ({
        win,
    }) => {
        // Existing "brb<space> at start of empty doc" test already
        // covers line 0 column 0. This pins the second variant: a
        // doc with content, cursor moved to column 0 of a NEW
        // (empty) line, type trigger from there. Engine's
        // `shouldExpandHere` has historically broken on the
        // ch=0-line>0 corner — pin it here.
        await ui.typeInEditor(win, "first line");
        await win.keyboard.press("Enter");
        // Cursor is now at line 1, column 0. Type trigger + sep.
        await ui.typeInEditor(win, "brb ");
        const text = await ui.editorText(win);
        expect(text).toContain("first line");
        expect(text).toContain("be right back");
        expect(text).not.toContain("brb ");
    });

    test("[B-109] expansion fires when separator is a newline (Enter)", async ({
        win,
    }) => {
        // Existing tests use space as the separator. Newline is a
        // separate `tryExpandAtSeparator` path — the cm6-bridge
        // emits a different `editor-change` event shape, and the
        // `lastTyped` character is `\n` rather than ` `. Both must
        // fire expansion if the engine's delimiter list contains
        // both (it does, per `src/shared/delimiters.ts`).
        await ui.typeInEditor(win, "brb");
        await win.keyboard.press("Enter");
        const text = await ui.editorText(win);
        expect(text).toContain("be right back");
        expect(text).not.toContain("brb");
    });

    test("[B-111] backspace inside a partial trigger does not expand", async ({
        win,
    }) => {
        // Type the full trigger, backspace one char to make it
        // partial, then press space. The trigger no longer matches
        // any registered snippet — expansion must NOT fire. Pins
        // the cursor-shift behaviour: `findTrigger` walks back from
        // the separator, so it sees `br` (not `brb`), which isn't
        // in the dict.
        await ui.typeInEditor(win, "brb");
        await win.keyboard.press("Backspace");
        await ui.typeInEditor(win, " ");
        const text = await ui.editorText(win);
        expect(text).toContain("br ");
        expect(text).not.toContain("be right back");
        // Sanity: the trigger word itself is gone (we backspaced),
        // and only the partial `br` + space remains.
        expect(text).not.toContain("brb");
    });

    test("[B-132] undo after expansion does not re-trigger the expansion", async ({
        win,
    }) => {
        // The expansion hot path (cm6-bridge -> tryExpandAtSeparator)
        // decides purely from document state (cursor.ch, last typed
        // char) with no check of the editor-change's origin. Undo
        // replays a prior document state, which — from the handler's
        // point of view — could look exactly like a user who just
        // typed a trailing separator after a trigger. If the
        // programmatic replacement isn't isolated from history in a
        // way that skips re-triggering, undo becomes a trap: the
        // expansion instantly reapplies.
        //
        // Verified empirically (debug run against this build): CM6
        // groups our plugin's programmatic `replaceRange` into the
        // SAME undo transaction as the keystrokes that triggered it,
        // provided they land within its history-grouping window. One
        // Cmd+Z therefore undoes the typed trigger AND the expansion
        // together, atomically — the intermediate "trigger present,
        // not yet expanded" state this test originally assumed a
        // single undo would land on is never actually visited. The
        // anchor line + explicit wait below establish a clean undo
        // group boundary BEFORE the trigger, so undo has a
        // deterministic, single, well-defined step to land on: back
        // to the anchor line, with neither the trigger nor its
        // expansion present.
        await ui.typeInEditor(win, "anchor line");
        await win.keyboard.press("Enter");
        // Exceeds CM6's default history-grouping window so the
        // trigger below starts its own undo group, independent of
        // this setup line.
        await win.waitForTimeout(700);

        await ui.typeInEditor(win, "brb ");
        let text = await ui.editorText(win);
        expect(text).toContain("be right back");
        expect(text).not.toContain("brb");

        await win.keyboard.press("Meta+Z");
        // Give the editor-change handler a chance to react to the
        // undo's document mutation before we assert.
        await win.waitForTimeout(300);

        // Undo reverted the trigger + its expansion together, back to
        // just the anchor line — neither the raw trigger nor the
        // expanded text survives.
        text = await ui.editorText(win);
        expect(text).toContain("anchor line");
        expect(text).not.toContain("be right back");
        expect(text).not.toContain("brb");

        // The critical assertion: undo must not be a trap. Wait
        // again to catch any delayed re-expansion, then confirm the
        // document is still in the undone state.
        await win.waitForTimeout(300);
        text = await ui.editorText(win);
        expect(text).toContain("anchor line");
        expect(text).not.toContain("be right back");
        expect(text).not.toContain("brb");
    });
});

test.describe("expansion respects markdown context", () => {
    test.beforeEach(async ({ win }) => {
        await ui.clearEditor(win);
    });

    test("does NOT expand inside a fenced code block", async ({ win }) => {
        // Type ``` and Enter to open a fence, then the trigger.
        // pressSequentially fires real keystrokes so the cm6-bridge
        // sees the separator; the engine's context check (which
        // detects the code fence) must then suppress expansion.
        await ui.typeInEditor(win, "```");
        await win.keyboard.press("Enter");
        await ui.typeInEditor(win, "brb ");
        const text = await ui.editorText(win);
        // Trigger remains as-typed.
        expect(text).toContain("brb");
        expect(text).not.toContain("be right back");
    });

    test("does NOT expand inside YAML frontmatter", async ({ win }) => {
        await ui.typeInEditor(win, "---");
        await win.keyboard.press("Enter");
        await ui.typeInEditor(win, "title: brb ");
        const text = await ui.editorText(win);
        expect(text).toContain("brb");
        expect(text).not.toContain("be right back");
    });
});
