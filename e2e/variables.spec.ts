import { test, expect, seedSnippets } from "./fixtures";

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

test.describe("variable substitution in real expansion", () => {
    test.beforeEach(async ({ obsidian }) => {
        await obsidian.editor().clear();
    });

    test("`$date` expands to today's date (YYYY-MM-DD)", async ({ obsidian }) => {
        await seedSnippets(obsidian, { datestamp: "$date" });
        await obsidian.editor().type("datestamp ");
        const text = await obsidian.editor().text();
        // Don't pin the exact date — the test could run across
        // midnight UTC and fail. Just verify the YYYY-MM-DD shape.
        expect(text).toMatch(/\d{4}-\d{2}-\d{2}/);
        expect(text).not.toContain("$date");
        expect(text).not.toContain("datestamp");
    });

    test("`$|` cursor marker substitutes AFTER `$date` (B-011 regression)", async ({ obsidian }) => {
        // The bug: the marker offset was computed against the raw
        // template, so once `$date` was substituted (length-changing
        // variable), the cursor landed mid-string. Fix: substitute
        // variables first, then locate the marker. Pin the contract
        // end-to-end.
        await seedSnippets(obsidian, { datelog: "Today: $date — $|done" });
        await obsidian.editor().type("datelog ");
        // Type more text. If the cursor landed at $| AFTER
        // substitution, "more" should appear between the dash and
        // "done". If the cursor landed at the raw-template offset
        // (the bug), "more" would land somewhere inside the date.
        await obsidian.editor().type("more ");
        const text = await obsidian.editor().text();
        // The exact expected layout: "Today: <date> — more done "
        expect(text).toMatch(/Today: \d{4}-\d{2}-\d{2} — more done /);
    });

    test("tabstops `$1` `$2` are not left as literal text (B-192)", async ({ obsidian }) => {
        // B-192: hotstring expansion used to insert `$1`/`$2` literally.
        // With a `$|` present it wins and every `$N` is stripped.
        await seedSnippets(obsidian, { fn: "function $1($2) { $| }" });
        await obsidian.editor().type("fn ");
        const text = await obsidian.editor().text();
        expect(text).not.toContain("$1");
        expect(text).not.toContain("$2");
        expect(text).not.toContain("$|");
        expect(text).toContain("function () {  }");
    });

    test("[B-192] `[$1](url)` with no `$|` puts the caret between the brackets", async ({ obsidian }) => {
        await seedSnippets(obsidian, { lnk: "[$1](url)" });
        await obsidian.editor().type("lnk ");
        expect(await obsidian.editor().text()).toBe("[](url) ");
        // Hotstring cursor lands before the separator-free expansion end;
        // typing now must go inside the brackets, not after the link.
        await obsidian.editor().type("text");
        expect(await obsidian.editor().text()).toBe("[text](url) ");
    });
});
