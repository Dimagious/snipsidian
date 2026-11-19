import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { makeMockPlugin } from "../../test/factories/plugin";
import { Menu, Platform } from "../../test/stubs/obsidian";
import type { PatternRule } from "../../engine/types";
import type { SnipSidianSettings } from "../../types";
import { STARTER_RULES } from "../../core/pattern-starter";
import { CAPTURE_HINT, INSTANT_NEEDS_TYPING, PATTERNS_UNREADABLE, PatternsTab, TRY_IT_CUT } from "./PatternsTab";
import type { App } from "obsidian";
import type SnipSidianPlugin from "../../main";

/**
 * Mount tests for the Patterns page (ADR-0008). They drive the page the way a person does: click, type, press keys,
 * and read what the DOM says and what was written to `settings.patterns`.
 */

let root: HTMLDivElement;
let mock: ReturnType<typeof makeMockPlugin>;
let tab: PatternsTab;

const rule = (id: string, extra: Partial<PatternRule> = {}): PatternRule => ({
    id,
    source: `/${id}$/`,
    replacement: id.toUpperCase(),
    enabled: true,
    mode: "instant",
    ...extra,
});

function mount(
    patterns: PatternRule[] | undefined,
    extra: Partial<SnipSidianSettings> = {},
    opts: { switchedOff?: Array<{ id: string; reason: string }> } = {},
): void {
    mock = makeMockPlugin({ settings: { snippets: {}, patterns, ...extra }, switchedOff: opts.switchedOff });
    tab = new PatternsTab(mock.app as unknown as App, mock as unknown as SnipSidianPlugin);
    tab.render(root);
}

beforeEach(() => {
    document.body.innerHTML = "";
    root = document.createElement("div");
    root.classList.add("snipsidian-settings");
    document.body.appendChild(root);
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
    Platform.isMobile = false;
    Menu.last = null;
});

const q = <T extends HTMLElement = HTMLElement>(sel: string, scope: ParentNode = root): T => {
    const el = scope.querySelector<T>(sel);
    if (!el) throw new Error(`Not found: ${sel}`);
    return el;
};
const rows = (): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>(".snipsy-pattern-row:not(.is-new)"));
const row = (i: number): HTMLElement => {
    const found = rows()[i];
    if (!found) throw new Error(`No row ${i}`);
    return found;
};
const rowIds = (): string[] => rows().map((r) => r.dataset.id ?? "");
const stored = (): PatternRule[] => mock.settings.patterns ?? [];
const storedIds = (): string[] => stored().map((r) => r.id);
const button = (text: string, scope: ParentNode = root): HTMLButtonElement => {
    const found = Array.from(scope.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent === text);
    if (!found) throw new Error(`No button "${text}"`);
    return found;
};

function type(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
}
/** The debounce (150 ms) plus the async Try it. */
async function settle(): Promise<void> {
    await vi.advanceTimersByTimeAsync(200);
}
async function click(el: HTMLElement): Promise<void> {
    el.click();
    await settle();
}
function key(el: HTMLElement, k: string, init: KeyboardEventInit = {}): void {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init }));
}
const editor = (): HTMLElement => q(".snipsy-pattern-editor");
const patternInput = (): HTMLInputElement => q<HTMLInputElement>('input[id$="-pattern"]', editor());
const replacementInput = (): HTMLTextAreaElement => q<HTMLTextAreaElement>("textarea", editor());
const modeSelect = (): HTMLSelectElement => q<HTMLSelectElement>("select", editor());
const groupInput = (): HTMLInputElement => q<HTMLInputElement>('input[id$="-group"]', editor());
const tryInput = (): HTMLInputElement => q<HTMLInputElement>('input[id$="-try"]', editor());
const saveButton = (): HTMLButtonElement => button("Save", editor());
const menuItem = (title: string): (() => void) => {
    const item = Menu.last?.items.find((i) => i.title === title);
    if (!item) throw new Error(`No menu item ${title}: ${Menu.last?.items.map((i) => i.title).join(", ")}`);
    return () => item.callback();
};

describe("PatternsTab: page structure", () => {
    it("renders the header row, the list and the starter row, with the list labelled", () => {
        mount([rule("a"), rule("b")]);
        expect(q(".snipsy-patterns-header .setting-item-name").textContent).toBe("Rules");
        expect(q(".snipsy-patterns-header .setting-item-description").textContent).toBe(
            "They run top to bottom and the first match wins. Snippets are tried first.",
        );
        const list = q(".snipsy-pattern-list");
        expect(list.getAttribute("role")).toBe("list");
        expect(list.getAttribute("aria-label")).toBe("Pattern rules");
        expect(rowIds()).toEqual(["a", "b"]);
        expect(root.querySelector(".snipsy-patterns-empty")).toBeNull();
        expect(q(".snipsy-patterns-starter .setting-item-name").textContent).toBe("Typography set");
    });

    it("shows the empty state with the starter offer when there are no rules", () => {
        mount(undefined);
        const empty = q(".snipsy-patterns-empty");
        expect(empty.textContent).toContain("No pattern rules yet.");
        expect(empty.textContent).toContain("Add one, or start with the typography set: fractions, arrows, ≠, ≤, ± and more.");
        expect(button("Add typography set", empty)).toBeTruthy();
        expect(root.querySelector(".snipsy-pattern-list")).toBeNull();
        // The starter row is not shown twice.
        expect(root.querySelector(".snipsy-patterns-starter")).toBeNull();
    });

    it("the empty state adds the whole typography set in one save, enabled, in its group", async () => {
        mount(undefined);
        await click(button("Add typography set"));
        expect(stored()).toHaveLength(32);
        expect(stored().every((r) => r.enabled && r.group === "typography")).toBe(true);
        expect(new Set(storedIds()).size).toBe(32);
        expect(mock._saveCalls).toHaveLength(1);
        expect(rows()).toHaveLength(32);
        // All starter rules are present now: no starter row.
        expect(root.querySelector(".snipsy-patterns-starter")).toBeNull();
    });

    it("describes each row for assistive technology: position, pattern, mode, group", () => {
        mount([rule("a", { mode: "separator", group: "typography" }), rule("b")]);
        const first = row(0);
        const second = row(1);
        expect(q(".snipsy-pattern-main", first).getAttribute("aria-label")).toBe("Rule 1, /a$/, after a separator, Typography");
        expect(q(".snipsy-pattern-main", second).getAttribute("aria-label")).toBe("Rule 2, /b$/, instant");
        expect(q(".snipsy-pattern-main", first).getAttribute("aria-expanded")).toBe("false");
        expect(q(".snipsy-pattern-menu", second).getAttribute("aria-label")).toBe("More actions for rule 2");
        expect(q(".snipsy-pattern-toggle", second).getAttribute("aria-label")).toBe("Turn on rule 2");
        expect(q(".snipsy-pattern-meta", first).textContent).toBe("After a separator · Typography");
    });

    it("shows a newline in a replacement as a return mark, not as a line break", () => {
        mount([rule("a", { replacement: "one\ntwo" })]);
        expect(q(".snipsy-pattern-rep").textContent).toBe("one↵two");
    });
});

