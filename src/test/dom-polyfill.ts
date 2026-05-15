/**
 * Polyfill for Obsidian's HTMLElement extensions, so UI components
 * compiled against `obsidian.d.ts` can be mounted in jsdom for tests.
 *
 * Production code calls things like `el.createDiv({ cls: "x" })`,
 * `el.setAttr("aria-label", "y")`, `el.addClass("z")`, `el.empty()`
 * — these are Obsidian's global augmentations of HTMLElement, not
 * standard DOM. jsdom only ships the standard DOM, so we install the
 * extensions here.
 *
 * Call `installObsidianDomHelpers()` once per test file (typically in
 * a `beforeAll`) before mounting components. The function is
 * idempotent — calling it again is a cheap no-op.
 *
 * Scope: only the helpers Snipsy's redesigned components actually
 * call. Adding new ones is mechanical when a test surfaces a gap.
 */

interface DomElementInfo {
    cls?: string | string[];
    text?: string;
    attr?: Record<string, string | number | boolean | null>;
    type?: string;
    href?: string;
    title?: string;
}

// `activeDocument`, `activeWindow`, and the global `createEl` /
// `createDiv` / `createSpan` are declared by obsidian's own type
// declarations (`types: ["node", "obsidian"]` in tsconfig). We don't
// need to redeclare them here.

function applyOptions(el: HTMLElement, opts: DomElementInfo | string | undefined) {
    if (!opts) return;
    if (typeof opts === "string") {
        // Legacy convenience: opts is a class-name string.
        el.className = opts;
        return;
    }
    if (opts.cls) {
        el.className = Array.isArray(opts.cls) ? opts.cls.join(" ") : opts.cls;
    }
    if (opts.text !== undefined) el.textContent = opts.text;
    if (opts.type) el.setAttribute("type", opts.type);
    if (opts.href) el.setAttribute("href", opts.href);
    if (opts.title) el.setAttribute("title", opts.title);
    if (opts.attr) {
        for (const [key, value] of Object.entries(opts.attr)) {
            if (value === null) continue;
            el.setAttribute(key, String(value));
        }
    }
}

function createElImpl(
    this: HTMLElement | Document,
    tag: string,
    opts?: DomElementInfo | string,
    cb?: (el: HTMLElement) => void,
): HTMLElement {
    const doc = this instanceof Document ? this : this.ownerDocument!;
    const el = doc.createElement(tag);
    applyOptions(el, opts);
    if (this instanceof HTMLElement) this.appendChild(el);
    if (cb) cb(el);
    return el;
}

let installed = false;

/**
 * Idempotently install Obsidian's HTMLElement extensions into the
 * jsdom DOM. Must be called before mounting any UI component.
 */
export function installObsidianDomHelpers(): void {
    if (installed) return;
    if (typeof HTMLElement === "undefined") {
        throw new Error(
            "installObsidianDomHelpers() requires a DOM. Add `// @vitest-environment jsdom` " +
                "to the top of the test file.",
        );
    }

    const proto = HTMLElement.prototype as unknown as Record<string, unknown>;

    proto.createEl = function (
        this: HTMLElement,
        tag: string,
        opts?: DomElementInfo | string,
        cb?: (el: HTMLElement) => void,
    ): HTMLElement {
        return createElImpl.call(this, tag, opts, cb);
    };

    proto.createDiv = function (
        this: HTMLElement,
        opts?: DomElementInfo | string,
        cb?: (el: HTMLDivElement) => void,
    ): HTMLDivElement {
        return createElImpl.call(this, "div", opts, cb as (el: HTMLElement) => void) as HTMLDivElement;
    };

    proto.createSpan = function (
        this: HTMLElement,
        opts?: DomElementInfo | string,
        cb?: (el: HTMLSpanElement) => void,
    ): HTMLSpanElement {
        return createElImpl.call(this, "span", opts, cb as (el: HTMLElement) => void) as HTMLSpanElement;
    };

    proto.setAttr = function (this: HTMLElement, name: string, value: string | number | boolean): void {
        this.setAttribute(name, String(value));
    };

    proto.addClass = function (this: HTMLElement, ...classes: string[]): void {
        this.classList.add(...classes);
    };

    proto.removeClass = function (this: HTMLElement, ...classes: string[]): void {
        this.classList.remove(...classes);
    };

    proto.toggleClass = function (this: HTMLElement, cls: string, force?: boolean): void {
        if (force === undefined) this.classList.toggle(cls);
        else if (force) this.classList.add(cls);
        else this.classList.remove(cls);
    };

    proto.hasClass = function (this: HTMLElement, cls: string): boolean {
        return this.classList.contains(cls);
    };

    proto.empty = function (this: HTMLElement): void {
        while (this.firstChild) this.removeChild(this.firstChild);
    };

    proto.setText = function (this: HTMLElement, text: string): void {
        this.textContent = text;
    };

    // `appendText` is rarely used directly in Snipsy but a few legacy
    // call sites still reach for it via the activeDocument helper. The
    // function isn't on HTMLElement in Obsidian's typings — it's on
    // global. We don't need it here; left as a note for the next gap.

    // Global `createEl`, `createDiv`, `createSpan` (Obsidian exposes
    // these as window-level helpers for code that constructs detached
    // elements like `<a>` for downloads).
    const g = globalThis as Record<string, unknown>;
    g.createEl = function (
        tag: string,
        opts?: DomElementInfo | string,
        cb?: (el: HTMLElement) => void,
    ): HTMLElement {
        const el = document.createElement(tag);
        applyOptions(el, opts);
        if (cb) cb(el);
        return el;
    };
    type CreateElFn = (
        tag: string,
        opts?: DomElementInfo | string,
        cb?: (el: HTMLElement) => void,
    ) => HTMLElement;
    g.createDiv = function (
        opts?: DomElementInfo | string,
        cb?: (el: HTMLDivElement) => void,
    ): HTMLDivElement {
        return (g.createEl as CreateElFn)("div", opts, cb as (el: HTMLElement) => void) as HTMLDivElement;
    };
    g.createSpan = function (
        opts?: DomElementInfo | string,
        cb?: (el: HTMLSpanElement) => void,
    ): HTMLSpanElement {
        return (g.createEl as CreateElFn)("span", opts, cb as (el: HTMLElement) => void) as HTMLSpanElement;
    };

    // `activeDocument` / `activeWindow` are Obsidian's popout-safe
    // accessors. In tests they collapse to the jsdom document/window.
    if (!("activeDocument" in g)) g.activeDocument = document;
    if (!("activeWindow" in g)) g.activeWindow = window;

    installed = true;
}
