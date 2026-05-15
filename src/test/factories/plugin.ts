/**
 * Mock plugin + app + manifest factories. Backlog B-078.
 *
 * Provides just enough of the Obsidian surface to drive integration
 * and UI tests without spinning up a real Obsidian instance. The
 * factories return loose `any`-typed mocks because the production
 * code's type bounds (`SnipSidianPlugin`, `App`) carry deep Obsidian
 * dependencies — modelling them precisely would mean shipping a
 * second copy of `obsidian.d.ts`. Tests cast through `unknown` when
 * the boundary needs it.
 */

import type { SnipSidianSettings } from "../../types";
import { makeMockEditor, MockEditor } from "./editor";

/** Default settings shape — empty snippet library, no community
 *  cache, no UI state. Matches what a brand-new install would look
 *  like after `loadSettings()` against an empty `data.json`. */
export function makeDefaultSettings(): SnipSidianSettings {
    return {
        snippets: {},
    };
}

/**
 * Builds a mock `App`. Tests that need `app.workspace.getActiveViewOfType`
 * pass `activeEditor` to seed the active Markdown view.
 *
 * `getActiveViewOfType` ignores its argument and just returns the
 * mock view (or `null` when there's no active editor). Snipsy only
 * ever passes `MarkdownView`, so the type check inside the real
 * method is moot.
 */
export function makeMockApp(opts: {
    activeEditor?: MockEditor | null;
    obsidianVersion?: string;
    vaultBasePath?: string;
    vaultConfigDir?: string;
} = {}) {
    const activeView = opts.activeEditor
        ? { editor: opts.activeEditor }
        : null;

    return {
        version: opts.obsidianVersion ?? "1.5.0",
        workspace: {
            getActiveViewOfType: (_type: unknown) => activeView,
            on: () => undefined,
            offref: () => undefined,
        },
        vault: {
            adapter: {
                getBasePath: () => opts.vaultBasePath ?? "/test-vault",
            },
            // The configDir lint rule (`obsidianmd/hardcoded-config-path`)
            // exists to keep production code from baking in `.obsidian`.
            // In a test factory the default is just a fixture value —
            // tests that need to assert the path read it back through
            // this same factory. Suppress the rule, document why.
            // eslint-disable-next-line obsidianmd/hardcoded-config-path -- test fixture default; tests read it via the factory
            configDir: opts.vaultConfigDir ?? ".obsidian",
            read: async (_path: string) => "",
            create: async (_path: string, _data: string) => undefined,
        },
        setting: {
            open: () => undefined,
            openTabById: (_id: string) => undefined,
        },
    };
}

/**
 * Builds a mock `SnipSidianPlugin`. `saveSettings` mutates the
 * in-memory settings reference — tests can read `plugin.settings`
 * after their action to assert what changed.
 */
export function makeMockPlugin(opts: {
    settings?: Partial<SnipSidianSettings>;
    pluginVersion?: string;
    activeEditor?: MockEditor | null;
} = {}) {
    const settings: SnipSidianSettings = {
        ...makeDefaultSettings(),
        ...opts.settings,
    };

    const saveCalls: SnipSidianSettings[] = [];
    const app = makeMockApp({ activeEditor: opts.activeEditor });

    return {
        app,
        settings,
        manifest: { version: opts.pluginVersion ?? "1.1.1" },
        saveSettings: async () => {
            // Snapshot the settings at save time so tests can assert
            // the exact state that was written (vs the current
            // mutable reference).
            saveCalls.push(structuredClone(settings));
        },
        /** Test helper: returns the list of settings snapshots
         *  captured by `saveSettings`. Length === number of saves. */
        _saveCalls: saveCalls,
    };
}

export { makeMockEditor, MockEditor };
