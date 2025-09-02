// Minimal stub of the 'obsidian' module for tests.

export class Plugin {
    app: any;
    // we collect calls so tests can assert them
    addCommandCalls: any[] = [];
    addSettingTabCalls: any[] = [];

    constructor(app?: any) {
        this.app = app ?? { workspace: { on: () => { }, offref: () => { } } };
    }

    addCommand = (...args: any[]) => {
        this.addCommandCalls.push(args);
    };

    addSettingTab = (...args: any[]) => {
        this.addSettingTabCalls.push(args);
    };

    loadData = async () => undefined;
    saveData = async () => undefined;
}

// Export the minimal types used in code (optional in tests, but harmless)
export type App = any;
export type Editor = any;
export type EditorPosition = { line: number; ch: number };
export class PluginSettingTab { }
export class Setting { }
export const Platform = { isDesktop: true, isMobile: false };
export class Notice { constructor(_msg: string) { } }
