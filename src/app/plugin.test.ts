import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoisted virtual mock for 'obsidian' (no real package resolution)
(vi as any).mock("obsidian", () => {
    class Plugin {
        app: any;
        addCommandCalls: any[] = [];
        addSettingTabCalls: any[] = [];
        constructor(app?: any) {
            this.app = app ?? { workspace: { on: vi.fn(), offref: vi.fn() } };
        }
        addCommand = (...args: any[]) => { this.addCommandCalls.push(args); };
        addSettingTab = (...args: any[]) => { this.addSettingTabCalls.push(args); };
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

// Bridge mock to control disposer
const disposer = vi.fn();
vi.mock("./cm6-bridge", () => ({
    registerEditorChange: vi.fn(() => disposer),
}));

// Lightweight UI mock
vi.mock("../ui/settings", () => ({
    SnipSidianSettingTab: class { },
}));

// Dynamic imports AFTER mocks to ensure they take effect
const { default: PluginClass } = await import("./plugin");
const { registerEditorChange } = await import("./cm6-bridge");
const { DEFAULT_SNIPPETS } = await import("../presets");

describe("app/plugin", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("loads with defaults, registers editor hook, adds command and settings tab", async () => {
        const app = { workspace: { on: vi.fn(), offref: vi.fn() } } as any;
        // @ts-ignore ctor signature comes from stub
        const plugin = new PluginClass(app);

        await plugin.onload();

        expect(registerEditorChange).toHaveBeenCalledWith(app, expect.any(Function));
        // collected by our stubbed Plugin
        expect((plugin as any).addCommandCalls.length).toBeGreaterThan(0);
        expect((plugin as any).addSettingTabCalls.length).toBeGreaterThan(0);
        expect(plugin.settings).toBeDefined();
        expect(plugin.settings.snippets).toBeDefined();
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

    it("onunload calls disposer", async () => {
        const app = { workspace: { on: vi.fn(), offref: vi.fn() } } as any;
        // @ts-ignore
        const plugin = new PluginClass(app);
        await plugin.onload();
        await plugin.onunload();
        expect(disposer).toHaveBeenCalled();
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
        expect(plugin.settings.snippets).toEqual(DEFAULT_SNIPPETS);
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
