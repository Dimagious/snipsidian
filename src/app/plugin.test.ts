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

    it("onunload calls disposer", async () => {
        const app = { workspace: { on: vi.fn(), offref: vi.fn() } } as any;
        // @ts-ignore
        const plugin = new PluginClass(app);
        await plugin.onload();
        await plugin.onunload();
        expect(disposer).toHaveBeenCalled();
    });

    it("loadSettings merges saved with defaults", async () => {
        const app = { workspace: { on: vi.fn(), offref: vi.fn() } } as any;
        // @ts-ignore
        const plugin = new PluginClass(app);
        // @ts-ignore
        plugin.loadData = vi.fn().mockResolvedValue({ snippets: { saved: "X" } });
        await plugin.loadSettings();
        expect(plugin.settings.snippets.saved).toBe("X");
        expect(Object.keys(plugin.settings.snippets).length).toBeGreaterThan(0);
    });
});
