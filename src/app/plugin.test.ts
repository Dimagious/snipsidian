import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoisted virtual mock for 'obsidian' (no real package resolution)
(vi as any).mock("obsidian", () => {
    class Plugin {
        app: any;
        addCommandCalls: any[] = [];
        addSettingTabCalls: any[] = [];
        registerEditorExtensionCalls: any[] = [];
        constructor(app?: any) {
            this.app = app ?? { workspace: { on: vi.fn(), offref: vi.fn() } };
        }
        addCommand = (...args: any[]) => { this.addCommandCalls.push(args); };
        addSettingTab = (...args: any[]) => { this.addSettingTabCalls.push(args); };
        registerEditorExtension = (...args: any[]) => { this.registerEditorExtensionCalls.push(args); };
        loadData = vi.fn().mockResolvedValue(undefined);
        saveData = vi.fn().mockResolvedValue(undefined);
    }
    class Modal {
        constructor(app: any) { }
        open() { }
        close() { }
    }
    return { Plugin, Modal };
}, { virtual: true });

// Bridge mock — B-149 replaced `registerEditorChange` with
// `buildExpansionExtension`, which returns an `Extension` value
// (registered via `this.registerEditorExtension`, not a manual
// disposer — Obsidian's Component lifecycle owns cleanup now).
const fakeExtension = { __fakeExtension: true };
vi.mock("./cm6-bridge", () => ({
    buildExpansionExtension: vi.fn(() => fakeExtension),
}));

// Lightweight UI mock
vi.mock("../ui/settings", () => ({
    SnipSidianSettingTab: class { },
}));

// Dynamic imports AFTER mocks to ensure they take effect
const { default: PluginClass } = await import("./plugin");
const { buildExpansionExtension } = await import("./cm6-bridge");
const { DEFAULT_SNIPPETS } = await import("../presets");
const { defaultSnippetsAsGroup } = await import("../store/presets");