describe("PatternsTab: adding and editing", () => {
    it("Add rule opens an empty editor with Pattern focused, Save disabled and no error shown yet", () => {
        mount([rule("a")]);
        button("Add rule").click();
        expect(editor()).toBeTruthy();
        expect(document.activeElement).toBe(patternInput());
        expect(saveButton().disabled).toBe(true);
        expect(q(".snipsidian-error", editor()).textContent).toBe("");
        expect(patternInput().getAttribute("placeholder")).toBe("/(\\d+)\\/(\\d+)$/");
        expect(editor().textContent).toContain("Write it between slashes and end with $. Flag i is allowed.");
        expect(editor().textContent).toContain(CAPTURE_HINT);
        expect(modeSelect().value).toBe("instant");
    });

    it("saves a new rule at the end of the list: enabled, Instant, with the typed pattern", async () => {
        mount([rule("a")]);
        button("Add rule").click();
        type(patternInput(), "/1\\/2$/");
        type(replacementInput(), "½");
        await settle();
        expect(saveButton().disabled).toBe(false);
        await click(saveButton());
        expect(stored()).toHaveLength(2);
        expect(stored()[1]).toMatchObject({ source: "/1\\/2$/", replacement: "½", enabled: true, mode: "instant" });
        expect(stored()[1]?.group).toBeUndefined();
        expect(stored()[1]?.id).toMatch(/^p/);
        expect(mock._saveCalls).toHaveLength(1);
        expect(root.querySelector(".snipsy-pattern-editor")).toBeNull();
        expect(rows()).toHaveLength(2);
        expect(document.activeElement).toBe(q(".snipsy-pattern-main", row(1)));
    });

    it("a refused pattern shows its sentence under the field, marks it invalid, and keeps Save disabled", async () => {
        mount([]);
        button("Add rule").click();
        type(patternInput(), "/a$/g");
        await settle();
        const err = q('[id$="-pattern-err"]', editor());
        expect(err.textContent).toBe("Flag g isn't allowed. Use i or none.");
        expect(patternInput().getAttribute("aria-invalid")).toBe("true");
        expect(patternInput().getAttribute("aria-describedby")).toContain(err.id);
        expect(saveButton().disabled).toBe(true);
        // Clicking a disabled Save writes nothing.
        saveButton().click();
        await settle();
        expect(stored()).toHaveLength(0);
        expect(mock._saveCalls).toHaveLength(0);
        // Fixing it clears the error and enables Save.
        type(patternInput(), "/a$/i");
        await settle();
        expect(err.textContent).toBe("");
        expect(patternInput().getAttribute("aria-invalid")).toBe("false");
        expect(saveButton().disabled).toBe(false);
    });

    it("validates after a pause, not on every key", async () => {
        mount([]);
        button("Add rule").click();
        type(patternInput(), "/a$/g");
        await vi.advanceTimersByTimeAsync(100);
        expect(q('[id$="-pattern-err"]', editor()).textContent).toBe("");
        await vi.advanceTimersByTimeAsync(100);
        expect(q('[id$="-pattern-err"]', editor()).textContent).not.toBe("");
    });

    it("passes the draft's MODE to the gate: the same pattern is refused as Instant and fine After a separator", async () => {
        mount([]);
        button("Add rule").click();
        type(patternInput(), "/\\w+\\d+x$/");
        await settle();
        const err = q('[id$="-pattern-err"]', editor());
        expect(err.textContent).toMatch(/^An instant rule can have at most 1 open-ended repeat/);
        expect(saveButton().disabled).toBe(true);
        modeSelect().value = "separator";
        modeSelect().dispatchEvent(new Event("change", { bubbles: true }));
        await settle();
        expect(err.textContent).toBe("");
        expect(saveButton().disabled).toBe(false);
        expect(q('[id$="-mode-desc"]', editor()).textContent).toBe("Waits for a space, Enter or punctuation, so 1/23 can finish.");
        await click(saveButton());
        expect(stored()[0]?.mode).toBe("separator");
    });

    it("warns, without blocking Save, when the replacement uses a group the pattern lacks", async () => {
        mount([]);
        button("Add rule").click();
        type(patternInput(), "/(\\d+)x$/");
        type(replacementInput(), "{{1}}-{{3}}");
        await settle();
        expect(q(".snipsy-pattern-warnings", editor()).textContent).toBe("{{3}} has no group 3 in the pattern, so it inserts nothing.");
        expect(saveButton().disabled).toBe(false);
    });

    it("refuses an over-long replacement under its own field", async () => {
        mount([]);
        button("Add rule").click();
        type(patternInput(), "/a$/");
        type(replacementInput(), "x".repeat(10_001));
        await settle();
        expect(q('[id$="-replacement-err"]', editor()).textContent).toBe("Keep the replacement to 10,000 characters.");
        expect(replacementInput().getAttribute("aria-invalid")).toBe("true");
        expect(saveButton().disabled).toBe(true);
    });

    it("opens an existing rule on click, shows its values, and Cancel discards the draft", async () => {
        mount([rule("a", { replacement: "old" }), rule("b")]);
        q(".snipsy-pattern-main", row(0)).click();
        expect(q(".snipsy-pattern-main", row(0)).getAttribute("aria-expanded")).toBe("true");
        expect(patternInput().value).toBe("/a$/");
        expect(replacementInput().value).toBe("old");
        type(replacementInput(), "changed");
        await click(button("Cancel", editor()));
        expect(root.querySelector(".snipsy-pattern-editor")).toBeNull();
        expect(stored()[0]?.replacement).toBe("old");
        expect(mock._saveCalls).toHaveLength(0);
        expect(document.activeElement).toBe(q(".snipsy-pattern-main", row(0)));
    });

    it("Save writes the edit in place and keeps the rule's enabled state and position", async () => {
        mount([rule("a", { enabled: false }), rule("b")]);
        q(".snipsy-pattern-main", row(0)).click();
        type(replacementInput(), "new");
        await settle();
        await click(saveButton());
        expect(storedIds()).toEqual(["a", "b"]);
        expect(stored()[0]).toMatchObject({ replacement: "new", enabled: false });
    });

    it("Escape cancels and Mod+Enter saves", async () => {
        mount([rule("a")]);
        q(".snipsy-pattern-main", row(0)).click();
        type(replacementInput(), "kept?");
        key(replacementInput(), "Escape");
        await settle();
        expect(root.querySelector(".snipsy-pattern-editor")).toBeNull();
        expect(stored()[0]?.replacement).toBe("A");

        q(".snipsy-pattern-main", row(0)).click();
        type(replacementInput(), "saved");
        key(replacementInput(), "Enter", { metaKey: true });
        await settle();
        expect(stored()[0]?.replacement).toBe("saved");
    });

    it("Mod+Enter on a refused draft does not save", async () => {
        mount([rule("a")]);
        q(".snipsy-pattern-main", row(0)).click();
        type(patternInput(), "/a$/g");
        key(patternInput(), "Enter", { ctrlKey: true });
        await settle();
        expect(mock._saveCalls).toHaveLength(0);
        expect(root.querySelector(".snipsy-pattern-editor")).not.toBeNull();
    });

    it("only one editor is open at a time", () => {
        mount([rule("a"), rule("b")]);
        q(".snipsy-pattern-main", row(0)).click();
        q(".snipsy-pattern-main", row(1)).click();
        expect(root.querySelectorAll(".snipsy-pattern-editor")).toHaveLength(1);
        expect(patternInput().value).toBe("/b$/");
    });

    it("keeps the editor open and puts the old list back when saving fails", async () => {
        mount([rule("a")]);
        const before = mock.settings.patterns;
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        mock.saveSettings = () => Promise.reject(new Error("disk full"));
        q(".snipsy-pattern-main", row(0)).click();
        type(replacementInput(), "x");
        await settle();
        await click(saveButton());
        expect(mock.settings.patterns).toBe(before);
        expect(root.querySelector(".snipsy-pattern-editor")).not.toBeNull();
    });

    it("an unsupported-mode mix: toggling Fires back and forth keeps the draft text", async () => {
        mount([]);
        button("Add rule").click();
        type(patternInput(), "/ab$/");
        modeSelect().value = "separator";
        modeSelect().dispatchEvent(new Event("change", { bubbles: true }));
        modeSelect().value = "instant";
        modeSelect().dispatchEvent(new Event("change", { bubbles: true }));
        await settle();
        expect(patternInput().value).toBe("/ab$/");
        expect(modeSelect().value).toBe("instant");
    });

    it("turns off autocorrect and capitalisation on the regex fields (mobile keyboards)", () => {
        mount([]);
        button("Add rule").click();
        for (const el of [patternInput(), replacementInput(), tryInput()]) {
            expect(el.getAttribute("autocapitalize")).toBe("off");
            expect(el.getAttribute("autocorrect")).toBe("off");
            expect(el.getAttribute("autocomplete")).toBe("off");
            expect(el.getAttribute("spellcheck")).toBe("false");
        }
    });
});

