// Minimal stub of the 'obsidian' module for tests.
 

// Minimal types for test stubs
interface StubApp {
    workspace?: { on?: () => void; offref?: () => void };
    [key: string]: unknown;
}

type CommandArgs = unknown[];
type SettingTabArgs = unknown[];

export class Plugin {
    app: StubApp;
    // we collect calls so tests can assert them
    addCommandCalls: CommandArgs[] = [];
    addSettingTabCalls: SettingTabArgs[] = [];

    constructor(app?: StubApp) {
        this.app = app ?? { workspace: { on: () => { }, offref: () => { } } };
    }

    addCommand = (...args: CommandArgs) => {
        this.addCommandCalls.push(args);
    };

    addSettingTab = (...args: SettingTabArgs) => {
        this.addSettingTabCalls.push(args);
    };

    loadData = async () => undefined;
    saveData = async () => undefined;
}

// Export the minimal types used in code (optional in tests, but harmless)
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test stub types
export type App = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test stub types
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
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Parameter kept for API compatibility
export class Notice { constructor(_msg: string) { 
    // _msg parameter kept for API compatibility but not used in test stub
} }
export class Modal { 
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars -- Test stub constructor, parameter kept for API compatibility
    constructor(_app: any) { 
    // _app parameter kept for API compatibility but not used in test stub
}
    open() { }
    close() { }
}

export class TFolder {
    children?: TFile[];
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
