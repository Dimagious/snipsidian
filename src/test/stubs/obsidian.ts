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
 * `Setting` fluent builder. Mounts a `<div class="setting-item">` per
 * row, shaped like real Obsidian's output (`.setting-item-info` >
 * `.setting-item-name` / `.setting-item-description`, plus a
 * `.setting-item-control` that every `add*()` call mounts into) so
 * mount tests can query rows the same way regardless of whether the
 * production code used `Setting` directly or through
 * `src/ui/utils/setting-group.ts`'s `SettingGroup`/fallback branches.
 * Not a faithful reproduction of Obsidian's full `Setting` class —
 * just enough for mount tests.
 */
export class Setting {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- DOM-shaped fields
    settingEl: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- DOM-shaped fields
    infoEl: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- DOM-shaped fields
    nameEl: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- DOM-shaped fields
    descEl: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- DOM-shaped fields
    controlEl: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- accept any test container
    constructor(containerEl: any) {
        if (typeof document !== "undefined" && containerEl?.appendChild) {
            this.settingEl = document.createElement("div");
            this.settingEl.classList.add("setting-item");
            this.infoEl = document.createElement("div");
            this.infoEl.classList.add("setting-item-info");
            this.nameEl = document.createElement("div");
            this.nameEl.classList.add("setting-item-name");
            this.descEl = document.createElement("div");
            this.descEl.classList.add("setting-item-description");
            this.infoEl.appendChild(this.nameEl);
            this.infoEl.appendChild(this.descEl);
            this.controlEl = document.createElement("div");
            this.controlEl.classList.add("setting-item-control");
            this.settingEl.appendChild(this.infoEl);
            this.settingEl.appendChild(this.controlEl);
            containerEl.appendChild(this.settingEl);
        }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- string | DocumentFragment, mirrors real API
    setName(name: any) {
        if (this.nameEl) {
            this.nameEl.textContent = "";
            if (typeof name === "string") this.nameEl.textContent = name;
            else if (name) this.nameEl.appendChild(name);
        }
        return this;
    }
    // Mirrors real Obsidian's `Setting.prototype.setDesc`, which is
    // just `this.descEl.setText(e)` — and `Element.prototype.setText`
    // (Obsidian's own DOM augment, see `enhance.js`) special-cases a
    // `DocumentFragment`/`Node` value: `descEl.empty()` then
    // `descEl.appendChild(e)`, appending it directly rather than
    // stringifying it. A non-Node value goes through `String(e)` and
    // `textContent =`. Verified against `.obsidian-unpacked/{app,
    // enhance}.js` — `setDesc(fragment)` is NOT the "[object
    // DocumentFragment]" bug it looks like at a glance.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- string | DocumentFragment, mirrors real API
    setDesc(desc: any) {
        if (this.descEl) {
            if (typeof document !== "undefined" && (desc instanceof DocumentFragment || desc instanceof Node)) {
                this.descEl.textContent = "";
                this.descEl.appendChild(desc);
            } else {
                this.descEl.textContent = typeof desc === "string" ? desc : String(desc);
            }
        }
        return this;
    }
    setHeading() {
        if (this.settingEl) this.settingEl.classList.add("setting-item-heading");
        return this;
    }
    setClass(cls: string) {
        if (this.settingEl) this.settingEl.classList.add(cls);
        return this;
    }
    setDisabled(_v: boolean) { return this; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    addText(cb: (t: any) => void) {
        const t = new TextComponent(this.controlEl);
        cb(t);
        return this;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    addTextArea(cb: (t: any) => void) {
        const t = new TextAreaComponent(this.controlEl);
        cb(t);
        return this;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    addToggle(cb: (t: any) => void) {
        const t = new ToggleComponent(this.controlEl);
        cb(t);
        return this;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    addDropdown(cb: (d: any) => void) {
        const d = new DropdownComponent(this.controlEl);
        cb(d);
        return this;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    addButton(cb: (b: any) => void) {
        const b = new ButtonComponent(this.controlEl);
        cb(b);
        return this;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    addExtraButton(cb: (b: any) => void) {
        const b = new ExtraButtonComponent(this.controlEl);
        cb(b);
        return this;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    addSearch(cb: (s: any) => void) {
        const s = new SearchComponent(this.controlEl);
        cb(s);
        return this;
    }
}

/** `ExtraButtonComponent` stub — the clickable-icon-with-tooltip
 *  pattern (Select/Expand-all toolbar icons, group Rename/Delete,
 *  Packages refresh). Wraps a `<div>` (matches Obsidian's real
 *  `extraSettingsEl`, not a `<button>`) with `role="button"` +
 *  `tabindex="0"` so it's keyboard-reachable, plus `aria-label` set
 *  by `setTooltip` per the redesign's decision #2 ("aria-label too"). */
export class ExtraButtonComponent {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- HTMLElement at runtime
    extraSettingsEl: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- accept any test container
    constructor(parent?: any) {
        if (typeof document !== "undefined") {
            this.extraSettingsEl = document.createElement("div");
            this.extraSettingsEl.classList.add("clickable-icon", "extra-setting-button");
            this.extraSettingsEl.setAttribute("role", "button");
            this.extraSettingsEl.setAttribute("tabindex", "0");
            if (parent?.appendChild) parent.appendChild(this.extraSettingsEl);
        }
    }
    setIcon(icon: string) {
        if (this.extraSettingsEl) this.extraSettingsEl.dataset.testIcon = icon;
        return this;
    }
    setTooltip(tooltip: string) {
        if (this.extraSettingsEl) {
            this.extraSettingsEl.setAttribute("aria-label", tooltip);
            this.extraSettingsEl.setAttribute("title", tooltip);
        }
        return this;
    }
    setDisabled(disabled: boolean) {
        if (this.extraSettingsEl) {
            if (disabled) this.extraSettingsEl.setAttribute("disabled", "true");
            else this.extraSettingsEl.removeAttribute("disabled");
        }
        return this;
    }
    onClick(cb: () => void) {
        if (this.extraSettingsEl) this.extraSettingsEl.addEventListener("click", cb);
        return this;
    }
}

/** `SearchComponent` stub — wraps a real `<input type=search>`,
 *  used for the toolbar filter inputs mounted via `SettingGroup`/
 *  `Setting.addSearch`. */
export class SearchComponent {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- HTMLElement at runtime
    inputEl: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- HTMLElement at runtime
    clearButtonEl: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- accept any test container
    constructor(parent?: any) {
        if (typeof document !== "undefined") {
            this.inputEl = document.createElement("input");
            this.inputEl.type = "search";
            this.clearButtonEl = document.createElement("div");
            this.clearButtonEl.classList.add("search-input-clear-button");
            if (parent?.appendChild) {
                parent.appendChild(this.inputEl);
                parent.appendChild(this.clearButtonEl);
            }
        }
    }
    setPlaceholder(p: string) { if (this.inputEl) this.inputEl.placeholder = p; return this; }
    setValue(v: string) { if (this.inputEl) this.inputEl.value = v; return this; }
    getValue() { return this.inputEl ? this.inputEl.value : ""; }
    onChange(cb: (v: string) => void) {
        if (this.inputEl) this.inputEl.addEventListener("input", () => cb(this.inputEl.value));
        return this;
    }
    onChanged() { /* real API: subclass hook, no-op here */ }
}

/**
 * `SettingGroup` stub (Obsidian >= 1.11.0). Mirrors the real class's
 * DOM shape exactly (verified against `.obsidian-unpacked/{app,
 * app.css}` — grep `qk=function(e){...}` in `app.js` and
 * `.setting-group`/`.setting-items` in `app.css`):
 *
 *   groupEl (.setting-group)
 *     ├─ headerEl (.setting-item.setting-item-heading)   — prepended
 *     │    ├─ headerInnerEl (.setting-item-name)             only
 *     │    └─ controlEl (.setting-item-control)               when
 *     └─ listEl (.setting-items)                          setHeading(text)
 *
 * `addClass()` targets `groupEl` (NOT `listEl`) — real Obsidian's own
 * `.setting-group .setting-items` CSS is what fills the rows body
 * with `--setting-items-background/padding/radius`; the heading stays
 * outside that fill, exactly like Obsidian's own Editor/Hotkeys pages.
 * `addExtraButton()` mounts into `controlEl` (inside the heading row),
 * matching the real class, not `listEl`.
 */
export class SettingGroup {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- HTMLElement at runtime
    groupEl: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- HTMLElement at runtime
    headerEl: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- HTMLElement at runtime
    private headerInnerEl: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- HTMLElement at runtime
    controlEl: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- HTMLElement at runtime
    listEl: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- HTMLElement at runtime
    private searchContainerEl: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- accept any test container
    constructor(containerEl?: any) {
        if (typeof document !== "undefined") {
            this.groupEl = document.createElement("div");
            this.groupEl.classList.add("setting-group");

            this.headerEl = document.createElement("div");
            this.headerEl.classList.add("setting-item", "setting-item-heading");
            this.headerInnerEl = document.createElement("div");
            this.headerInnerEl.classList.add("setting-item-name");
            this.headerEl.appendChild(this.headerInnerEl);
            this.controlEl = document.createElement("div");
            this.controlEl.classList.add("setting-item-control");
            this.headerEl.appendChild(this.controlEl);

            this.listEl = document.createElement("div");
            this.listEl.classList.add("setting-items");
            this.groupEl.appendChild(this.listEl);

            if (containerEl?.appendChild) containerEl.appendChild(this.groupEl);
        }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- string | DocumentFragment, mirrors real API
    setHeading(text: any) {
        if (this.headerInnerEl) this.headerInnerEl.textContent = typeof text === "string" ? text : "";
        const shown = this.headerEl?.parentElement === this.groupEl;
        if (text && !shown) this.groupEl.prepend(this.headerEl);
        else if (!text && shown) this.headerEl.remove();
        return this;
    }
    addClass(...classes: string[]) {
        if (this.groupEl) this.groupEl.classList.add(...classes);
        return this;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    addSetting(cb: (setting: any) => void) {
        cb(new Setting(this.listEl));
        return this;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    addSearch(cb: (s: any) => void) {
        if (!this.searchContainerEl) {
            this.searchContainerEl = document.createElement("div");
            this.searchContainerEl.classList.add("setting-group-search");
            this.groupEl.insertBefore(this.searchContainerEl, this.listEl);
        }
        cb(new SearchComponent(this.searchContainerEl));
        return this;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    addExtraButton(cb: (b: any) => void) {
        cb(new ExtraButtonComponent(this.controlEl));
        return this;
    }
}

/** `ToggleComponent` stub — wraps a real `<input type=checkbox>` so
 *  mount tests can `.click()`/dispatch `change` on it directly,
 *  rather than the previous stub which discarded `onChange` entirely
 *  (calling `.setValue(x)` returned a fresh no-op object). */
export class ToggleComponent {
    /** The focusable wrapper (`tabindex="0"`) — verified against real
     *  Obsidian 1.13.7: `toggleEl` is `label.checkbox-container`, NOT
     *  the checkbox input (the input itself is `tabindex="-1"`, inert
     *  for keyboard/AT purposes; the label is what gets the
     *  accessible name and receives focus). `addClass`/`setAttr`
     *  callers (e.g. SnippetsTab's group-enable toggle) land on this
     *  element, same as the real API. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- HTMLElement at runtime
    toggleEl: any;
    /** The wrapped `<input type=checkbox>`, exposed separately since
     *  it — not `toggleEl` — carries `.checked` and fires `change`. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- HTMLElement at runtime
    inputEl: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- accept any test container
    constructor(parent?: any) {
        if (typeof document !== "undefined") {
            this.toggleEl = document.createElement("label");
            this.toggleEl.className = "checkbox-container";
            this.toggleEl.tabIndex = 0;
            this.inputEl = document.createElement("input");
            this.inputEl.type = "checkbox";
            this.inputEl.tabIndex = -1;
            this.toggleEl.appendChild(this.inputEl);
            if (parent?.appendChild) parent.appendChild(this.toggleEl);
        }
    }
    setValue(v: boolean) { if (this.inputEl) this.inputEl.checked = v; return this; }
    getValue() { return this.inputEl ? this.inputEl.checked : false; }
    setDisabled(v: boolean) { if (this.inputEl) this.inputEl.disabled = v; return this; }
    setTooltip(tooltip: string) {
        if (this.toggleEl) {
            this.toggleEl.setAttribute("aria-label", tooltip);
            this.toggleEl.setAttribute("title", tooltip);
        }
        return this;
    }
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
export class TextComponent {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- HTMLElement at runtime
    inputEl: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- accept any test container
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
export class TextAreaComponent {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- HTMLElement at runtime
    inputEl: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- accept any test container
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
export class ButtonComponent {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- HTMLElement at runtime
    buttonEl: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- accept any test container
    constructor(parent?: any) {
        if (typeof document !== "undefined") {
            this.buttonEl = document.createElement("button");
            if (parent?.appendChild) parent.appendChild(this.buttonEl);
        }
    }
    setButtonText(t: string) { if (this.buttonEl) this.buttonEl.textContent = t; return this; }
    setCta() { if (this.buttonEl) this.buttonEl.classList.add("mod-cta"); return this; }
    setWarning() { if (this.buttonEl) this.buttonEl.classList.add("mod-warning"); return this; }
    setIcon(icon: string) { if (this.buttonEl) this.buttonEl.dataset.testIcon = icon; return this; }
    setTooltip(tooltip: string) {
        if (this.buttonEl) {
            this.buttonEl.setAttribute("aria-label", tooltip);
            this.buttonEl.setAttribute("title", tooltip);
        }
        return this;
    }
    setDisabled(disabled: boolean) { if (this.buttonEl) this.buttonEl.disabled = disabled; return this; }
    onClick(cb: (evt?: MouseEvent) => void) {
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

/** `Notice` stub. Real Obsidian's `message` param is
 *  `string | DocumentFragment` — B-047's reveal-data-file failure
 *  notice builds a fragment (path + Copy path button), so the stub
 *  must accept (and simply discard) either without throwing. Tests
 *  that need to assert on Notice content replace this class entirely
 *  via `vi.mock("obsidian", ...)` (see BasicTab.test.ts), so this
 *  constructor body stays a no-op. */
export class Notice {
    constructor(_msg: string | DocumentFragment, _duration?: number) {
        // _msg/_duration kept for API compatibility but not used in test stub
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