describe("PatternsTab: groups", () => {
    it("suggests the groups of rules and snippets, as titles", () => {
        mount([rule("a", { group: "typography" })], { snippets: { "my-notes/x": "1" } });
        q(".snipsy-pattern-main", row(0)).click();
        const options = Array.from(editor().querySelectorAll("datalist option")).map((o) => o.getAttribute("value"));
        expect(options.sort()).toEqual(["My Notes", "Typography"]);
    });

    it("stores a typed group as a slug, like a snippet group", async () => {
        mount([]);
        button("Add rule").click();
        type(patternInput(), "/a$/");
        type(groupInput(), "My Symbols!");
        await settle();
        await click(saveButton());
        expect(stored()[0]?.group).toBe("my-symbols");
    });

    it("keeps the stored group when the field is untouched, and clears it when emptied", async () => {
        mount([rule("a", { group: "a_b" })]);
        q(".snipsy-pattern-main", row(0)).click();
        await settle();
        await click(saveButton());
        expect(stored()[0]?.group).toBe("a_b");
        q(".snipsy-pattern-main", row(0)).click();
        type(groupInput(), "");
        await settle();
        await click(saveButton());
        expect(stored()[0]?.group).toBeUndefined();
    });

    it("refuses a group name with no letter or number", async () => {
        mount([]);
        button("Add rule").click();
        type(patternInput(), "/a$/");
        type(groupInput(), "???");
        await settle();
        expect(q('[id$="-group-err"]', editor()).textContent).toBe("Use at least one letter or number in the group name.");
        expect(saveButton().disabled).toBe(true);
    });

    it("the row menu turns a group off and on through disabledGroups, shown as a Group off flair", async () => {
        mount([rule("a", { group: "typography" })]);
        expect(root.querySelector(".group-off-flair")).toBeNull();
        q(".snipsy-pattern-menu", row(0)).click();
        menuItem("Turn off group Typography")();
        await settle();
        expect(mock.settings.disabledGroups).toEqual(["typography"]);
        expect(q(".group-off-flair", row(0)).textContent).toBe("Group off");
        // The rule's own switch is unchanged.
        expect(stored()[0]?.enabled).toBe(true);
        q(".snipsy-pattern-menu", row(0)).click();
        menuItem("Turn on group Typography")();
        await settle();
        expect(mock.settings.disabledGroups).toEqual([]);
        expect(root.querySelector(".group-off-flair")).toBeNull();
    });

    it("has no group item in the menu for an ungrouped rule", () => {
        mount([rule("a")]);
        q(".snipsy-pattern-menu", row(0)).click();
        expect(Menu.last?.items.map((i) => i.title)).toEqual(["Move up", "Move down", "Delete rule"]);
    });
});

describe("PatternsTab: row states", () => {
    it("user off: the toggle is off and the stored value is false, no flair", () => {
        mount([rule("a", { enabled: false })]);
        const target = row(0);
        expect(q<HTMLInputElement>("input", q(".snipsy-pattern-toggle", target)).checked).toBe(false);
        expect(target.classList.contains("is-off")).toBe(true);
        expect(target.querySelector(".snipsy-pattern-flair, .group-off-flair")).toBeNull();
    });

    it("toggling writes enabled at once and saves", async () => {
        mount([rule("a", { enabled: false })]);
        const input = q<HTMLInputElement>("input", q(".snipsy-pattern-toggle", row(0)));
        input.checked = true;
        input.dispatchEvent(new Event("change", { bubbles: true }));
        await settle();
        expect(stored()[0]?.enabled).toBe(true);
        expect(mock._saveCalls).toHaveLength(1);
    });

    it("Error: a refused stored rule shows the Error flair and its reason, the toggle is off and disabled, enabled is untouched", () => {
        mount([rule("a"), rule("bad", { source: "/a$/g", enabled: true })]);
        const target = row(1);
        expect(target.classList.contains("is-error")).toBe(true);
        expect(q(".snipsy-pattern-flair", target).textContent).toBe("Error");
        expect(q(".snipsy-pattern-note", target).textContent).toBe("Flag g isn't allowed. Use i or none.");
        const toggle = q(".snipsy-pattern-toggle", target);
        expect(q<HTMLInputElement>("input", toggle).checked).toBe(false);
        expect(q<HTMLInputElement>("input", toggle).disabled).toBe(true);
        expect(toggle.getAttribute("aria-label")).toBe("Fix the error to turn this rule on");
        expect(q(".snipsy-pattern-main", target).getAttribute("aria-label")).toBe("Rule 2, /a$/g, instant, error");
        expect(stored()[1]?.enabled).toBe(true);
        expect(tab.errorCount()).toBe(1);
    });

    it("Error uses the rule's own mode: two open-ended repeats are fine in a separator rule", () => {
        mount([rule("a", { source: "/\\w+\\d+x$/", mode: "separator" }), rule("b", { source: "/\\w+\\d+x$/", mode: "instant" })]);
        expect(row(0).classList.contains("is-error")).toBe(false);
        expect(row(1).classList.contains("is-error")).toBe(true);
    });

    it("Error: a rule past the 100 limit says it was skipped", () => {
        const many = Array.from({ length: 101 }, (_, i) => rule(`r${i}`));
        mount(many);
        expect(q(".snipsy-pattern-note", row(100)).textContent).toBe("Skipped: over the 100 rule limit.");
        expect(row(99).querySelector(".snipsy-pattern-note")).toBeNull();
    });

    it("Error: a damaged entry from a hand-edited file still renders and can be deleted", async () => {
        mount([rule("a"), null as unknown as PatternRule, { id: "z" } as unknown as PatternRule]);
        expect(rows()).toHaveLength(3);
        expect(q(".snipsy-pattern-note", row(1)).textContent).toBe("This entry is not a rule.");
        expect(q(".snipsy-pattern-note", row(2)).textContent).toBe("This rule has no pattern.");
        q(".snipsy-pattern-menu", row(1)).click();
        menuItem("Delete rule")();
        button("Delete", document.body).click();
        await settle();
        expect(stored()).toHaveLength(2);
    });

    it("Paused: a rule the guard switched off shows a flair and why, and keeps its stored enabled", () => {
        mount(
            [rule("a"), rule("slow")],
            {},
            { switchedOff: [{ id: "slow", reason: "Switched off: slow on this note (3 times over 2 ms)." }] },
        );
        const target = row(1);
        expect(target.classList.contains("is-paused")).toBe(true);
        expect(q(".snipsy-pattern-flair", target).textContent).toBe("Paused");
        expect(q(".snipsy-pattern-note", target).textContent).toBe("Turned off for this session: it was too slow.");
        expect(stored()[1]?.enabled).toBe(true);
        expect(q<HTMLInputElement>("input", q(".snipsy-pattern-toggle", target)).disabled).toBe(false);
    });

    it("Paused words a compile-time switch-off differently", () => {
        mount([rule("slow")], {}, { switchedOff: [{ id: "slow", reason: "Switched off: too expensive to compile (80 ms)." }] });
        expect(q(".snipsy-pattern-note", row(0)).textContent).toBe("Turned off for this session: it took too long to compile.");
    });

    it("an Error wins over Paused, and a rule the user turned off is never Paused", () => {
        mount(
            [rule("bad", { source: "/a$/g" }), rule("off", { enabled: false })],
            {},
            { switchedOff: [{ id: "bad", reason: "x" }, { id: "off", reason: "x" }] },
        );
        expect(row(0).classList.contains("is-error")).toBe(true);
        expect(row(1).classList.contains("is-paused")).toBe(false);
    });

    it("an instant rule while Expand while typing is off shows the warning line; a separator rule does not", () => {
        mount([rule("a"), rule("b", { mode: "separator" })], { expansion: { onType: false } });
        expect(q(".snipsy-pattern-note", row(0)).textContent).toBe(INSTANT_NEEDS_TYPING);
        expect(INSTANT_NEEDS_TYPING).toBe("Instant rules need Expand while typing, which is off. Choose After a separator to use it with Tab.");
        expect(row(1).querySelector(".snipsy-pattern-note")).toBeNull();
        expect(row(0).classList.contains("is-on")).toBe(true);
    });

    it("no typing warning while Expand while typing is on", () => {
        mount([rule("a")]);
        expect(root.querySelector(".snipsy-pattern-note")).toBeNull();
    });

    it("the editor shows the warning next to Fires while Instant is chosen and Expand while typing is off", async () => {
        mount([], { expansion: { onType: false } });
        button("Add rule").click();
        const note = q('[id$="-typing"]', editor());
        expect(note.textContent).toBe(INSTANT_NEEDS_TYPING);
        modeSelect().value = "separator";
        modeSelect().dispatchEvent(new Event("change", { bubbles: true }));
        await settle();
        expect(note.textContent).toBe("");
    });
});

