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
    registerEditorExtensionCalls: unknown[][] = [];

    constructor(app?: StubApp) {
        this.app = app ?? { workspace: { on: () => { }, offref: () => { } } };
    }

    addCommand = (...args: CommandArgs) => {
        this.addCommandCalls.push(args);
    };

    addSettingTab = (...args: SettingTabArgs) => {
        this.addSettingTabCalls.push(args);
    };

    registerEditorExtension = (...args: unknown[]) => {
        this.registerEditorExtensionCalls.push(args);
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

/**
 * `Setting` fluent builder. Mounts a `<div>` per row + supports the
 * chainable methods Snipsy's modals use (`setName`/`setDesc`/
 * `setHeading`/`addText`/`addTextArea`). Not a faithful reproduction
 * of Obsidian's full Setting class — just enough for mount tests.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- DOM-shaped fields
export class Setting {
    settingEl: any;
    constructor(containerEl: any) {
        if (typeof document !== "undefined" && containerEl?.appendChild) {
            this.settingEl = document.createElement("div");
            this.settingEl.classList.add("setting-item");
            containerEl.appendChild(this.settingEl);
        }
    }
    setName(_name: string) { return this; }
    setDesc(_desc: string) { return this; }
    setHeading() { return this; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    addText(cb: (t: any) => void) {
        const t = new TextComponent(this.settingEl);
        cb(t);
        return this;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    addTextArea(cb: (t: any) => void) {
        const t = new TextAreaComponent(this.settingEl);
        cb(t);
        return this;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    addToggle(cb: (t: any) => void) {
        const t = new ToggleComponent(this.settingEl);
        cb(t);
        return this;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    addDropdown(cb: (d: any) => void) {
        const d = new DropdownComponent(this.settingEl);
        cb(d);
        return this;
    }
}

/** `ToggleComponent` stub — wraps a real `<input type=checkbox>` so
 *  mount tests can `.click()`/dispatch `change` on it directly,
 *  rather than the previous stub which discarded `onChange` entirely
 *  (calling `.setValue(x)` returned a fresh no-op object). */
export class ToggleComponent {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- HTMLElement at runtime
    inputEl: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- accept any test container
    constructor(parent?: any) {
        if (typeof document !== "undefined") {
            this.inputEl = document.createElement("input");
            this.inputEl.type = "checkbox";
            if (parent?.appendChild) parent.appendChild(this.inputEl);
        }
    }
    setValue(v: boolean) { if (this.inputEl) this.inputEl.checked = v; return this; }
    getValue() { return this.inputEl ? this.inputEl.checked : false; }
    setDisabled(v: boolean) { if (this.inputEl) this.inputEl.disabled = v; return this; }
    onChange(cb: (v: boolean) => void) {
        if (this.inputEl) {
            this.inputEl.addEventListener("change", () => cb(this.inputEl.checked));
        }
        return this;
    }
}

/** `DropdownComponent` stub — wraps a real `<select>`. */
export class DropdownComponent {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- HTMLElement at runtime
    selectEl: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- accept any test container
    constructor(parent?: any) {
        if (typeof document !== "undefined") {
            this.selectEl = document.createElement("select");
            if (parent?.appendChild) parent.appendChild(this.selectEl);
        }
    }
    addOption(value: string, display: string) {
        if (this.selectEl) this.selectEl.append(new Option(display, value));
        return this;
    }
    addOptions(options: Record<string, string>) {
        for (const [value, display] of Object.entries(options)) this.addOption(value, display);
        return this;
    }
    setValue(v: string) { if (this.selectEl) this.selectEl.value = v; return this; }
    getValue() { return this.selectEl ? this.selectEl.value : ""; }
    setDisabled(v: boolean) { if (this.selectEl) this.selectEl.disabled = v; return this; }
    onChange(cb: (v: string) => void) {
        if (this.selectEl) {
            this.selectEl.addEventListener("change", () => cb(this.selectEl.value));
        }
        return this;
    }
}

/** `TextComponent` stub — wraps a real `<input type=text>`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class TextComponent {
    inputEl: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(parent?: any) {
        if (typeof document !== "undefined") {
            this.inputEl = document.createElement("input");
            this.inputEl.type = "text";
            if (parent?.appendChild) parent.appendChild(this.inputEl);
        }
    }
    setPlaceholder(p: string) { if (this.inputEl) this.inputEl.placeholder = p; return this; }
    setValue(v: string) { if (this.inputEl) this.inputEl.value = v; return this; }
    getValue() { return this.inputEl ? this.inputEl.value : ""; }
    onChange(cb: (v: string) => void) {
        if (this.inputEl) {
            this.inputEl.addEventListener("input", () => cb(this.inputEl.value));
        }
        return this;
    }
}

/** `TextAreaComponent` stub — wraps a real `<textarea>`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class TextAreaComponent {
    inputEl: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(parent?: any) {
        if (typeof document !== "undefined") {
            this.inputEl = document.createElement("textarea");
            if (parent?.appendChild) parent.appendChild(this.inputEl);
        }
    }
    setPlaceholder(p: string) { if (this.inputEl) this.inputEl.placeholder = p; return this; }
    setValue(v: string) { if (this.inputEl) this.inputEl.value = v; return this; }
    getValue() { return this.inputEl ? this.inputEl.value : ""; }
    onChange(cb: (v: string) => void) {
        if (this.inputEl) {
            this.inputEl.addEventListener("input", () => cb(this.inputEl.value));
        }
        return this;
    }
}

/** `ButtonComponent` stub — wraps a real `<button>`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class ButtonComponent {
    buttonEl: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(parent?: any) {
        if (typeof document !== "undefined") {
            this.buttonEl = document.createElement("button");
            if (parent?.appendChild) parent.appendChild(this.buttonEl);
        }
    }
    setButtonText(t: string) { if (this.buttonEl) this.buttonEl.textContent = t; return this; }
    setCta() { if (this.buttonEl) this.buttonEl.classList.add("mod-cta"); return this; }
    setWarning() { if (this.buttonEl) this.buttonEl.classList.add("mod-warning"); return this; }
    onClick(cb: () => void) {
        if (this.buttonEl) this.buttonEl.addEventListener("click", cb);
        return this;
    }
}

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

/** Modal stub that mirrors Obsidian's contract closely enough for
 *  UI mount tests. In jsdom env, `open()` constructs real DOM nodes
 *  for `modalEl`, `titleEl`, and `contentEl` and attaches them to
 *  `document.body`; `close()` removes them and runs `onClose`. In
 *  node env (no DOM), the methods are no-ops so existing node tests
 *  that instantiate Modal subclasses don't blow up.
 *
 *  Tests drive the modal by calling `.open()`, then querying
 *  `.contentEl` for child elements and dispatching events on them. */
export class Modal {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- HTMLElement at runtime when DOM is available
    modalEl: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- HTMLElement at runtime when DOM is available
    titleEl: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- HTMLElement at runtime when DOM is available
    contentEl: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mirrors the production App reference
    app: any;
    private isOpen = false;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- accept any test App factory
    constructor(app: any) {
        this.app = app;
        // Pre-construct DOM elements when jsdom is available so
        // production code that reaches for `this.titleEl` /
        // `this.contentEl` in the constructor (rare but happens)
        // doesn't NPE. We delay attaching to `document.body` until
        // `open()` so multiple constructed-but-not-opened modals
        // don't leak nodes.
        if (typeof document !== "undefined") {
            this.modalEl = document.createElement("div");
            this.modalEl.classList.add("modal-container");
            this.titleEl = document.createElement("div");
            this.titleEl.classList.add("modal-title");
            this.contentEl = document.createElement("div");
            this.contentEl.classList.add("modal-content");
            this.modalEl.appendChild(this.titleEl);
            this.modalEl.appendChild(this.contentEl);
        }
    }

    open(): void {
        if (this.isOpen) return;
        this.isOpen = true;
        if (typeof document !== "undefined" && this.modalEl) {
            document.body.appendChild(this.modalEl);
        }
        // Subclasses override `onOpen()`; call it explicitly so the
        // test gets a populated contentEl after `.open()`.
        if (typeof this.onOpen === "function") this.onOpen();
    }

    close(): void {
        if (!this.isOpen) return;
        this.isOpen = false;
        if (typeof this.onClose === "function") this.onClose();
        if (this.modalEl?.parentNode) {
            this.modalEl.parentNode.removeChild(this.modalEl);
        }
    }

    /** Subclasses implement `onOpen` to render contents. The base
     *  class declares it as a no-op so direct instantiation works. */
    onOpen(): void {
        // intentionally empty
    }

    /** Subclasses implement `onClose` to tear down listeners or
     *  forward results. Base class no-op. */
    onClose(): void {
        // intentionally empty
    }
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
