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
 * entirely. The kit's `obsidian.editor().type()` enforces this.
 *
 * Test seed: the pristine vault's
 * `.obsidian/plugins/snipsidian/data.json` pre-installs:
 *   - `brb`     → "be right back"
 *   - `h1`      → "# $|"
 *   - `callout` → "> [!note]\n> $|"
 */

test.describe("expansion fires in the real editor", () => {
    test.beforeEach(async ({ obsidian }) => {
        await obsidian.editor().clear();
    });

    test("`brb<space>` expands to `be right back`", async ({ obsidian }) => {
        await obsidian.editor().type("brb ");
        const text = await obsidian.editor().text();
        expect(text).toContain("be right back");
        expect(text).not.toContain("brb");
    });

    test("[B-182] typing on after `brb<space>` continues AFTER the space", async ({
        obsidian,
    }) => {
        // Pre-fix the cursor landed before the typed separator, so the
        // next word was glued to the expansion: `be right backthen  `.
        await obsidian.editor().type("brb then ");
        const text = await obsidian.editor().text();
        expect(text).toBe("be right back then ");
    });

    test("[B-182] punctuation separator keeps the cursor after it", async ({
        obsidian,
    }) => {
        // Pre-fix: `x brb, y` ended up as `x be right back y,`.
        await obsidian.editor().type("x brb, y");
        const text = await obsidian.editor().text();
        expect(text).toBe("x be right back, y");
    });

    test("unknown triggers stay untouched", async ({ obsidian }) => {
        await obsidian.editor().type("nonexistent ");
        const text = await obsidian.editor().text();
        expect(text).toContain("nonexistent");
        // The text we typed should literally be in the document.
        expect(text).not.toContain("be right back");
    });

    test("`h1<space>` expands to `# ` and cursor lands at the marker", async ({
        obsidian,
    }) => {
        await obsidian.editor().type("h1 ");
        // Type some text after the expansion — it should appear at
        // the cursor position (the `$|` marker). If the cursor
        // landed somewhere else, the text would be on the wrong line
        // or before the `#`.
        await obsidian.editor().type("Hello");
        const text = await obsidian.editor().text();
        expect(text).toContain("# Hello");
        expect(text).not.toContain("h1");
    });

    test("`callout<space>` expands to multi-line and cursor lands on the second line (B-010)", async ({
        obsidian,
    }) => {
        await obsidian.editor().type("callout ");
        // After the expansion the document is `> [!note]\n> ` and the
        // cursor is right after the `> ` on line 2. Typing more text
        // should appear INSIDE the callout (after `> `), proving the
        // cursor's `lineDelta` made it to line 2 — that's the B-010
        // regression we baked tests for at the engine level. This
        // spec proves it E2E.
        await obsidian.editor().type("inside");
        const text = await obsidian.editor().text();
        expect(text).toContain("[!note]");
        expect(text).toContain("> inside");
    });

    test("[B-108] expansion fires at column 0 of a non-first line", async ({
        win,
        obsidian,
    }) => {
        // Existing "brb<space> at start of empty doc" test already
        // covers line 0 column 0. This pins the second variant: a
        // doc with content, cursor moved to column 0 of a NEW
        // (empty) line, type trigger from there. Engine's
        // `shouldExpandHere` has historically broken on the
        // ch=0-line>0 corner — pin it here.
        await obsidian.editor().type("first line");
        await win.keyboard.press("Enter");
        // Cursor is now at line 1, column 0. Type trigger + sep.
        await obsidian.editor().type("brb ");
        const text = await obsidian.editor().text();
        expect(text).toContain("first line");
        expect(text).toContain("be right back");
        expect(text).not.toContain("brb ");
    });

    test("[B-109] expansion fires when separator is a newline (Enter)", async ({
        win,
        obsidian,
    }) => {
        // Existing tests use space as the separator. Newline is a
        // separate `tryExpandAtSeparator` path — the cm6-bridge
        // emits a different `editor-change` event shape, and the
        // `lastTyped` character is `\n` rather than ` `. Both must
        // fire expansion if the engine's delimiter list contains
        // both (it does, per `src/shared/delimiters.ts`).
        await obsidian.editor().type("brb");
        await win.keyboard.press("Enter");
        const text = await obsidian.editor().text();
        expect(text).toContain("be right back");
        expect(text).not.toContain("brb");
    });

    test("[B-111] backspace inside a partial trigger does not expand", async ({
        win,
        obsidian,
    }) => {
        // Type the full trigger, backspace one char to make it
        // partial, then press space. The trigger no longer matches
        // any registered snippet — expansion must NOT fire. Pins
        // the cursor-shift behaviour: `findTrigger` walks back from
        // the separator, so it sees `br` (not `brb`), which isn't
        // in the dict.
        await obsidian.editor().type("brb");
        await win.keyboard.press("Backspace");
        await obsidian.editor().type(" ");
        const text = await obsidian.editor().text();
        expect(text).toContain("br ");
        expect(text).not.toContain("be right back");
        // Sanity: the trigger word itself is gone (we backspaced),
        // and only the partial `br` + space remains.
        expect(text).not.toContain("brb");
    });

    test("[B-132] undo after expansion does not re-trigger the expansion", async ({
        win,
        obsidian,
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
        await obsidian.editor().type("anchor line");
        await win.keyboard.press("Enter");
        // Exceeds CM6's default history-grouping window so the
        // trigger below starts its own undo group, independent of
        // this setup line.
        await win.waitForTimeout(700);

        await obsidian.editor().type("brb ");
        let text = await obsidian.editor().text();
        expect(text).toContain("be right back");
        expect(text).not.toContain("brb");

        await win.keyboard.press("Meta+Z");
        // Give the editor-change handler a chance to react to the
        // undo's document mutation before we assert.
        await win.waitForTimeout(300);

        // Undo reverted the trigger + its expansion together, back to
        // just the anchor line — neither the raw trigger nor the
        // expanded text survives.
        text = await obsidian.editor().text();
        expect(text).toContain("anchor line");
        expect(text).not.toContain("be right back");
        expect(text).not.toContain("brb");

        // The critical assertion: undo must not be a trap. Wait
        // again to catch any delayed re-expansion, then confirm the
        // document is still in the undone state.
        await win.waitForTimeout(300);
        text = await obsidian.editor().text();
        expect(text).toContain("anchor line");
        expect(text).not.toContain("be right back");
        expect(text).not.toContain("brb");
    });

    test("[B-149] undo after an Enter-triggered expansion does not re-trigger it", async ({
        win,
        obsidian,
    }) => {
        // Mirrors the B-132 spec above with Enter (not space) as the
        // separator — pins the B-149 concern that B-132's coverage
        // was space-only. If CM6's undo-grouping ever treats the
        // Enter keystroke differently from a typed separator (e.g.
        // splits it into its own undo step, landing on the
        // "trigger present, not yet expanded" intermediate state),
        // this is where a re-expansion trap would show up.
        await obsidian.editor().type("anchor line");
        await win.keyboard.press("Enter");
        await win.waitForTimeout(700);

        await obsidian.editor().type("brb");
        await win.keyboard.press("Enter");
        let text = await obsidian.editor().text();
        expect(text).toContain("be right back");
        expect(text).not.toContain("brb");

        // Unlike the space-separator case in B-132, Enter is
        // dispatched through a keymap command (`userEvent: "input"`)
        // rather than the DOM-input path (`userEvent: "input.type"`)
        // that the "brb" keystrokes went through — CM6's history can
        // treat that as its own undo step rather than grouping it
        // with the preceding typing, so fully unwinding back to the
        // anchor line can take more than one Cmd+Z. Keep undoing
        // (bounded) until the expansion itself is gone; the assertion
        // that matters is that it never comes BACK.
        for (let i = 0; i < 4 && text.includes("be right back"); i++) {
            await win.keyboard.press("Meta+Z");
            await win.waitForTimeout(300);
            text = await obsidian.editor().text();
        }

        expect(text).toContain("anchor line");
        expect(text).not.toContain("be right back");

        // The critical assertion: undo must not be a trap. Wait
        // again to catch any delayed re-expansion.
        await win.waitForTimeout(300);
        text = await obsidian.editor().text();
        expect(text).not.toContain("be right back");
    });

    test("[B-149] pasting text ending in a trigger + separator does not expand", async ({
        win,
        obsidian,
    }) => {
        // Before B-149, the expansion hot path couldn't tell a paste
        // from real typing — a pasted block ending in `brb ` would
        // expand inside content the user didn't type character-by-
        // character. The change-source gate only fires on
        // `input.type`/`input` (typing), never `input.paste`.
        await win.evaluate(async () => {
            await navigator.clipboard.writeText("notes: brb ");
        });
        const editor = ui.activeEditor(win);
        await editor.click();
        await win.keyboard.press("Meta+V");

        const text = await obsidian.editor().text();
        expect(text).toContain("notes: brb");
        expect(text).not.toContain("be right back");
    });

    test("[B-149] backspace that deletes a newline does not expand a trigger sitting at the end of the previous line", async ({
        win,
        obsidian,
    }) => {
        // Setup avoids ever pressing Enter right after typing "brb" —
        // that keystroke IS a legitimate separator (B-148) and would
        // expand it, which is correct behavior but not what this
        // test is pinning. Instead: line 2 is created first (empty),
        // then the cursor moves back up to append "brb" to line 1
        // WITHOUT typing a separator after it, then moves back down
        // to line 2's start. Backspace from there deletes the
        // newline and merges line 2 into line 1 — a real CM6
        // "delete.backward" event, never "the user just typed a
        // separator". Must not expand regardless of the resulting
        // document shape.
        await obsidian.editor().type("x");
        await win.keyboard.press("Enter");
        await win.keyboard.press("ArrowUp");
        await win.keyboard.press("End");
        await obsidian.editor().type(" brb");
        await win.keyboard.press("ArrowDown");
        await win.keyboard.press("Backspace");

        const text = await obsidian.editor().text();
        expect(text).toContain("x brb");
        expect(text).not.toContain("be right back");
    });
});

test.describe("expansion respects markdown context", () => {
    test.beforeEach(async ({ obsidian }) => {
        await obsidian.editor().clear();
    });

    test("does NOT expand inside a fenced code block", async ({ win, obsidian }) => {
        // Type ``` and Enter to open a fence, then the trigger.
        // pressSequentially fires real keystrokes so the cm6-bridge
        // sees the separator; the engine's context check (which
        // detects the code fence) must then suppress expansion.
        await obsidian.editor().type("```");
        await win.keyboard.press("Enter");
        await obsidian.editor().type("brb ");
        const text = await obsidian.editor().text();
        // Trigger remains as-typed.
        expect(text).toContain("brb");
        expect(text).not.toContain("be right back");
    });

    test("does NOT expand inside YAML frontmatter", async ({ win, obsidian }) => {
        await obsidian.editor().type("---");
        await win.keyboard.press("Enter");
        await obsidian.editor().type("title: brb ");
        const text = await obsidian.editor().text();
        expect(text).toContain("brb");
        expect(text).not.toContain("be right back");
    });
});