describe("PatternsTab: order", () => {
    it("Alt+ArrowDown and Alt+ArrowUp on a focused row move it, save, keep focus and announce the position", async () => {
        mount([rule("a"), rule("b"), rule("c")]);
        key(q(".snipsy-pattern-main", row(0)), "ArrowDown", { altKey: true });
        await settle();
        expect(storedIds()).toEqual(["b", "a", "c"]);
        expect(rowIds()).toEqual(["b", "a", "c"]);
        expect(document.activeElement).toBe(q(".snipsy-pattern-main", row(1)));
        expect(q('[aria-live="polite"]', root).textContent).toBe("Moved to position 2 of 3");
        key(q(".snipsy-pattern-main", row(1)), "ArrowUp", { altKey: true });
        await settle();
        expect(storedIds()).toEqual(["a", "b", "c"]);
        expect(q('[aria-live="polite"]', root).textContent).toBe("Moved to position 1 of 3");
    });

    it("does nothing at the edges", async () => {
        mount([rule("a"), rule("b")]);
        key(q(".snipsy-pattern-main", row(0)), "ArrowUp", { altKey: true });
        key(q(".snipsy-pattern-main", row(1)), "ArrowDown", { altKey: true });
        await settle();
        expect(mock._saveCalls).toHaveLength(0);
        expect(storedIds()).toEqual(["a", "b"]);
    });

    it("plain arrow keys do not move anything", async () => {
        mount([rule("a"), rule("b")]);
        key(q(".snipsy-pattern-main", row(0)), "ArrowDown");
        await settle();
        expect(storedIds()).toEqual(["a", "b"]);
    });

    it("the menu moves a rule, and disables the impossible direction", async () => {
        mount([rule("a"), rule("b")]);
        q(".snipsy-pattern-menu", row(0)).click();
        expect(Menu.last?.items.find((i) => i.title === "Move up")?.disabled).toBe(true);
        expect(Menu.last?.items.find((i) => i.title === "Move down")?.disabled).toBe(false);
        menuItem("Move down")();
        await settle();
        expect(storedIds()).toEqual(["b", "a"]);
    });

    it("dragging the handle onto another row moves the rule there", async () => {
        mount([rule("a"), rule("b"), rule("c")]);
        const handle = q(".snipsy-pattern-handle", row(0));
        const dragstart = new Event("dragstart", { bubbles: true });
        Object.assign(dragstart, { dataTransfer: { setData: vi.fn(), effectAllowed: "" } });
        handle.dispatchEvent(dragstart);
        const over = new Event("dragover", { bubbles: true, cancelable: true });
        row(2).dispatchEvent(over);
        expect(over.defaultPrevented).toBe(true);
        expect(row(2).classList.contains("is-drop-target")).toBe(true);
        row(2).dispatchEvent(new Event("drop", { bubbles: true, cancelable: true }));
        await settle();
        expect(storedIds()).toEqual(["b", "c", "a"]);
    });

    it("a drop with nothing being dragged changes nothing", async () => {
        mount([rule("a"), rule("b")]);
        const over = new Event("dragover", { bubbles: true, cancelable: true });
        row(1).dispatchEvent(over);
        expect(over.defaultPrevented).toBe(false);
        row(1).dispatchEvent(new Event("drop", { bubbles: true, cancelable: true }));
        await settle();
        expect(storedIds()).toEqual(["a", "b"]);
    });

    it("has no drag handle on mobile (reorder through the menu)", () => {
        Platform.isMobile = true;
        mount([rule("a")]);
        expect(root.querySelector(".snipsy-pattern-handle")).toBeNull();
        expect(root.querySelector(".snipsy-pattern-menu")).not.toBeNull();
    });
});

describe("PatternsTab: delete", () => {
    it("the menu asks first, and Delete removes the rule, saves, and focuses the next row", async () => {
        mount([rule("a"), rule("b"), rule("c")]);
        q(".snipsy-pattern-menu", row(1)).click();
        menuItem("Delete rule")();
        expect(stored()).toHaveLength(3);
        expect(document.body.querySelector(".snipsidian-confirm-modal")?.textContent).toContain("Delete rule 2, /b$/?");
        button("Delete", document.body).click();
        await settle();
        expect(storedIds()).toEqual(["a", "c"]);
        expect(mock._saveCalls).toHaveLength(1);
        expect(document.activeElement).toBe(q(".snipsy-pattern-main", row(1)));
        expect(row(1).dataset.id).toBe("c");
    });

    it("cancelling the confirm keeps the rule", async () => {
        mount([rule("a")]);
        key(q(".snipsy-pattern-main", row(0)), "Delete");
        button("Cancel", document.body).click();
        await settle();
        expect(storedIds()).toEqual(["a"]);
    });

    it("the Delete key on a focused row asks first", () => {
        mount([rule("a")]);
        key(q(".snipsy-pattern-main", row(0)), "Delete");
        expect(document.body.querySelector(".snipsidian-confirm-modal")).not.toBeNull();
        expect(stored()).toHaveLength(1);
    });

    it("the Delete button in the editor footer asks first and closes the editor", async () => {
        mount([rule("a"), rule("b")]);
        q(".snipsy-pattern-main", row(0)).click();
        button("Delete", editor()).click();
        button("Delete", document.body.querySelector<HTMLElement>(".snipsidian-confirm-modal") as HTMLElement).click();
        await settle();
        expect(storedIds()).toEqual(["b"]);
        expect(root.querySelector(".snipsy-pattern-editor")).toBeNull();
    });

    it("deleting the last rule shows the empty state", async () => {
        mount([rule("a")]);
        key(q(".snipsy-pattern-main", row(0)), "Delete");
        button("Delete", document.body).click();
        await settle();
        expect(root.querySelector(".snipsy-patterns-empty")).not.toBeNull();
    });

    it("a new rule has no Delete button", () => {
        mount([rule("a")]);
        button("Add rule").click();
        expect(Array.from(editor().querySelectorAll("button")).map((b) => b.textContent)).toEqual(["Cancel", "Save"]);
    });
});

