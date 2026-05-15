import { test, expect, ui } from "./fixtures";

/**
 * E2E: SnippetPickerModal features beyond the happy path.
 *
 * The basic picker insertion is covered in `picker.spec.ts`. This
 * file pins the polish work from 1.1.1 at the E2E level:
 *
 *   - B-099 result-count badge: shown only when search truncates
 *   - U-002 wrap-selection: title flips when there's an editor
 *     selection at open time
 *   - B-037 no-active-editor: opening the picker without a
 *     Markdown view shows a Notice instead of silently no-op'ing
 *
 * Each of these had a UI mount test in Phase 3 but those use
 * jsdom + the stub Modal. The actual user-visible behaviour
 * depends on the real Obsidian command palette / workspace /
 * editor adapter wiring; this is the file that proves it.
 */

async function openPicker(win: import("@playwright/test").Page) {
    await win.evaluate(() => {
        const a = (globalThis as unknown as {
            app?: { commands?: { executeCommandById?: (id: string) => void } };
        }).app;
        a?.commands?.executeCommandById?.("snipsidian:insert-snippet");
    });
    await win
        .locator(".snippet-picker-modal input[role='combobox']")
        .waitFor({ state: "visible" });
}

test.describe("picker features", () => {
    test("wrap-selection title appears when editor has a non-empty selection (U-002)", async ({
        win,
    }) => {
        // Type some text then select it. We need a real editor
        // selection at the moment the picker opens — that's what
        // the picker reads in `detectInitialSelection()`.
        const editor = ui.activeEditor(win);
        await editor.click();
        await win.keyboard.press("Meta+A");
        await win.keyboard.press("Delete");
        await ui.typeInEditor(win, "this will be wrapped");
        // Cmd+A inside the editor selects all editor content.
        await win.keyboard.press("Meta+A");

        await openPicker(win);

        // Obsidian wraps `titleEl` in `.modal > .modal-header >
        // .modal-title`, as a sibling of `.modal-content` (which is
        // where `contentEl` — our `.snippet-picker-modal` — lives).
        // Scope to the picker's modal via `:has()` so a leftover
        // dialog from a previous test can't satisfy the assertion.
        const title = win.locator(
            ".modal:has(.snippet-picker-modal) .modal-title",
        );
        await expect(title).toHaveText(/Wrap selection/i);

        // Close picker without inserting.
        await win.keyboard.press("Escape");
    });

    test("filter narrows results in the picker", async ({ win }) => {
        const editor = ui.activeEditor(win);
        await editor.click();

        await openPicker(win);
        const filter = win.locator(
            ".snippet-picker-modal input[role='combobox']",
        );

        // The picker shows pristine-seeded snippets PLUS Snipsy's
        // bundled DEFAULT_SNIPPETS (presets.ts: brb, omw, ty, imo,
        // h1, h2, h3, today, now). The exact count varies if
        // presets ever grows, so we just assert that filter
        // narrows the count.
        const initialCount = await win
            .locator(".snippet-picker-modal .snippet-item")
            .count();
        expect(initialCount).toBeGreaterThanOrEqual(3);

        // Filter to "brb" should leave exactly one match — `brb`
        // itself; other defaults / seeds don't contain that substring.
        await filter.fill("brb");
        await win.waitForTimeout(300); // 200ms debounce + render
        const filteredCount = await win
            .locator(".snippet-picker-modal .snippet-item")
            .count();
        expect(filteredCount).toBe(1);
        expect(filteredCount).toBeLessThan(initialCount);

        await win.keyboard.press("Escape");
    });

    test("no-active-editor shows a Notice instead of inserting (B-037)", async ({
        win,
    }) => {
        // Close the active editor leaf so there's no markdown view
        // to insert into. The picker should detect this and surface
        // a Notice rather than silently no-op'ing on Enter.
        await win.evaluate(() => {
            const ws = (globalThis as unknown as {
                app?: { workspace?: { detachLeavesOfType?: (t: string) => void } };
            }).app?.workspace;
            ws?.detachLeavesOfType?.("markdown");
        });

        // Wait for the leaf to detach.
        await win.waitForTimeout(200);

        await openPicker(win);
        const filter = win.locator(
            ".snippet-picker-modal input[role='combobox']",
        );
        await filter.fill("brb");
        await win.waitForTimeout(300);
        await win.keyboard.press("Enter");

        // Notice should surface. Obsidian's Notice container is
        // `.notice-container > .notice`. The Notice text is the
        // exact string set in `SnippetPickerModal.insertSelectedSnippet`.
        const notice = win.locator(".notice", {
            hasText: "Open a Markdown note to insert a snippet",
        });
        await expect(notice).toBeVisible({ timeout: 5_000 });

        // Picker is still open (B-037 fix kept it that way so the
        // user can switch to a note and retry).
        await expect(filter).toBeVisible();

        await win.keyboard.press("Escape");
    });

    test("wrap-selection actually wraps the selected text (B-100)", async ({
        win,
    }) => {
        // The title-flip is covered by the U-002 test above. This
        // test pins the *behaviour*: picking a wrap-style snippet
        // while a selection is live replaces the selection with the
        // wrapped form, not with a raw replacement.
        //
        // Pristine seed: `callout` → `> [!note]\n> $|`. Wrap path
        // (adapters/obsidian-editor.ts:wrapSelectionWithSnippet)
        // substitutes the selection at the `$|` cursor marker when
        // there's no explicit `${SEL}` / `$1` token in the template.
        // So selecting "hello" + picking `callout` should produce
        // `> [!note]\n> hello`.
        const editor = ui.activeEditor(win);
        await editor.click();
        await win.keyboard.press("Meta+A");
        await win.keyboard.press("Delete");
        await ui.typeInEditor(win, "hello");
        await win.keyboard.press("Meta+A");

        await openPicker(win);

        const filter = win.locator(
            ".snippet-picker-modal input[role='combobox']",
        );
        await filter.fill("callout");
        await win.waitForTimeout(300); // debounce + render
        await win.keyboard.press("Enter");

        // Picker closes; assert via plugin API rather than DOM —
        // CodeMirror virtualises lines and `.cm-content`'s
        // innerText can drop the second line.
        const value = await ui.editorText(win);
        expect(value).toBe("> [!note]\n> hello");
    });

    test("keyboard navigation: Arrow / Home / End / Enter (B-101)", async ({
        win,
    }) => {
        // Pins the listbox a11y contract (A-006). The picker is a
        // WAI-ARIA combobox; selection is tracked via
        // `aria-activedescendant` on the search input, which points
        // at the currently-highlighted `role="option"` row. Each row
        // also carries `aria-selected="true"` while active.
        const editor = ui.activeEditor(win);
        await editor.click();
        await win.keyboard.press("Meta+A");
        await win.keyboard.press("Delete");

        await openPicker(win);
        const filter = win.locator(
            ".snippet-picker-modal input[role='combobox']",
        );

        // Wait for the initial render. With an empty query the picker
        // shows ALL seeded + default snippets; we just need ≥ 2 for
        // navigation to be meaningful.
        const items = win.locator(".snippet-picker-modal .snippet-item");
        await expect(items.first()).toBeVisible();
        const total = await items.count();
        expect(total).toBeGreaterThanOrEqual(3);

        // First row is auto-selected.
        await expect(items.nth(0)).toHaveAttribute("aria-selected", "true");

        // ArrowDown → second row.
        await win.keyboard.press("ArrowDown");
        await expect(items.nth(1)).toHaveAttribute("aria-selected", "true");
        await expect(items.nth(0)).toHaveAttribute("aria-selected", "false");

        // ArrowUp → back to first.
        await win.keyboard.press("ArrowUp");
        await expect(items.nth(0)).toHaveAttribute("aria-selected", "true");

        // End → last row.
        await win.keyboard.press("End");
        await expect(items.nth(total - 1)).toHaveAttribute(
            "aria-selected",
            "true",
        );

        // Home → back to first.
        await win.keyboard.press("Home");
        await expect(items.nth(0)).toHaveAttribute("aria-selected", "true");

        // Now move to the row whose trigger is `h1` and Enter — this
        // verifies Enter inserts the *highlighted* row, not the first
        // hit. We get there by filtering first (more reliable than
        // counting ArrowDowns over a default list whose order may
        // shift if presets grow).
        await filter.fill("h1");
        await win.waitForTimeout(300);
        await expect(items.first()).toBeVisible();
        await win.keyboard.press("Enter");

        // `h1` replacement is `# $|`; the cursor marker is stripped
        // on insert, leaving `# ` in the editor.
        const value = await ui.editorText(win);
        expect(value).toBe("# ");
    });

    test("result-count badge shows only when results are truncated (B-102 / B-099)", async ({
        win,
    }) => {
        // The badge `.snipsy-picker-count` is `is-hidden` by default
        // and only loses that class when search returns more matches
        // than the picker's `DEFAULT_LIMIT` (100). Verifying both
        // halves of that contract is the regression for the "always
        // show / never show" twin failure modes.
        //
        // Seed 110 synthetic snippets via plugin API so an empty
        // query exceeds the limit. We restore the original snippets
        // at end-of-test so the badge doesn't leak into a sibling
        // test that ran in parallel — but Playwright's `win` fixture
        // already isolates each test in its own vault, so this is
        // belt-and-braces.
        const editor = ui.activeEditor(win);
        await editor.click();

        // Case 1 — narrow query → badge hidden.
        await openPicker(win);
        const filter = win.locator(
            ".snippet-picker-modal input[role='combobox']",
        );
        await filter.fill("brb");
        await win.waitForTimeout(300);
        const badge = win.locator(".snippet-picker-modal .snipsy-picker-count");
        await expect(badge).toHaveClass(/is-hidden/);

        // Case 2 — seed 110 snippets, reopen picker with empty
        // query → badge shows "Showing 100 of 110".
        await win.keyboard.press("Escape");
        await win.evaluate(() => {
            const settings = (globalThis as unknown as {
                app?: {
                    plugins?: {
                        plugins?: {
                            snipsidian?: {
                                settings?: { snippets?: Record<string, string> };
                                saveSettings?: () => Promise<void>;
                            };
                        };
                    };
                };
            }).app?.plugins?.plugins?.snipsidian;
            if (!settings?.settings?.snippets) return;
            // 110 unique triggers, all prefixed `bulkN`.
            for (let i = 0; i < 110; i++) {
                settings.settings.snippets[`bulk${i}`] = `bulk replacement ${i}`;
            }
            // Don't bother persisting — picker reads from in-memory
            // settings via getAllSnippetsFlat. Skipping the disk
            // write keeps the test fast and avoids a races against
            // the per-test vault cleanup.
        });

        await openPicker(win);
        await win.waitForTimeout(300);
        await expect(badge).not.toHaveClass(/is-hidden/);
        await expect(badge).toContainText(/Showing 100 of \d+/);

        await win.keyboard.press("Escape");
    });
});
