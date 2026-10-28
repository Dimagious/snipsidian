import { test, expect, ui } from "./fixtures";

/**
 * E2E: variable substitution + cursor placement.
 *
 * Snipsy's engine substitutes `$date` / `$time` / `$filename` /
 * `$clipboard` BEFORE locating the `$|` cursor marker (B-011 fix
 * — locating it the other way around would desync the caret
 * whenever a substituted variable changed length). Unit tests
 * pin this contract at the engine boundary. These E2E tests
 * prove it in the real CM6 editor at the user-visible layer.
 *
 * Test snippets are seeded into the plugin in `beforeEach` so we
 * don't depend on the pristine vault to know about them.
 */

async function seedSnippet(
    win: import("@playwright/test").Page,
    trigger: string,
    replacement: string,
) {
    await win.evaluate(
        async ({ trigger, replacement }) => {
            const plugin = (globalThis as unknown as {
                app?: {
                    plugins?: {
                        plugins?: {
                            snipsidian?: {
                                settings: { snippets: Record<string, string> };
                                saveSettings: () => Promise<void>;
                            };
                        };
                    };
                };
            }).app?.plugins?.plugins?.snipsidian;
            if (!plugin) throw new Error("snipsidian plugin not loaded");
            plugin.settings.snippets[trigger] = replacement;
            await plugin.saveSettings();
        },
        { trigger, replacement },
    );
}

test.describe("variable substitution in real expansion", () => {
    test.beforeEach(async ({ win }) => {
        await ui.clearEditor(win);
    });

    test("`$date` expands to today's date (YYYY-MM-DD)", async ({ win }) => {
        await seedSnippet(win, "datestamp", "$date");
        await ui.typeInEditor(win, "datestamp ");
        const text = await ui.editorText(win);
        // Don't pin the exact date — the test could run across
        // midnight UTC and fail. Just verify the YYYY-MM-DD shape.
        expect(text).toMatch(/\d{4}-\d{2}-\d{2}/);
        expect(text).not.toContain("$date");
        expect(text).not.toContain("datestamp");
    });

    test("`$|` cursor marker substitutes AFTER `$date` (B-011 regression)", async ({
        win,
    }) => {
        // The bug: the marker offset was computed against the raw
        // template, so once `$date` was substituted (length-changing
        // variable), the cursor landed mid-string. Fix: substitute
        // variables first, then locate the marker. Pin the contract
        // end-to-end.
        await seedSnippet(win, "datelog", "Today: $date — $|done");
        await ui.typeInEditor(win, "datelog ");
        // Type more text. If the cursor landed at $| AFTER
        // substitution, "more" should appear between the dash and
        // "done". If the cursor landed at the raw-template offset
        // (the bug), "more" would land somewhere inside the date.
        await ui.typeInEditor(win, "more ");
        const text = await ui.editorText(win);
        // The exact expected layout: "Today: <date> — more done "
        expect(text).toMatch(/Today: \d{4}-\d{2}-\d{2} — more done /);
    });

    test("tabstops `$1` `$2` are not left as literal text (B-192)", async ({
        win,
    }) => {
        // B-192: hotstring expansion used to insert `$1`/`$2` literally.
        // With a `$|` present it wins and every `$N` is stripped.
        await seedSnippet(win, "fn", "function $1($2) { $| }");
        await ui.typeInEditor(win, "fn ");
        const text = await ui.editorText(win);
        expect(text).not.toContain("$1");
        expect(text).not.toContain("$2");
        expect(text).not.toContain("$|");
        expect(text).toContain("function () {  }");
    });

    test("[B-192] `[$1](url)` with no `$|` puts the caret between the brackets", async ({
        win,
    }) => {
        await seedSnippet(win, "lnk", "[$1](url)");
        await ui.typeInEditor(win, "lnk ");
        expect(await ui.editorText(win)).toBe("[](url) ");
        // Hotstring cursor lands before the separator-free expansion end;
        // typing now must go inside the brackets, not after the link.
        await ui.typeInEditor(win, "text");
        expect(await ui.editorText(win)).toBe("[text](url) ");
    });
});
