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
export const Platform = { 
    isDesktop: true, 
    isMobile: false,
    isMacOS: false,
    isWin: false,
    isLinux: false
};
export class Notice { constructor(_msg: string) { } }
export class Modal { 
    constructor(app: any) { }
    open() { }
    close() { }
}

export class TFolder {
    children?: any[];
    path: string;
    constructor(path: string) {
        this.path = path;
    }
}

export class TFile {
    path: string;
    basename: string;
    extension: string;
    constructor(path: string, basename: string, extension: string) {
        this.path = path;
        this.basename = basename;
        this.extension = extension;
    }
}

export const requestUrl = async (options: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
}): Promise<{
    status: number;
    text: string;
}> => {
    // Mock implementation for tests
    if (options.url.includes('api.github.com')) {
        return {
            status: 200,
            text: JSON.stringify([])
        };
    }
    return {
        status: 200,
        text: ''
    };
};
