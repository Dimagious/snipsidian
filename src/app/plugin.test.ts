import { describe, it, expect, vi, beforeEach } from "vitest";
import type { App, Command, Editor, MarkdownFileInfo, PluginManifest } from "obsidian";
import { makeMockEditor, asEditor } from "../test/factories/editor";
import { nth } from "../test/helpers";

/** What the fake `Plugin` below records about the calls the plugin makes to its base class. */
interface PluginRecord {
    addCommandCalls: Command[][];
    addSettingTabCalls: unknown[][];
    registerEditorExtensionCalls: unknown[][];
}
const recorded = vi.hoisted((): PluginRecord[] => []);

// Virtual mock for 'obsidian' (no real package resolution)
vi.mock("obsidian", () => {
    class Plugin {
        app: unknown;
        addCommandCalls: Command[][] = [];
        addSettingTabCalls: unknown[][] = [];
        registerEditorExtensionCalls: unknown[][] = [];
        constructor(app?: unknown) {
            this.app = app ?? { workspace: { on: vi.fn(), offref: vi.fn() } };
            recorded.push(this);
        }
        addCommand = (...args: Command[]) => { this.addCommandCalls.push(args); };
        addSettingTab = (...args: unknown[]) => { this.addSettingTabCalls.push(args); };
        registerEditorExtension = (...args: unknown[]) => { this.registerEditorExtensionCalls.push(args); };
        loadData = vi.fn().mockResolvedValue(undefined);
        saveData = vi.fn().mockResolvedValue(undefined);
    }
    class Modal {
        open() { }
        close() { }
    }
    return { Plugin, Modal };
});

// Bridge mock — B-149 replaced `registerEditorChange` with
// `buildExpansionExtension`, which returns an `Extension` value
// (registered via `this.registerEditorExtension`, not a manual
// disposer — Obsidian's Component lifecycle owns cleanup now).
const fakeExtension = { __fakeExtension: true };
vi.mock("./cm6-bridge", () => ({
    buildExpansionExtension: vi.fn(() => fakeExtension),
}));

// B-243/B-244 command bodies are covered in field-commands.test.ts.
type ExpandTriggerArgs = [
    app: unknown,
    editor: unknown,
    getSnippets: () => Record<string, string>,
    getPrefix: () => string | undefined,
    getPatterns?: () => { rules: ReadonlyArray<{ id: string }> },
];
const expandTrigger = vi.hoisted(() => vi.fn<(...args: ExpandTriggerArgs) => Promise<void>>());
const jumpNext = vi.hoisted(() => vi.fn<(...args: unknown[]) => boolean>());
vi.mock("./field-commands", () => ({
    expandTriggerAtCursor: (...args: ExpandTriggerArgs) => expandTrigger(...args),
    jumpToNextField: (...args: unknown[]) => jumpNext(...args),
}));

// Lightweight UI mock
vi.mock("../ui/settings", () => ({
    SnipSidianSettingTab: class { },
}));

const openAddFromSelection = vi.fn<(...args: unknown[]) => void>();
vi.mock("../ui/components/AddFromSelection", () => ({
    openAddSnippetFromSelection: (...args: unknown[]) => openAddFromSelection(...args),
}));

// Dynamic imports AFTER mocks to ensure they take effect
const { default: PluginClass } = await import("./plugin");
const { buildExpansionExtension } = await import("./cm6-bridge");
const { DEFAULT_SNIPPETS } = await import("../presets");
const { defaultSnippetsAsGroup } = await import("../store/presets");

const MANIFEST: PluginManifest = {
    id: "snipsidian",
    name: "Snipsy",
    author: "test",
    version: "1.0.0",
    minAppVersion: "1.5.0",
    description: "test manifest",
};

/** The slice of `App` the plugin touches while loading. */
function makeApp(extra: object = {}): App {
    return { workspace: { on: vi.fn(), offref: vi.fn() }, ...extra } as unknown as App;
}

function makePlugin(app: App = makeApp()): InstanceType<typeof PluginClass> {
    return new PluginClass(app, MANIFEST);
}

