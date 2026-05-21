import { test, expect } from "./fixtures";
import * as fs from "node:fs";
import * as path from "node:path";

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
        win,
        vaultPath,
    }) => {
        // Mutate settings via the plugin's public API and trigger
        // saveSettings(). This is the same path the UI uses
        // internally — testing it explicitly proves that
        // saveSettings actually writes to disk and doesn't just
        // mutate the in-memory cache.
        await win.evaluate(async () => {
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
            plugin.settings.snippets["persisted"] = "value-after-save";
            await plugin.saveSettings();
        });

        // Read the actual data.json from the vault on disk. This is
        // the file Obsidian will load on next startup. If
        // saveSettings is broken, the snippet won't be here even
        // though it's in the in-memory cache.
        const dataPath = path.join(
            vaultPath,
            ".obsidian",
            "plugins",
            "snipsidian",
            "data.json",
        );
        const dataJson = JSON.parse(fs.readFileSync(dataPath, "utf8"));
        expect(dataJson.snippets).toBeDefined();
        expect(dataJson.snippets.persisted).toBe("value-after-save");
    });

    test("[B-110] an edited snippet replacement survives an Obsidian app reload", async ({
        win,
    }) => {
        // The existing reload test pins ADD + reload. This pins EDIT
        // + reload — saveSettings on a mutated existing key should
        // overwrite the data.json entry, not leave a stale value.
        await win.evaluate(async () => {
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
            // Pre-seed an entry (idempotent — fresh vault each test).
            plugin.settings.snippets["edited"] = "original value";
            await plugin.saveSettings();
            // Now mutate the same key and save again.
            plugin.settings.snippets["edited"] = "new value after edit";
            await plugin.saveSettings();
        });

        await win.evaluate(() => {
            const a = (globalThis as unknown as {
                app?: { commands?: { executeCommandById?: (id: string) => void } };
            }).app;
            a?.commands?.executeCommandById?.("app:reload");
        });

        await win.waitForSelector(".cm-content[contenteditable=true]", {
            timeout: 30_000,
        });

        const loadedValue = await win.evaluate(() => {
            const plugin = (globalThis as unknown as {
                app?: {
                    plugins?: {
                        plugins?: {
                            snipsidian?: {
                                settings: { snippets: Record<string, string> };
                            };
                        };
                    };
                };
            }).app?.plugins?.plugins?.snipsidian;
            return plugin?.settings?.snippets?.["edited"] ?? null;
        });
        // The edit MUST survive — not the original value.
        expect(loadedValue).toBe("new value after edit");
    });

    test("[B-110] a deleted snippet stays deleted across an Obsidian app reload", async ({
        win,
    }) => {
        // Pre-seed + save + delete + save + reload. The key must be
        // absent in the post-reload settings. Pins the destructive
        // round-trip — without this, a saveSettings that skipped the
        // delete branch would leave dead snippets resurrect across
        // reloads.
        await win.evaluate(async () => {
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
            plugin.settings.snippets["soon_deleted"] = "to be removed";
            await plugin.saveSettings();
            delete plugin.settings.snippets["soon_deleted"];
            await plugin.saveSettings();
        });

        await win.evaluate(() => {
            const a = (globalThis as unknown as {
                app?: { commands?: { executeCommandById?: (id: string) => void } };
            }).app;
            a?.commands?.executeCommandById?.("app:reload");
        });

        await win.waitForSelector(".cm-content[contenteditable=true]", {
            timeout: 30_000,
        });

        const present = await win.evaluate(() => {
            const plugin = (globalThis as unknown as {
                app?: {
                    plugins?: {
                        plugins?: {
                            snipsidian?: {
                                settings: { snippets: Record<string, string> };
                            };
                        };
                    };
                };
            }).app?.plugins?.plugins?.snipsidian;
            return plugin?.settings?.snippets?.["soon_deleted"] !== undefined;
        });
        expect(present).toBe(false);
    });

    test("a snippet survives an Obsidian app reload", async ({ win }) => {
        // Step 1: write a snippet and save to disk.
        await win.evaluate(async () => {
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
            plugin.settings.snippets["survives_reload"] = "still here";
            await plugin.saveSettings();
        });

        // Step 2: reload the app's renderer process. After this
        // the plugin reloads from disk; the in-memory settings are
        // discarded.
        await win.evaluate(() => {
            const a = (globalThis as unknown as {
                app?: { commands?: { executeCommandById?: (id: string) => void } };
            }).app;
            // "app:reload" is Obsidian's built-in command; it reloads
            // the renderer process the same way Cmd+R does.
            a?.commands?.executeCommandById?.("app:reload");
        });

        // Step 3: wait for the workspace to remount after reload.
        // The .cm-content selector returns once the editor is back.
        await win.waitForSelector(".cm-content[contenteditable=true]", {
            timeout: 30_000,
        });

        // Step 4: verify the snippet came back from disk.
        const loadedValue = await win.evaluate(() => {
            const plugin = (globalThis as unknown as {
                app?: {
                    plugins?: {
                        plugins?: {
                            snipsidian?: {
                                settings: { snippets: Record<string, string> };
                            };
                        };
                    };
                };
            }).app?.plugins?.plugins?.snipsidian;
            return plugin?.settings?.snippets?.["survives_reload"] ?? null;
        });
        expect(loadedValue).toBe("still here");
    });
});
