import { test, expect, deleteSnippet, readSnippets, seedSnippets } from "./fixtures";

/**
 * E2E: settings persistence — save → write to disk → load back.
 *
 * This is the highest-stakes regression class: if `saveSettings()`
 * or the loadSettings path breaks, users silently lose snippets.
 * Unit tests can mock the persistence layer; only an end-to-end
 * run proves the round-trip through disk actually works against a
 * real Obsidian plugin lifecycle.
 *
 * Two scenarios:
 *   1. In-session — add a snippet via the API, force-save, verify
 *      the data.json file on disk has the new entry.
 *   2. Cross-reload — same plus call `app.commands` to reload the
 *      app, then check the new Obsidian instance loaded the
 *      snippet back.
 */

test.describe("persistence: save → disk round-trip", () => {
    test("a snippet added via the plugin API lands in data.json on disk", async ({
        vault,
        obsidian,
    }) => {
        // Mutate settings via the plugin's public API and trigger
        // saveSettings(). This is the same path the UI uses
        // internally — testing it explicitly proves that
        // saveSettings actually writes to disk and doesn't just
        // mutate the in-memory cache.
        await seedSnippets(obsidian, { persisted: "value-after-save" });

        // Read the actual data.json from the vault on disk. This is
        // the file Obsidian will load on next startup. If
        // saveSettings is broken, the snippet won't be here even
        // though it's in the in-memory cache.
        const dataJson = JSON.parse(vault.read(".obsidian/plugins/snipsidian/data.json"));
        expect(dataJson.snippets).toBeDefined();
        expect(dataJson.snippets.persisted).toBe("value-after-save");
    });

    test("[B-110] an edited snippet replacement survives an Obsidian app reload", async ({
        obsidian,
    }) => {
        // The existing reload test pins ADD + reload. This pins EDIT
        // + reload — saveSettings on a mutated existing key should
        // overwrite the data.json entry, not leave a stale value.
        // Pre-seed an entry (idempotent — fresh vault each test).
        await seedSnippets(obsidian, { edited: "original value" });
        // Now mutate the same key and save again.
        await seedSnippets(obsidian, { edited: "new value after edit" });

        // `obsidian.reload()` runs Obsidian's "app:reload", waits for the
        // old page to go and for every plugin to load again.
        await obsidian.reload();

        const loadedValue = (await readSnippets(obsidian)).edited ?? null;
        // The edit MUST survive — not the original value.
        expect(loadedValue).toBe("new value after edit");
    });

    test("[B-110] a deleted snippet stays deleted across an Obsidian app reload", async ({
        obsidian,
    }) => {
        // Pre-seed + save + delete + save + reload. The key must be
        // absent in the post-reload settings. Pins the destructive
        // round-trip — without this, a saveSettings that skipped the
        // delete branch would leave dead snippets resurrect across
        // reloads.
        await seedSnippets(obsidian, { soon_deleted: "to be removed" });
        await deleteSnippet(obsidian, "soon_deleted");

        // `obsidian.reload()` runs Obsidian's "app:reload", waits for the
        // old page to go and for every plugin to load again.
        await obsidian.reload();

        const present = (await readSnippets(obsidian)).soon_deleted !== undefined;
        expect(present).toBe(false);
    });

    test("a snippet survives an Obsidian app reload", async ({ obsidian }) => {
        // Step 1: write a snippet and save to disk.
        await seedSnippets(obsidian, { survives_reload: "still here" });

        // Step 2: reload the app's renderer process. After this
        // the plugin reloads from disk; the in-memory settings are
        // discarded.
        // `obsidian.reload()` runs Obsidian's built-in "app:reload", which
        // reloads the renderer process the same way Cmd+R does, then
        // waits for the old page to go and for every plugin to load again.
        await obsidian.reload();

        // Step 3: verify the snippet came back from disk.
        const loadedValue = (await readSnippets(obsidian)).survives_reload ?? null;
        expect(loadedValue).toBe("still here");
    });
});