/** What the fake `Plugin` base class recorded for the plugin built last. */
function baseCalls(): PluginRecord {
    return nth(recorded, recorded.length - 1);
}

/** The commands the plugin registered, in order. */
function commands(): Command[] {
    return baseCalls().addCommandCalls.map((args) => nth(args, 0));
}

function commandById(id: string): Command {
    const cmd = commands().find((c) => c.id === id);
    if (!cmd) throw new Error(`Command "${id}" was not registered`);
    return cmd;
}

/** Runs a command's `editorCheckCallback` against an editor whose selection is `selection`. */
function runEditorCheck(cmd: Command, checking: boolean, selection: string): boolean | void {
    const editor = asEditor(makeMockEditor({ selection }));
    const ctx: MarkdownFileInfo = { app: makeApp(), file: null, hoverPopover: null };
    if (!cmd.editorCheckCallback) throw new Error(`Command "${cmd.id}" has no editorCheckCallback`);
    return cmd.editorCheckCallback(checking, editor, ctx);
}

/** The arguments of the most recent `buildExpansionExtension` call. */
function lastBuildArgs(): Parameters<typeof buildExpansionExtension> {
    const calls = vi.mocked(buildExpansionExtension).mock.calls;
    return nth(calls, calls.length - 1);
}

describe("app/plugin", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        recorded.length = 0;
    });

    it("loads with defaults, registers the CM6 expansion extension, adds command and settings tab", async () => {
        const app = makeApp();
        const plugin = makePlugin(app);

        await plugin.onload();

        expect(buildExpansionExtension).toHaveBeenCalledWith(
            app,
            expect.any(Function),
            expect.any(Function),
            expect.any(Function),
            expect.any(Function),
        );
        expect(baseCalls().registerEditorExtensionCalls).toEqual([[fakeExtension]]);
        // collected by our stubbed Plugin
        expect(baseCalls().addCommandCalls.length).toBeGreaterThan(0);
        expect(baseCalls().addSettingTabCalls.length).toBeGreaterThan(0);
        expect(plugin.settings).toBeDefined();
        expect(plugin.settings.snippets).toBeDefined();
    });

    // B-215: a command without `icon` renders as "?" in the mobile toolbar.
    it("every command declares an icon (B-215)", async () => {
        const app = makeApp();
        const plugin = makePlugin(app);
        await plugin.onload();
        const icons = Object.fromEntries(commands().map((c) => [c.id, c.icon]));
        expect(icons).toEqual({
            "insert-snippet": "text-cursor-input",
            "add-snippet-from-selection": "text-select",
            "open-settings": "settings",
            "expand-trigger": "zap",
            "next-field": "arrow-right-to-line",
        });
    });

    describe("expand-trigger command (B-244)", () => {
        async function getCommand(): Promise<{ plugin: InstanceType<typeof PluginClass>; cmd: Command }> {
            const plugin = makePlugin(makeApp());
            await plugin.onload();
            return { plugin, cmd: commandById("expand-trigger") };
        }

        function run(cmd: Command, editor = asEditor(makeMockEditor())): Editor {
            const ctx: MarkdownFileInfo = { app: makeApp(), file: null, hoverPopover: null };
            if (!cmd.editorCallback) throw new Error("no editorCallback");
            cmd.editorCallback(editor, ctx);
            return editor;
        }

        it("is named in sentence case and ships without a default hotkey", async () => {
            const { cmd } = await getCommand();
            expect(cmd.name).toBe("Expand trigger at cursor");
            expect(cmd.hotkeys).toBeUndefined();
        });

        it("runs the expansion with the live snippets and prefix", async () => {
            expandTrigger.mockResolvedValue(undefined);
            const { plugin, cmd } = await getCommand();
            plugin.settings.snippets = { brb: "be right back" };
            const editor = run(cmd);
            const [, passedEditor, getSnippets, getPrefix] = nth(expandTrigger.mock.calls, 0);
            expect(passedEditor).toBe(editor);
            expect(getSnippets?.()).toEqual({ brb: "be right back" });
            expect(getPrefix?.()).toBeUndefined();
            plugin.settings.expansion = { requirePrefix: true, prefixChar: ";" };
            expect(getPrefix?.()).toBe(";");
        });

        it("logs a failing expansion instead of leaving an unhandled rejection", async () => {
            const boom = new Error("boom");
            expandTrigger.mockRejectedValue(boom);
            const log = vi.spyOn(console, "error").mockImplementation(() => {});
            const { cmd } = await getCommand();
            run(cmd);
            await new Promise((r) => setTimeout(r, 0));
            expect(log).toHaveBeenCalledWith("[snipsy] expand-trigger error", boom);
            log.mockRestore();
        });
    });

    describe("next-field command (B-243)", () => {
        it("jumps in the active editor, has the right name and no default hotkey", async () => {
            const plugin = makePlugin(makeApp());
            await plugin.onload();
            const cmd = commandById("next-field");
            expect(cmd.name).toBe("Next field");
            expect(cmd.hotkeys).toBeUndefined();
            const editor = asEditor(makeMockEditor());
            const ctx: MarkdownFileInfo = { app: makeApp(), file: null, hoverPopover: null };
            cmd.editorCallback?.(editor, ctx);
            expect(jumpNext).toHaveBeenCalledWith(editor);
        });
    });

    describe("add-snippet-from-selection command (B-175)", () => {
        async function getCommand(): Promise<{ plugin: InstanceType<typeof PluginClass>; cmd: Command }> {
            const app = makeApp();
            const plugin = makePlugin(app);
            await plugin.onload();
            const cmd = commandById("add-snippet-from-selection");
            return { plugin, cmd };
        }

        it("is registered with a sentence-case name without the plugin name", async () => {
            const { cmd } = await getCommand();
            expect(cmd.name).toBe("Add snippet from selection");
        });

        it("is unavailable with an empty selection (check and run)", async () => {
            const { cmd } = await getCommand();
            expect(runEditorCheck(cmd, true, "")).toBe(false);
            expect(runEditorCheck(cmd, false, "")).toBe(false);
            expect(openAddFromSelection).not.toHaveBeenCalled();
        });

        it("is available but does not open the modal while only checking", async () => {
            const { cmd } = await getCommand();
            expect(runEditorCheck(cmd, true, "abc")).toBe(true);
            expect(openAddFromSelection).not.toHaveBeenCalled();
        });

        it("opens the modal with the exact selection (whitespace and newlines intact)", async () => {
            const { plugin, cmd } = await getCommand();
            expect(runEditorCheck(cmd, false, "  a\nb  ")).toBe(true);
            expect(openAddFromSelection).toHaveBeenCalledWith(plugin, "  a\nb  ");
        });

        it("treats a whitespace-only selection as a selection", async () => {
            const { cmd } = await getCommand();
            expect(runEditorCheck(cmd, true, " ")).toBe(true);
        });
    });

    // B-137: the third arg to `buildExpansionExtension` is a
    // `getPrefix` closure resolved from live settings at call time.
    describe("getPrefix closure (B-137)", () => {
        function getPrefixArg(): () => string | undefined {
            const getPrefix = nth(vi.mocked(buildExpansionExtension).mock.calls, 0)[2];
            if (!getPrefix) throw new Error("buildExpansionExtension was called without getPrefix");
            return getPrefix;
        }

        it("resolves to undefined when the mode is off (default)", async () => {
            const app = makeApp();
            const plugin = makePlugin(app);
            await plugin.onload();
            expect(getPrefixArg()()).toBeUndefined();
        });

        it("resolves to the configured prefixChar when the mode is on", async () => {
            const app = makeApp();
            const plugin = makePlugin(app);
            vi.spyOn(plugin, "loadData").mockResolvedValue({
                snippets: { a: "b" },
                expansion: { requirePrefix: true, prefixChar: ";" },
            });
            await plugin.onload();
            expect(getPrefixArg()()).toBe(";");
        });

        it("defaults to \":\" when the mode is on but prefixChar is unset", async () => {
            const app = makeApp();
            const plugin = makePlugin(app);
            vi.spyOn(plugin, "loadData").mockResolvedValue({
                snippets: { a: "b" },
                expansion: { requirePrefix: true },
            });
            await plugin.onload();
            expect(getPrefixArg()()).toBe(":");
        });

        it("resolves to undefined when requirePrefix is explicitly false, even with a prefixChar set", async () => {
            const app = makeApp();
            const plugin = makePlugin(app);
            vi.spyOn(plugin, "loadData").mockResolvedValue({
                snippets: { a: "b" },
                expansion: { requirePrefix: false, prefixChar: ";" },
            });
            await plugin.onload();
            expect(getPrefixArg()()).toBeUndefined();
        });

        // Hardening (checker follow-up): a corrupt/foreign saved
        // `prefixChar` outside the supported set (":" / ";") must not
        // silently kill all expansion in prefix mode by being passed
        // through as-is — it should clamp back to the ":" default.
        it("falls back to \":\" when the mode is on but prefixChar is a corrupt/unsupported value", async () => {
            const app = makeApp();
            const plugin = makePlugin(app);
            vi.spyOn(plugin, "loadData").mockResolvedValue({
                snippets: { a: "b" },
                expansion: { requirePrefix: true, prefixChar: "€" },
            });
            await plugin.onload();
            expect(getPrefixArg()()).toBe(":");
        });
    });

    describe("getHighlight wiring (B-176)", () => {
        async function getHighlightArg(saved: object | undefined): Promise<() => boolean> {
            const app = makeApp();
            const plugin = makePlugin(app);
            vi.spyOn(plugin, "loadData").mockResolvedValue(saved);
            await plugin.onload();
            const getHighlight = lastBuildArgs()[3];
            if (!getHighlight) throw new Error("buildExpansionExtension was called without getHighlight");
            return getHighlight;
        }

        it("is off by default", async () => {
            expect((await getHighlightArg(undefined))()).toBe(false);
        });

        it("is on only for an explicit true", async () => {
            expect((await getHighlightArg({ snippets: { a: "b" }, expansion: { highlight: true } }))()).toBe(true);
            expect((await getHighlightArg({ snippets: { a: "b" }, expansion: { highlight: false } }))()).toBe(false);
            expect((await getHighlightArg({ snippets: { a: "b" }, expansion: { highlight: "yes" } }))()).toBe(false);
        });

        it("reads the live setting, so a toggle needs no reload", async () => {
            const app = makeApp();
            const plugin = makePlugin(app);
            await plugin.onload();
            const getHighlight = lastBuildArgs()[3];
            if (!getHighlight) throw new Error("buildExpansionExtension was called without getHighlight");
            expect(getHighlight()).toBe(false);
            plugin.settings.expansion = { highlight: true };
            expect(getHighlight()).toBe(true);
        });
    });

    describe("patterns wiring (ADR-0008)", () => {
        async function getPatternsArg(saved: object | undefined): Promise<{ plugin: InstanceType<typeof PluginClass>; get: () => ReturnType<NonNullable<Parameters<typeof buildExpansionExtension>[4]>> }> {
            const plugin = makePlugin(makeApp());
            vi.spyOn(plugin, "loadData").mockResolvedValue(saved);
            await plugin.onload();
            const get = lastBuildArgs()[4];
            if (!get) throw new Error("buildExpansionExtension was called without getPatterns");
            return { plugin, get };
        }

        it("hands the bridge the compiled rules of the live settings", async () => {
            const { plugin, get } = await getPatternsArg({ snippets: { a: "b" } });
            expect(get().rules).toEqual([]);
            plugin.settings.patterns = [{ id: "p", source: "/a$/", replacement: "x", enabled: true, mode: "instant" }];
            await plugin.saveSettings();
            expect(get().rules.map((r) => r.id)).toEqual(["p"]);
        });

        it("compiles once per settings change, not once per call", async () => {
            const { plugin, get } = await getPatternsArg({
                snippets: { a: "b" },
                patterns: [{ id: "p", source: "/a$/", replacement: "x", enabled: true, mode: "instant" }],
            });
            const first = get();
            expect(get()).toBe(first);
            expect(get()).toBe(first);
            plugin.settings.patterns = [{ id: "q", source: "/b$/", replacement: "y", enabled: true, mode: "instant" }];
            await plugin.saveSettings();
            expect(get()).not.toBe(first);
            expect(get().rules.map((r) => r.id)).toEqual(["q"]);
        });

        it("a save that changes no pattern keeps the compiled set, and with it what the runtime guard learned", async () => {
            const { plugin, get } = await getPatternsArg({
                snippets: { a: "b" },
                patterns: [{ id: "p", source: "/a$/", replacement: "x", enabled: true, mode: "instant" }],
            });
            const first = get();
            // e.g. the community cache saves the settings on every fetch
            plugin.settings.snippets = { ...plugin.settings.snippets, c: "d" };
            await plugin.saveSettings();
            await plugin.saveSettings();
            expect(get()).toBe(first);
        });

        it("a changed rule, a toggled rule or a muted group recompiles", async () => {
            const { plugin, get } = await getPatternsArg({
                snippets: { a: "b" },
                patterns: [{ id: "p", source: "/a$/", replacement: "x", enabled: true, mode: "instant", group: "g" }],
            });
            let last = get();
            const expectFresh = (): void => {
                const next = get();
                expect(next).not.toBe(last);
                last = next;
            };
            const rule = plugin.settings.patterns?.[0];
            if (!rule) throw new Error("no rule");
            rule.replacement = "z"; // edited in place, then saved
            await plugin.saveSettings();
            expectFresh();
            rule.enabled = false;
            await plugin.saveSettings();
            expectFresh();
            expect(get().rules).toEqual([]);
            rule.enabled = true;
            await plugin.saveSettings();
            expectFresh();
            plugin.settings.disabledGroups = ["g"];
            await plugin.saveSettings();
            expectFresh();
            expect(get().rules).toEqual([]);
        });

        it("patternHealth() reads the live compiled set: a switch-off shows up, and an unrelated save does not erase it", async () => {
            vi.spyOn(console, "warn").mockImplementation(() => {});
            try {
                const { plugin, get } = await getPatternsArg({
                    snippets: { a: "b" },
                    patterns: [{ id: "p", source: "/a$/", replacement: "x", enabled: true, mode: "instant" }],
                });
                expect(plugin.patternHealth()).toEqual({ switchedOff: [], deadlineHits: 0 });
                const rule = get().rules[0];
                if (!rule) throw new Error("no rule");
                rule.health.switchedOff = "Switched off: slow on this note.";
                rule.health.deadlineCuts = 2;
                await plugin.saveSettings();
                expect(plugin.patternHealth()).toEqual({
                    switchedOff: [{ id: "p", reason: "Switched off: slow on this note." }],
                    deadlineHits: 2,
                });
            } finally {
                vi.restoreAllMocks();
            }
        });

        it("patternHealth() with no patterns is clean", async () => {
            const { plugin } = await getPatternsArg({ snippets: { a: "b" } });
            expect(plugin.patternHealth()).toEqual({ switchedOff: [], deadlineHits: 0 });
        });

        it("a refused rule in data.json is reported once at load and does not stop the others", async () => {
            const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
            try {
                const { get } = await getPatternsArg({
                    snippets: { a: "b" },
                    patterns: [
                        { id: "bad", source: "/(a+)+$/", replacement: "x", enabled: true, mode: "instant" },
                        { id: "good", source: "/b$/", replacement: "y", enabled: true, mode: "separator" },
                    ],
                });
                expect(get().rules.map((r) => r.id)).toEqual(["good"]);
                expect(warn).toHaveBeenCalledTimes(1);
                const call: unknown[] = nth(warn.mock.calls, 0);
                expect(call[0]).toBe("[snipsy] pattern rule disabled");
                expect(call[1]).toMatchObject({ id: "bad" });
                expect(JSON.stringify(call[1])).toMatch(/repeated group/i);
            } finally {
                warn.mockRestore();
            }
        });

        it("saved patterns survive a settings round trip untouched", async () => {
            const patterns = [{ id: "p", source: "/a$/", replacement: "x", enabled: true, mode: "instant" }];
            const { plugin } = await getPatternsArg({ snippets: { a: "b" }, patterns });
            expect(plugin.settings.patterns).toEqual(patterns);
        });

        it("the expand-trigger command passes the patterns on", async () => {
            const plugin = makePlugin(makeApp());
            vi.spyOn(plugin, "loadData").mockResolvedValue({
                snippets: { a: "b" },
                patterns: [{ id: "p", source: "/a$/", replacement: "x", enabled: true, mode: "separator" }],
            });
            await plugin.onload();
            const cmd = commandById("expand-trigger");
            cmd.editorCallback?.(asEditor(makeMockEditor({ text: "a" })), { app: makeApp(), file: null, hoverPopover: null });
            const getPatterns = nth(expandTrigger.mock.calls, 0)[4];
            expect(getPatterns?.().rules.map((r) => r.id)).toEqual(["p"]);
        });
    });

    it("adds open settings command", async () => {
        const app = makeApp({ setting: { open: vi.fn(), openTabById: vi.fn() } });
        const plugin = makePlugin(app);
        plugin.manifest = MANIFEST;

        await plugin.onload();

        // Check that open settings command was added
        expect(commandById("open-settings").name).toBe("Open settings");
    });

    it("loadSettings uses the saved snippets map as-is when one exists", async () => {
        const app = makeApp();
        const plugin = makePlugin(app);
        vi.spyOn(plugin, "loadData").mockResolvedValue({ snippets: { saved: "X" } });
        await plugin.loadSettings();
        expect(plugin.settings.snippets).toEqual({ saved: "X" });
    });

    // B-130 (#55/#56): defaults must not resurrect after the user deletes them.
    it("does not re-add deleted default snippets on reload", async () => {
        const app = makeApp();
        const plugin = makePlugin(app);
        const withoutNowToday = { ...DEFAULT_SNIPPETS } as Record<string, string>;
        delete withoutNowToday.now;
        delete withoutNowToday.today;
        vi.spyOn(plugin, "loadData").mockResolvedValue({ snippets: withoutNowToday });
        await plugin.loadSettings();
        expect(plugin.settings.snippets.now).toBeUndefined();
        expect(plugin.settings.snippets.today).toBeUndefined();
    });

    // B-130 (#55 comment): renaming a default must not bring back a copy
    // under the original trigger.
    it("does not duplicate a renamed default snippet on reload", async () => {
        const app = makeApp();
        const plugin = makePlugin(app);
        const renamed = { ...DEFAULT_SNIPPETS } as Record<string, string>;
        renamed.notes = renamed.note!;
        delete renamed.note;
        vi.spyOn(plugin, "loadData").mockResolvedValue({ snippets: renamed });
        await plugin.loadSettings();
        expect(plugin.settings.snippets.note).toBeUndefined();
        expect(plugin.settings.snippets.notes).toBe(DEFAULT_SNIPPETS.note);
    });

    it("seeds DEFAULT_SNIPPETS and persists them on first install", async () => {
        const app = makeApp();
        const plugin = makePlugin(app);
        vi.spyOn(plugin, "loadData").mockResolvedValue(null);
        const saveData = vi.spyOn(plugin, "saveData");
        await plugin.loadSettings();
        // B-131: seeded as the "defaults" group, not as bare triggers.
        expect(plugin.settings.snippets).toEqual(defaultSnippetsAsGroup());
        // Persisted right away so later deletions of defaults stick.
        expect(saveData).toHaveBeenCalledWith(plugin.settings);
    });

    it("preserves non-snippet fields (ui, communityPackages) from data.json", async () => {
        const app = makeApp();
        const plugin = makePlugin(app);
        vi.spyOn(plugin, "loadData").mockResolvedValue({
            snippets: { a: "b" },
            ui: { activeTab: "community", groupOpen: { g: true } },
        });
        await plugin.loadSettings();
        expect(plugin.settings.ui?.activeTab).toBe("community");
        expect(plugin.settings.ui?.groupOpen).toEqual({ g: true });
    });
});