describe("PatternsTab: the 100 rule cap and the starter set", () => {
    const filler = (n: number): PatternRule[] => Array.from({ length: n }, (_, i) => rule(`f${i}`, { source: `/f${i}x$/` }));

    it("at 100 rules Add rule is disabled and the page says why", () => {
        mount(filler(100));
        expect(button("Add rule").disabled).toBe(true);
        expect(q(".snipsy-patterns-cap").textContent).toBe("100 rules is the most. Delete one to add another.");
    });

    it("at 99 rules one more can be added, and the 101st cannot", async () => {
        mount(filler(99));
        expect(button("Add rule").disabled).toBe(false);
        button("Add rule").click();
        type(patternInput(), "/zz$/");
        await settle();
        await click(saveButton());
        expect(stored()).toHaveLength(100);
        expect(button("Add rule").disabled).toBe(true);
    });

    it("Add rule opened before the cap was reached still cannot write past it", async () => {
        mount(filler(99));
        button("Add rule").click();
        type(patternInput(), "/zz$/");
        await settle();
        // Another path (sync, a second window) filled the last slot in the meantime.
        mock.settings.patterns = [...stored(), rule("late", { source: "/late$/" })];
        await click(saveButton());
        expect(stored()).toHaveLength(100);
        expect(mock._saveCalls).toHaveLength(0);
    });

    it("the starter row offers only the missing rules", async () => {
        const have = STARTER_RULES.slice(0, 2).map((s, i) => ({ ...s, id: `s${i}`, enabled: true }));
        mount(have);
        const starter = q(".snipsy-patterns-starter");
        expect(starter.querySelector(".setting-item-description")?.textContent).toBe(
            "32 rules in the Typography group. Adds only the ones you don't have.",
        );
        expect(button("Add 30 missing", starter)).toBeTruthy();
        await click(button("Add 30 missing", starter));
        expect(stored()).toHaveLength(32);
        expect(storedIds().slice(0, 2)).toEqual(["s0", "s1"]);
        expect(new Set(stored().map((r) => r.source)).size).toBe(32);
    });

    it("an edited replacement still counts as having the starter rule", () => {
        const first = STARTER_RULES[0];
        mount([{ ...first!, id: "mine", replacement: "mine", enabled: true }]);
        expect(button("Add 31 missing")).toBeTruthy();
    });

    it("when the set does not fit, the button is disabled and the row says how many slots are free", () => {
        mount(filler(88));
        const starter = q(".snipsy-patterns-starter");
        expect(starter.querySelector(".setting-item-description")?.textContent).toBe("Needs 32 free slots. You have 12.");
        expect(button("Add 32 missing", starter).disabled).toBe(true);
    });

    it("fits exactly into the last free slots", async () => {
        mount(filler(68));
        await click(button("Add 32 missing"));
        expect(stored()).toHaveLength(100);
    });
});

describe("PatternsTab: Try it", () => {
    const oneHalf: PatternRule = rule("half", { source: "/1\\/2$/", replacement: "½" });

    it("explains early firing for an instant rule, with the result marked", async () => {
        mount([oneHalf]);
        q(".snipsy-pattern-main", row(0)).click();
        await settle();
        type(tryInput(), "1/23");
        await settle();
        const result = q(".snipsy-tryit-result", editor());
        expect(result.textContent).toBe("½3");
        expect(q(".snipsy-tryit-replaced", result).textContent).toBe("½");
        expect(result.querySelector(".snipsy-tryit-caret")).not.toBeNull();
        expect(result.getAttribute("aria-label")).toBe("Result: ½3, caret at end");
        expect(q(".snipsy-tryit-status", editor()).textContent).toBe("Fired at 1/2, before 3. To type 1/23, choose After a separator.");
        expect(q(".snipsy-tryit-status", editor()).getAttribute("aria-live")).toBe("polite");
    });

    it("switching the draft to After a separator changes the answer", async () => {
        mount([oneHalf]);
        q(".snipsy-pattern-main", row(0)).click();
        type(tryInput(), "1/23");
        modeSelect().value = "separator";
        modeSelect().dispatchEvent(new Event("change", { bubbles: true }));
        await settle();
        expect(q(".snipsy-tryit-result", editor()).textContent).toBe("1/23");
        expect(q(".snipsy-tryit-status", editor()).textContent).toBe("No match.");
        type(tryInput(), "1/2");
        await settle();
        expect(q(".snipsy-tryit-result", editor()).textContent).toBe("½ ");
        expect(q(".snipsy-tryit-status", editor()).textContent).toBe("Fires when you type a separator next.");
    });

    it("tests the whole list: the draft takes its place, an earlier rule shadows it", async () => {
        mount([rule("first", { source: "/ab$/", replacement: "X" }), rule("second", { source: "/b$/", replacement: "Y" })]);
        q(".snipsy-pattern-main", row(1)).click();
        type(tryInput(), "ab");
        await settle();
        expect(q(".snipsy-tryit-result", editor()).textContent).toBe("X");
        expect(q(".snipsy-tryit-status", editor()).textContent).toBe("Rule 1 fires first.");
    });

    it("a new rule is tried at the end of the list", async () => {
        mount([rule("first", { source: "/ab$/", replacement: "X" })]);
        button("Add rule").click();
        type(patternInput(), "/b$/");
        type(replacementInput(), "Y");
        type(tryInput(), "ab");
        await settle();
        expect(q(".snipsy-tryit-status", editor()).textContent).toBe("Rule 1 fires first.");
    });

    it("literal snippets come first on a separator", async () => {
        mount([rule("a", { source: "/todo$/", replacement: "RULE", mode: "separator" })], { snippets: { todo: "- [ ] " } });
        q(".snipsy-pattern-main", row(0)).click();
        type(tryInput(), "todo ");
        await settle();
        expect(q(".snipsy-tryit-status", editor()).textContent).toBe("Snippet todo fires first.");
    });

    it("keeps working on the last valid pattern while the draft has an error", async () => {
        mount([oneHalf]);
        q(".snipsy-pattern-main", row(0)).click();
        await settle();
        type(patternInput(), "/1\\/2$/g");
        type(tryInput(), "1/2");
        await settle();
        expect(q('[id$="-pattern-err"]', editor()).textContent).not.toBe("");
        expect(q(".snipsy-tryit-result", editor()).textContent).toBe("½");
        expect(q(".snipsy-tryit-status", editor()).textContent).toBe("Fires after 1/2.");
    });

    it("with no valid pattern yet it asks to fix the errors instead of guessing", async () => {
        mount([]);
        button("Add rule").click();
        type(patternInput(), "/a$/g");
        type(tryInput(), "a");
        await settle();
        expect(q(".snipsy-tryit-status", editor()).textContent).toBe("Fix the errors above to try this rule.");
        expect(q(".snipsy-tryit-result", editor()).classList.contains("is-hidden")).toBe(true);
    });

    it("an empty line shows nothing", async () => {
        mount([oneHalf]);
        q(".snipsy-pattern-main", row(0)).click();
        type(tryInput(), "1/2");
        await settle();
        type(tryInput(), "");
        await settle();
        expect(q(".snipsy-tryit-status", editor()).textContent).toBe("");
        expect(q(".snipsy-tryit-result", editor()).classList.contains("is-hidden")).toBe(true);
    });

    it("never reads the clipboard: $clipboard shows as its name", async () => {
        const readText = vi.fn(() => Promise.resolve("SECRET"));
        Object.defineProperty(navigator, "clipboard", { value: { readText }, configurable: true });
        mount([rule("c", { source: "/;c$/", replacement: "[$clipboard|$filename]" })]);
        q(".snipsy-pattern-main", row(0)).click();
        type(tryInput(), ";c");
        await settle();
        expect(q(".snipsy-tryit-result", editor()).textContent).toBe("[$clipboard|$filename]");
        expect(readText).not.toHaveBeenCalled();
    });

    it("shows tab stops as numbered marks", async () => {
        mount([rule("m", { source: "/;m$/", replacement: "a $1 b $2" })]);
        q(".snipsy-pattern-main", row(0)).click();
        type(tryInput(), ";m");
        await settle();
        const marks = Array.from(editor().querySelectorAll(".snipsy-tryit-field")).map((m) => m.textContent);
        expect(marks).toEqual(["①", "②"]);
    });

    it("instant rules do not fire in Try it while Expand while typing is off", async () => {
        mount([oneHalf], { expansion: { onType: false } });
        q(".snipsy-pattern-main", row(0)).click();
        type(tryInput(), "1/2");
        await settle();
        expect(q(".snipsy-tryit-result", editor()).textContent).toBe("1/2");
        expect(q(".snipsy-tryit-status", editor()).textContent).toBe("No match.");
    });

    it("applies the prefix setting to literal snippets only", async () => {
        mount([rule("a", { source: "/todo$/", replacement: "RULE", mode: "separator" })], {
            snippets: { todo: "S" },
            expansion: { requirePrefix: true, prefixChar: ":" },
        });
        q(".snipsy-pattern-main", row(0)).click();
        type(tryInput(), "todo ");
        await settle();
        expect(q(".snipsy-tryit-result", editor()).textContent).toBe("RULE ");
    });

    it("a muted group does not hide the draft from its own Try it", async () => {
        mount([rule("g", { source: "/1\\/2$/", replacement: "½", group: "typography" })], { disabledGroups: ["typography"] });
        q(".snipsy-pattern-main", row(0)).click();
        type(tryInput(), "1/2");
        await settle();
        expect(q(".snipsy-tryit-result", editor()).textContent).toBe("½");
    });
});