describe("app/plugin", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("loads with defaults, registers the CM6 expansion extension, adds command and settings tab", async () => {
        const app = { workspace: { on: vi.fn(), offref: vi.fn() } } as any;
        // @ts-ignore ctor signature comes from stub
        const plugin = new PluginClass(app);

        await plugin.onload();

        expect(buildExpansionExtension).toHaveBeenCalledWith(
            app,
            expect.any(Function),
            expect.any(Function),
        );
        expect((plugin as any).registerEditorExtensionCalls).toEqual([[fakeExtension]]);
        // collected by our stubbed Plugin
        expect((plugin as any).addCommandCalls.length).toBeGreaterThan(0);
        expect((plugin as any).addSettingTabCalls.length).toBeGreaterThan(0);
        expect(plugin.settings).toBeDefined();
        expect(plugin.settings.snippets).toBeDefined();
    });

    // B-137: the third arg to `buildExpansionExtension` is a
    // `getPrefix` closure resolved from live settings at call time.
    describe("getPrefix closure (B-137)", () => {
        function getPrefixArg(): () => string | undefined {
            const call = (buildExpansionExtension as any).mock.calls[0];
            return call[2];
        }

        it("resolves to undefined when the mode is off (default)", async () => {
            const app = { workspace: { on: vi.fn(), offref: vi.fn() } } as any;
            // @ts-ignore
            const plugin = new PluginClass(app);
            await plugin.onload();
            expect(getPrefixArg()()).toBeUndefined();
        });

        it("resolves to the configured prefixChar when the mode is on", async () => {
            const app = { workspace: { on: vi.fn(), offref: vi.fn() } } as any;
            // @ts-ignore
            const plugin = new PluginClass(app);
            // @ts-ignore
            plugin.loadData = vi.fn().mockResolvedValue({
                snippets: { a: "b" },
                expansion: { requirePrefix: true, prefixChar: ";" },
            });
            await plugin.onload();
            expect(getPrefixArg()()).toBe(";");
        });

        it("defaults to \":\" when the mode is on but prefixChar is unset", async () => {
            const app = { workspace: { on: vi.fn(), offref: vi.fn() } } as any;
            // @ts-ignore
            const plugin = new PluginClass(app);
            // @ts-ignore
            plugin.loadData = vi.fn().mockResolvedValue({
                snippets: { a: "b" },
                expansion: { requirePrefix: true },
            });
            await plugin.onload();
            expect(getPrefixArg()()).toBe(":");
        });

        it("resolves to undefined when requirePrefix is explicitly false, even with a prefixChar set", async () => {
            const app = { workspace: { on: vi.fn(), offref: vi.fn() } } as any;
            // @ts-ignore
            const plugin = new PluginClass(app);
            // @ts-ignore
            plugin.loadData = vi.fn().mockResolvedValue({
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
            const app = { workspace: { on: vi.fn(), offref: vi.fn() } } as any;
            // @ts-ignore
            const plugin = new PluginClass(app);
            // @ts-ignore
            plugin.loadData = vi.fn().mockResolvedValue({
                snippets: { a: "b" },
                expansion: { requirePrefix: true, prefixChar: "€" },
            });
            await plugin.onload();
            expect(getPrefixArg()()).toBe(":");
        });
    });

    it("adds open settings command", async () => {
        const app = { 
            workspace: { on: vi.fn(), offref: vi.fn() },
            setting: { open: vi.fn(), openTabById: vi.fn() }
        } as any;
        // @ts-ignore ctor signature comes from stub
        const plugin = new PluginClass(app);
        plugin.manifest = { id: "snipsidian" };

        await plugin.onload();

        // Check that open settings command was added
        const openSettingsCommand = (plugin as any).addCommandCalls.find(
            (call: any[]) => call[0]?.id === "open-settings"
        );
        expect(openSettingsCommand).toBeDefined();
        expect(openSettingsCommand[0].name).toBe("Open settings");
    });

    it("loadSettings uses the saved snippets map as-is when one exists", async () => {
        const app = { workspace: { on: vi.fn(), offref: vi.fn() } } as any;
        // @ts-ignore
        const plugin = new PluginClass(app);
        // @ts-ignore
        plugin.loadData = vi.fn().mockResolvedValue({ snippets: { saved: "X" } });
        await plugin.loadSettings();
        expect(plugin.settings.snippets).toEqual({ saved: "X" });
    });

    // B-130 (#55/#56): defaults must not resurrect after the user deletes them.
    it("does not re-add deleted default snippets on reload", async () => {
        const app = { workspace: { on: vi.fn(), offref: vi.fn() } } as any;
        // @ts-ignore
        const plugin = new PluginClass(app);
        const withoutNowToday = { ...DEFAULT_SNIPPETS } as Record<string, string>;
        delete withoutNowToday.now;
        delete withoutNowToday.today;
        // @ts-ignore
        plugin.loadData = vi.fn().mockResolvedValue({ snippets: withoutNowToday });
        await plugin.loadSettings();
        expect(plugin.settings.snippets.now).toBeUndefined();
        expect(plugin.settings.snippets.today).toBeUndefined();
    });

    // B-130 (#55 comment): renaming a default must not bring back a copy
    // under the original trigger.
    it("does not duplicate a renamed default snippet on reload", async () => {
        const app = { workspace: { on: vi.fn(), offref: vi.fn() } } as any;
        // @ts-ignore
        const plugin = new PluginClass(app);
        const renamed = { ...DEFAULT_SNIPPETS } as Record<string, string>;
        renamed.notes = renamed.note!;
        delete renamed.note;
        // @ts-ignore
        plugin.loadData = vi.fn().mockResolvedValue({ snippets: renamed });
        await plugin.loadSettings();
        expect(plugin.settings.snippets.note).toBeUndefined();
        expect(plugin.settings.snippets.notes).toBe(DEFAULT_SNIPPETS.note);
    });

    it("seeds DEFAULT_SNIPPETS and persists them on first install", async () => {
        const app = { workspace: { on: vi.fn(), offref: vi.fn() } } as any;
        // @ts-ignore
        const plugin = new PluginClass(app);
        // @ts-ignore
        plugin.loadData = vi.fn().mockResolvedValue(null);
        await plugin.loadSettings();
        // B-131: seeded as the "defaults" group, not as bare triggers.
        expect(plugin.settings.snippets).toEqual(defaultSnippetsAsGroup());
        // Persisted right away so later deletions of defaults stick.
        expect((plugin as any).saveData).toHaveBeenCalledWith(plugin.settings);
    });

    it("preserves non-snippet fields (ui, communityPackages) from data.json", async () => {
        const app = { workspace: { on: vi.fn(), offref: vi.fn() } } as any;
        // @ts-ignore
        const plugin = new PluginClass(app);
        // @ts-ignore
        plugin.loadData = vi.fn().mockResolvedValue({
            snippets: { a: "b" },
            ui: { activeTab: "community", groupOpen: { g: true } },
        });
        await plugin.loadSettings();
        expect(plugin.settings.ui?.activeTab).toBe("community");
        expect(plugin.settings.ui?.groupOpen).toEqual({ g: true });
    });
});
