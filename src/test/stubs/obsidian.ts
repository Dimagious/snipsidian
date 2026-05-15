// Stub of the 'obsidian' module for tests. See `src/test/factories/`
// for higher-level builders that hand back ready-to-use instances of
// these types. The stub deliberately keeps each export minimal — just
// what the production code imports at type / runtime level.

// ---------- Common shape types ----------

// Minimal types for test stubs
interface StubApp {
    workspace?: { on?: () => void; offref?: () => void };
    [key: string]: unknown;
}

type CommandArgs = unknown[];
type SettingTabArgs = unknown[];

export type EditorPosition = { line: number; ch: number };

// ---------- Plugin lifecycle ----------

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

// ---------- Typing bridges ----------
//
// These exports are `any` because the production code threads
// Obsidian types through deep generic signatures we don't want to
// re-model. Tests interact with factory-built mocks (typed loosely
// internally) and cast through `unknown` at the boundary.

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test stub types
export type App = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test stub types
export type Editor = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test stub types
export type IconName = any;

// ---------- Settings + UI primitives ----------

export class PluginSettingTab { }
export class Setting { }

// ---------- Platform / runtime ----------

export const Platform = {
    isDesktop: true,
    isMobile: false,
    isMacOS: false,
    isWin: false,
    isLinux: false
};

export class Notice {
    constructor(_msg: string) {
        // _msg parameter kept for API compatibility but not used in test stub
    }
}

// ---------- Modal + workspace types ----------

export class Modal {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test stub constructor, parameter kept for API compatibility
    constructor(_app: any) {
        // _app parameter kept for API compatibility but not used in test stub
    }
    open() { }
    close() { }
}

/** Stub for `MarkdownView`. Production code only reads `.editor` off
 *  the result of `getActiveViewOfType(MarkdownView)`, so we model
 *  exactly that. Tests pass a `MockEditor` via the plugin factory. */
export class MarkdownView {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock editor reference
    editor: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- accept any test editor
    constructor(editor?: any) {
        this.editor = editor;
    }
}

/** Stub for `WorkspaceLeaf` — currently only referenced as a type by
 *  the plugin lifecycle wiring; runtime methods aren't used in tests. */
export class WorkspaceLeaf { }

// ---------- File system ----------

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

// ---------- Network ----------

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

// ---------- Icon helpers ----------

/** `setIcon` in production calls into Obsidian's icon registry to
 *  render an SVG into `parent`. In tests we just append a marker so
 *  selectors / assertions can verify which icon was requested. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- HTMLElement at runtime
export function setIcon(parent: any, iconId: string): void {
    if (parent && typeof parent === "object") {
        // Defensive: in node env without jsdom there's no Element class,
        // so we just stamp a property for assertions.
        if ("dataset" in parent) {
            (parent as { dataset: Record<string, string> }).dataset.testIcon = iconId;
        }
    }
}