/** A `saveSettings` the test settles by hand; `disk` is the settings as of the last save that resolved. */
function deferSaves(): { calls: () => number; resolve: (n: number) => void; reject: (n: number) => void; disk: () => unknown } {
    const pending: Array<{ snapshot: unknown; res: () => void; rej: (e: Error) => void }> = [];
    let disk: unknown = structuredClone(mock.settings.patterns);
    mock.saveSettings = () =>
        new Promise<void>((res, rej) => {
            pending.push({ snapshot: structuredClone(mock.settings.patterns), res, rej });
        });
    return {
        calls: () => pending.length,
        resolve: (n) => {
            disk = pending[n]?.snapshot;
            pending[n]?.res();
        },
        reject: (n) => pending[n]?.rej(new Error("disk full")),
        disk: () => disk,
    };
}
const modEnter = (): void => key(patternInput(), "Enter", { metaKey: true });

describe("PatternsTab: the placeholder hint", () => {
    it("drops the $1 selection meaning: the capture hint says $1 is a Tab stop", () => {
        mount([rule("a")]);
        q(".snipsy-pattern-main", row(0)).click();
        const text = editor().textContent ?? "";
        expect(text).toContain(CAPTURE_HINT);
        expect(text).not.toContain("selection or cursor");
        expect(text).toContain("Placeholders: $| cursor · $date");
        expect(q(".snipsidian-placeholder-hint a", editor()).getAttribute("href")).toBe("https://github.com/Dimagious/snipsidian#placeholders");
    });
});

describe("PatternsTab: writes are serialised", () => {
    beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => undefined));

    it("two Mod+Enter while a save is pending write the new rule once", async () => {
        mount([rule("a")]);
        const saves = deferSaves();
        button("Add rule").click();
        type(patternInput(), "/z$/");
        await settle();
        modEnter();
        modEnter();
        await settle();
        expect(saveButton().disabled).toBe(true);
        saves.resolve(0);
        await settle();
        expect(storedIds().filter((id) => id !== "a")).toHaveLength(1);
        expect(stored()).toHaveLength(2);
        expect(saves.calls()).toBe(1);
    });

    it("two Mod+Enter on a save that fails leave memory equal to disk, and Save is usable again", async () => {
        mount([rule("a")]);
        const saves = deferSaves();
        button("Add rule").click();
        type(patternInput(), "/z$/");
        await settle();
        modEnter();
        modEnter();
        await settle();
        saves.reject(0);
        await settle();
        expect(stored()).toEqual(saves.disk());
        expect(stored()).toHaveLength(1);
        expect(saves.calls()).toBe(1);
        expect(saveButton().disabled).toBe(false);
    });

    it("toggle then toggle with the first save failing: memory equals disk", async () => {
        mount([rule("a", { enabled: false }), rule("b", { enabled: true })]);
        const saves = deferSaves();
        const flip = (i: number, value: boolean): void => {
            const input = q<HTMLInputElement>("input", q(".snipsy-pattern-toggle", row(i)));
            input.checked = value;
            input.dispatchEvent(new Event("change", { bubbles: true }));
        };
        flip(0, true);
        flip(1, false);
        await settle();
        saves.reject(0);
        await settle();
        saves.resolve(1);
        await settle();
        expect(stored()).toEqual(saves.disk());
        expect(stored().map((r) => r.enabled)).toEqual([false, false]);
    });

    it("a failed group switch is put back and logged with the group", async () => {
        mount([rule("a", { group: "typography" })]);
        mock.saveSettings = () => Promise.reject(new Error("disk full"));
        q(".snipsy-pattern-menu", row(0)).click();
        menuItem("Turn off group Typography")();
        await settle();
        expect(mock.settings.disabledGroups ?? []).toEqual([]);
        expect(console.error).toHaveBeenCalledWith(expect.stringContaining('"typography"'), expect.any(Error));
    });

    it("group switches queue behind a pending save and each rolls back on its own", async () => {
        mount([rule("a", { group: "typography" })]);
        const saves = deferSaves();
        q(".snipsy-pattern-menu", row(0)).click();
        menuItem("Turn off group Typography")();
        await settle();
        expect(mock.settings.disabledGroups).toEqual(["typography"]);
        saves.reject(0);
        await settle();
        expect(mock.settings.disabledGroups ?? []).toEqual([]);
    });
});

