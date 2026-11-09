import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evalInObsidian } from "obsidian-integration-testing";

/**
 * B-219 smoke tests, run inside a real Obsidian (desktop, version matrix and
 * Android) through `evalInObsidian`. Callbacks are serialized into the
 * renderer, so they only use their arguments, never outer-scope variables.
 *
 * These pin the load-bearing contract per Obsidian version: the plugin
 * loads, its command is registered, settings load, and a typed trigger
 * expands through the real CM6 pipeline (trusted key events, so the
 * typing-only gate in `change-source-gate.ts` is exercised for real).
 */

const PLUGIN_ID = "snipsidian";
const manifest = JSON.parse(
    readFileSync(new URL("../manifest.json", import.meta.url), "utf8"),
) as { version: string };

describe("Snipsy in a real Obsidian", () => {
    it("is installed from the current build, loaded and enabled", async () => {
        const state = await evalInObsidian({
            input: { pluginId: PLUGIN_ID },
            callback: ({ app, pluginId }) => ({
                enabled: app.plugins.enabledPlugins.has(pluginId),
                loaded: app.plugins.plugins[pluginId] !== undefined,
                version: app.plugins.plugins[pluginId]?.manifest.version ?? null,
            }),
        });
        // The version check guards the staging step: the installed plugin must
        // be the build of this checkout, not a leftover.
        expect(state).toEqual({ enabled: true, loaded: true, version: manifest.version });
    });

    it("registers the snippet picker command under its stable id", async () => {
        const ids = await evalInObsidian({
            input: { prefix: `${PLUGIN_ID}:` },
            callback: ({ app, prefix }) =>
                Object.keys(app.commands.commands).filter((id) => id.startsWith(prefix)),
        });
        // Command ids are public API (hotkeys); renaming one is a breaking change.
        expect(ids).toContain("snipsidian:insert-snippet");
        expect(ids).toContain("snipsidian:open-settings");
    });

    it("loads settings with the seeded Defaults group", async () => {
        const brb = await evalInObsidian({
            input: { pluginId: PLUGIN_ID },
            callback: ({ app, pluginId }) =>
                app.plugins.plugins[pluginId]?.settings?.snippets?.["defaults/brb"] ?? null,
        });
        expect(brb).toBe("be right back");
    });

    it("expands a default trigger typed with trusted key events", async () => {
        const text = await evalInObsidian({
            input: { path: "it-expansion.md" },
            callback: async ({ app, obsidianModule, lib, path }) => {
                const file = await app.vault.create(path, "");
                await app.workspace.getLeaf(true).openFile(file);
                const editor = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.editor;
                if (!editor) throw new Error("no active markdown editor after opening the note");

                await lib.typeIntoEditor({ editor, text: "brb then " });
                // The expansion rewrites the document after the separator key
                // lands, so wait for the final state rather than for any change.
                await lib.waitUntil({
                    predicate: () => !editor.getValue().includes("brb"),
                    message: "trigger `brb` was never replaced",
                });
                return editor.getValue();
            },
        });
        // Cursor continues after the typed separator (B-182).
        expect(text).toBe("be right back then ");
    });

    it("leaves unknown triggers untouched", async () => {
        const text = await evalInObsidian({
            input: { path: "it-no-expansion.md" },
            callback: async ({ app, obsidianModule, lib, path }) => {
                const file = await app.vault.create(path, "");
                await app.workspace.getLeaf(true).openFile(file);
                const editor = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.editor;
                if (!editor) throw new Error("no active markdown editor after opening the note");

                await lib.typeIntoEditor({ editor, text: "notatrigger " });
                await lib.waitUntil({ predicate: () => editor.getValue().length >= "notatrigger ".length });
                return editor.getValue();
            },
        });
        expect(text).toBe("notatrigger ");
    });
});