describe("PatternsTab: failure paths", () => {
    beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => undefined));

    it("a failed group switch leaves a newer value of the muted groups alone", async () => {
        mount([rule("a", { group: "typography" })]);
        const saves = deferSaves();
        q(".snipsy-pattern-menu", row(0)).click();
        menuItem("Turn off group Typography")();
        await settle();
        mock.settings.disabledGroups = ["other"];
        saves.reject(0);
        await settle();
        expect(mock.settings.disabledGroups).toEqual(["other"]);
    });

    it("a toggle whose save fails is put back on screen", async () => {
        mount([rule("a", { enabled: false })]);
        mock.saveSettings = () => Promise.reject(new Error("disk full"));
        const input = q<HTMLInputElement>("input", q(".snipsy-pattern-toggle", row(0)));
        input.checked = true;
        input.dispatchEvent(new Event("change", { bubbles: true }));
        await settle();
        expect(stored()[0]?.enabled).toBe(false);
        expect(q<HTMLInputElement>("input", q(".snipsy-pattern-toggle", row(0))).checked).toBe(false);
    });

    it("Save refuses to write when the stored value turned unreadable while the editor was open", async () => {
        mount([rule("a")]);
        button("Add rule").click();
        type(patternInput(), "/z$/");
        await settle();
        const odd = { not: "a list" } as unknown as PatternRule[];
        mock.settings.patterns = odd;
        await click(saveButton());
        expect(mock.settings.patterns).toBe(odd);
        expect(mock._saveCalls).toHaveLength(0);
    });

    it("a double click on Start a new list writes once and logs what it replaced", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        mount({ broken: true } as unknown as PatternRule[]);
        const start = button("Start a new list");
        start.click();
        start.click();
        await settle();
        expect(mock._saveCalls).toHaveLength(1);
        expect(mock.settings.patterns).toEqual([]);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("unreadable"), '{"broken":true}');
    });
});

describe("PatternsTab: entries a hand edit or sync can produce", () => {
    it("editing the second of two rules with the same id leaves the first intact", async () => {
        mount([rule("a", { source: "/x$/", replacement: "X" }), rule("a", { source: "/y$/", replacement: "Y" })]);
        q(".snipsy-pattern-main", row(1)).click();
        expect(root.querySelectorAll(".snipsy-pattern-editor")).toHaveLength(1);
        expect(patternInput().value).toBe("/y$/");
        type(patternInput(), "/z$/");
        await settle();
        await click(saveButton());
        expect(stored().map((r) => r.source)).toEqual(["/x$/", "/z$/"]);
        expect(stored().map((r) => r.replacement)).toEqual(["X", "Y"]);
    });

    it("toggling and deleting one of two rules with the same id touches only that one", async () => {
        mount([rule("a", { enabled: true }), rule("a", { enabled: true })]);
        const input = q<HTMLInputElement>("input", q(".snipsy-pattern-toggle", row(1)));
        input.checked = false;
        input.dispatchEvent(new Event("change", { bubbles: true }));
        await settle();
        expect(stored().map((r) => r.enabled)).toEqual([true, false]);
        q(".snipsy-pattern-menu", row(0)).click();
        menuItem("Delete rule")();
        button("Delete", document.body).click();
        await settle();
        expect(stored().map((r) => r.enabled)).toEqual([false]);
    });

    it("moving a rule up works with an empty entry before it (no id read off null)", async () => {
        mount([null as unknown as PatternRule, rule("a"), rule("b")]);
        key(q(".snipsy-pattern-main", row(2)), "ArrowUp", { altKey: true });
        await settle();
        expect(stored().map((r) => (r as PatternRule | null)?.id ?? null)).toEqual([null, "b", "a"]);
        expect(rowIds()).toEqual(["", "b", "a"]);
        expect(q('[aria-live="polite"]', root).textContent).toBe("Moved to position 2 of 3");
        expect(document.activeElement).toBe(q(".snipsy-pattern-main", row(1)));
    });

    it("an entry with no id gets one when it is saved, and the edit really lands", async () => {
        const noId = { source: "/x$/", replacement: "X", enabled: true, mode: "instant" } as unknown as PatternRule;
        mount([noId, rule("b")]);
        expect(row(0).classList.contains("is-error")).toBe(true);
        q(".snipsy-pattern-main", row(0)).click();
        type(replacementInput(), "Y");
        await settle();
        await click(saveButton());
        expect(stored()[0]).toMatchObject({ source: "/x$/", replacement: "Y", enabled: true });
        expect(stored()[0]?.id).toMatch(/^p/);
        expect(stored()[1]).toEqual(rule("b"));
        expect(row(0).classList.contains("is-error")).toBe(false);
        expect(q('[aria-live="polite"]', root).textContent).toBe("Rule saved.");
    });

    describe("rows are tracked by id while the editor is open", () => {
        const idless = (name: string): PatternRule =>
            ({ source: `/${name}$/`, replacement: name.toUpperCase(), enabled: true, mode: "instant" }) as unknown as PatternRule;
        const confirmModal = (): HTMLElement => {
            const modal = document.body.querySelector<HTMLElement>(".snipsidian-confirm-modal");
            if (!modal) throw new Error("No confirm modal");
            return modal;
        };
        async function deleteRowViaMenu(i: number): Promise<void> {
            q(".snipsy-pattern-menu", row(i)).click();
            menuItem("Delete rule")();
            button("Delete", confirmModal()).click();
            await settle();
        }
        async function editAndSave(i: number, replacement: string): Promise<void> {
            q(".snipsy-pattern-main", row(i)).click();
            type(replacementInput(), replacement);
            await settle();
        }

        it("opening the page gives id-less and repeated ids distinct ids in memory and writes nothing", () => {
            const original = [idless("one"), rule("a"), rule("a", { source: "/t$/" }), idless("two")];
            mount(original);
            const ids = rowIds();
            expect(ids.every((id) => id !== "")).toBe(true);
            expect(new Set(ids).size).toBe(4);
            expect(ids[1]).toBe("a");
            expect(mock.settings.patterns).toBe(original);
            expect(original[0]).not.toHaveProperty("id");
            expect(original[2]?.id).toBe("a");
            expect(mock._saveCalls).toHaveLength(0);
            // The ids do not change between draws.
            const again = rowIds();
            expect(again).toEqual(ids);
        });

        it("the next write persists the ids, every entry distinct", async () => {
            mount([idless("one"), rule("a"), rule("a", { source: "/t$/" })]);
            const ids = rowIds();
            const input = q<HTMLInputElement>("input", q(".snipsy-pattern-toggle", row(1)));
            input.checked = false;
            input.dispatchEvent(new Event("change", { bubbles: true }));
            await settle();
            expect(storedIds()).toEqual(ids);
            expect(new Set(storedIds()).size).toBe(3);
            expect(stored().map((r) => r.enabled)).toEqual([true, false, true]);
        });

        it("deleting a row above the edited id-less rule keeps the edit on that rule", async () => {
            mount([idless("one"), idless("two"), idless("three")]);
            await editAndSave(1, "EDITED-TWO");
            await deleteRowViaMenu(0);
            expect(root.querySelectorAll(".snipsy-pattern-editor")).toHaveLength(1);
            await click(saveButton());
            expect(stored().map((r) => r.source)).toEqual(["/two$/", "/three$/"]);
            expect(stored().map((r) => r.replacement)).toEqual(["EDITED-TWO", "THREE"]);
        });

        it("moving the edited id-less rule keeps the edit on it and loses nothing", async () => {
            mount([idless("one"), idless("two"), idless("three")]);
            await editAndSave(0, "EDITED-ONE");
            key(q(".snipsy-pattern-main", row(0)), "ArrowDown", { altKey: true });
            await settle();
            await click(saveButton());
            expect(stored().map((r) => r.source)).toEqual(["/two$/", "/one$/", "/three$/"]);
            expect(stored().map((r) => r.replacement)).toEqual(["TWO", "EDITED-ONE", "THREE"]);
        });

        it("deleting a row above the edited second twin leaves the first twin alone", async () => {
            mount([rule("x"), rule("a", { source: "/a1$/", replacement: "A1" }), rule("a", { source: "/a2$/", replacement: "A2" })]);
            await editAndSave(2, "EDITED-A2");
            await deleteRowViaMenu(0);
            await click(saveButton());
            expect(stored().map((r) => r.source)).toEqual(["/a1$/", "/a2$/"]);
            expect(stored().map((r) => r.replacement)).toEqual(["A1", "EDITED-A2"]);
        });

        it("moving the edited second twin above the first leaves the first twin alone", async () => {
            mount([rule("x"), rule("a", { source: "/a1$/", replacement: "A1" }), rule("a", { source: "/a2$/", replacement: "A2" })]);
            await editAndSave(2, "EDITED-A2");
            key(q(".snipsy-pattern-main", row(2)), "ArrowUp", { altKey: true });
            await settle();
            await click(saveButton());
            expect(stored().map((r) => r.source)).toEqual(["/x$/", "/a2$/", "/a1$/"]);
            expect(stored().map((r) => r.replacement)).toEqual(["X", "EDITED-A2", "A1"]);
        });

        it("deleting the first twin keeps the second twin's editor open with its draft", async () => {
            mount([rule("a", { source: "/a1$/" }), rule("a", { source: "/a2$/" })]);
            q(".snipsy-pattern-main", row(1)).click();
            type(patternInput(), "/draft$/");
            await settle();
            await deleteRowViaMenu(0);
            expect(rows()).toHaveLength(1);
            expect(root.querySelectorAll(".snipsy-pattern-editor")).toHaveLength(1);
            expect(patternInput().value).toBe("/draft$/");
            await click(saveButton());
            expect(stored().map((r) => r.source)).toEqual(["/draft$/"]);
        });

        it("an editor whose rule is deleted from the list closes", async () => {
            mount([rule("a"), rule("b")]);
            q(".snipsy-pattern-main", row(0)).click();
            q(".snipsy-pattern-menu", row(0)).click();
            menuItem("Delete rule")();
            button("Delete", confirmModal()).click();
            await settle();
            expect(root.querySelector(".snipsy-pattern-editor")).toBeNull();
            expect(rowIds()).toEqual(["b"]);
        });

        it("an entry that is not an object can only be deleted, and the rule after it still saves", async () => {
            const odd: unknown[] = [null, rule("a")];
            mount(odd as PatternRule[]);
            expect(row(0).classList.contains("is-error")).toBe(true);
            expect(row(0).querySelector(".snipsy-pattern-toggle")).toBeNull();
            expect(row(0).querySelector(".snipsy-pattern-handle")).toBeNull();
            q(".snipsy-pattern-main", row(0)).click();
            expect(root.querySelector(".snipsy-pattern-editor")).toBeNull();
            q(".snipsy-pattern-menu", row(0)).click();
            expect(Menu.last?.items.map((i) => i.title)).toEqual(["Delete rule"]);
            key(q(".snipsy-pattern-main", row(0)), "ArrowDown", { altKey: true });
            await settle();
            expect(mock._saveCalls).toHaveLength(0);
            await editAndSave(1, "EDITED");
            await click(saveButton());
            expect(stored()[0]).toBeNull();
            expect(stored()[1]).toMatchObject({ id: "a", replacement: "EDITED" });
        });

        it("deleting a non-object entry removes that slot and nothing else", async () => {
            mount([rule("a"), "junk" as unknown as PatternRule, rule("b")]);
            await deleteRowViaMenu(1);
            expect(storedIds()).toEqual(["a", "b"]);
        });

        it("deleting a non-object entry is refused when another entry took its slot meanwhile", async () => {
            mount([rule("a"), "junk" as unknown as PatternRule, rule("b")]);
            q(".snipsy-pattern-menu", row(1)).click();
            menuItem("Delete rule")();
            mock.settings.patterns = [rule("a"), rule("b")];
            button("Delete", confirmModal()).click();
            await settle();
            expect(storedIds()).toEqual(["a", "b"]);
            expect(mock._saveCalls).toHaveLength(0);
        });

        it("a change that throws is logged and does not reject into the caller", async () => {
            vi.spyOn(console, "error").mockImplementation(() => undefined);
            let boom = false;
            const fragile = {
                id: "a",
                source: "/a$/",
                replacement: "A",
                mode: "instant",
                get enabled(): boolean {
                    if (boom) throw new Error("boom");
                    return true;
                },
            } as unknown as PatternRule;
            mount([fragile]);
            q(".snipsy-pattern-main", row(0)).click();
            type(replacementInput(), "B");
            await settle();
            boom = true;
            await click(saveButton());
            expect(console.error).toHaveBeenCalledWith(expect.stringContaining("pattern rules"), expect.any(Error));
            expect(mock._saveCalls).toHaveLength(0);
        });
    });

    it("an instant rule with two open-ended repeats shows the page's instant sentence, a separator rule does not", () => {
        mount([
            rule("i", { source: "/\\w+\\d+x$/", mode: "instant" }),
            rule("s", { source: "/\\w+\\d+x$/", mode: "separator" }),
        ]);
        expect(q(".snipsy-pattern-note", row(0)).textContent).toBe(
            "An instant rule can have at most 1 open-ended repeat (*, + or {n,}); this one has 2. Choose After a separator to use up to 2.",
        );
        expect(row(1).querySelector(".snipsy-pattern-note")).toBeNull();
    });

    for (const odd of [{}, "x", 5]) {
        it(`a saved value of ${JSON.stringify(odd)} shows as empty with a notice, and nothing is written until a new list is started`, async () => {
            mount(odd as unknown as PatternRule[]);
            expect(rows()).toHaveLength(0);
            expect(root.textContent).toContain(PATTERNS_UNREADABLE);
            expect(tab.errorCount()).toBe(0);
            expect(root.querySelector(".snipsy-patterns-empty")).toBeNull();
            expect(Array.from(root.querySelectorAll("button")).map((b) => b.textContent)).toEqual(["Start a new list"]);
            expect(mock.settings.patterns).toBe(odd);
            expect(mock._saveCalls).toHaveLength(0);
            await click(button("Start a new list"));
            expect(mock.settings.patterns).toEqual([]);
            expect(mock._saveCalls).toHaveLength(1);
            expect(root.textContent).not.toContain(PATTERNS_UNREADABLE);
            expect(root.querySelector(".snipsy-patterns-empty")).not.toBeNull();
        });
    }
});

describe("PatternsTab: groups keep their stored slug", () => {
    for (const slug of ["my_group", "Notes"]) {
        it(`picking the suggested title for "${slug}" stores "${slug}", not a new slug`, async () => {
            mount([rule("a", { group: slug })]);
            button("Add rule").click();
            type(patternInput(), "/z$/");
            const title = Array.from(editor().querySelectorAll("datalist option"))[0]?.getAttribute("value") ?? "";
            type(groupInput(), title);
            await settle();
            await click(saveButton());
            expect(stored()[1]?.group).toBe(slug);
        });
    }
});

describe("PatternsTab: Try it line cap", () => {
    it("tries only the first 500 characters and says so", async () => {
        mount([rule("half", { source: "/1\\/2$/", replacement: "½" })]);
        q(".snipsy-pattern-main", row(0)).click();
        type(tryInput(), `1/2${"x".repeat(600)}`);
        await settle();
        expect(q(".snipsy-tryit-status", editor()).textContent).toContain(TRY_IT_CUT);
        expect((q(".snipsy-tryit-result", editor()).textContent ?? "").length).toBeLessThan(500);
    });

    it("a line of exactly 500 characters is tried whole, with no note", async () => {
        mount([rule("half", { source: "/1\\/2$/", replacement: "½" })]);
        q(".snipsy-pattern-main", row(0)).click();
        type(tryInput(), `1/2${"x".repeat(497)}`);
        await settle();
        expect(q(".snipsy-tryit-status", editor()).textContent).not.toContain(TRY_IT_CUT);
    });
});
