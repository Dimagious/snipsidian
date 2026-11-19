import { afterEach, describe, it, expect, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { App, Editor, EditorPosition } from "obsidian";
import { buildExpansionExtension } from "./cm6-bridge";
import { hasFieldSession } from "../adapters/field-session";
import { compilePatternRules, NO_PATTERNS, type CompiledPatterns } from "../engine/patterns";
import type { PatternRule } from "../engine/types";

/**
 * B-255, the Tab key end to end: a REAL `EditorView` with the real expansion
 * extension, the real field-session keymap and the REAL expansion path
 * (`canExpandAtCursor` -> `expandTriggerAtCursor` -> `tryExpandAtCursor` ->
 * engine). Only the Obsidian `Editor` is a thin adapter over the view, because
 * Obsidian itself is not available here. The unit tests of `handleTab` mock the
 * expansion; this one fails if the pieces stop fitting together.
 */
const views: EditorView[] = [];

// jsdom has no layout: CM6's measure pass (a requestAnimationFrame later) asks
// Range for client rects. Empty answers keep it quiet; nothing here depends on layout.
const noRects: DOMRectList = Object.assign([] as DOMRect[], { item: () => null });
Range.prototype.getClientRects = () => noRects;
Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);

const DICT = { brb: "be right back", lnk: "[$1]($2)" };

/** The part of Obsidian's `Editor` the expansion path uses, over a CM6 view. */
function editorOver(view: EditorView): Editor {
    const doc = () => view.state.doc;
    const toOffset = (p: EditorPosition): number => doc().line(p.line + 1).from + p.ch;
    const toPos = (offset: number): EditorPosition => {
        const line = doc().lineAt(offset);
        return { line: line.number - 1, ch: offset - line.from };
    };
    const editor = {
        cm: view,
        getSelection: () => {
            const { from, to } = view.state.selection.main;
            return doc().sliceString(from, to);
        },
        getCursor: (which?: "from" | "to" | "head" | "anchor") => {
            const { from, to, head, anchor } = view.state.selection.main;
            return toPos({ from, to, head, anchor }[which ?? "head"]);
        },
        getLine: (i: number) => (i >= 0 && i < doc().lines ? doc().line(i + 1).text : ""),
        lastLine: () => doc().lines - 1,
        getRange: (from: EditorPosition, to: EditorPosition) => doc().sliceString(toOffset(from), toOffset(to)),
        posToOffset: toOffset,
        replaceRange: (text: string, from: EditorPosition, to?: EditorPosition) => {
            view.dispatch({ changes: { from: toOffset(from), to: toOffset(to ?? from), insert: text } });
        },
        setCursor: (pos: EditorPosition) => {
            view.dispatch({ selection: { anchor: toOffset(pos) } });
        },
    };
    return editor as unknown as Editor;
}

interface Opts {
    onTab?: boolean;
    prefix?: string;
    /** ADR-0008 pattern rules (compiled once per mount). */
    patterns?: Array<Partial<PatternRule> & { source: string; replacement: string }>;
    /** An already compiled set (to read its rule health afterwards), instead of `patterns`. */
    compiled?: () => CompiledPatterns;
    /** "Expand while typing" (default off here: only Tab is under test). */
    onType?: boolean;
}

function compile(rules: Opts["patterns"]): CompiledPatterns {
    if (!rules) return NO_PATTERNS;
    const set = compilePatternRules(rules.map((r, i) => ({ id: `r${i}`, enabled: true, mode: "separator", ...r })));
    expect(set.errors).toEqual([]);
    return set;
}

function mount(doc: string, anchor: number, head = anchor, opts: Opts = {}): EditorView {
    let editor: Editor | undefined;
    const app = {
        workspace: { get activeEditor() { return { editor, file: { name: "note.md" } }; } },
    } as unknown as App;
    const patterns = compile(opts.patterns);
    const compiled = opts.compiled ?? ((): CompiledPatterns => patterns);
    const view = new EditorView({
        state: EditorState.create({
            doc,
            selection: { anchor, head },
            extensions: [
                buildExpansionExtension(
                    app,
                    () => DICT,
                    () => opts.prefix,
                    () => false,
                    compiled,
                    () => opts.onType ?? false, // typing does not expand unless a test asks: only Tab is under test
                    () => opts.onTab ?? true,
                ),
            ],
        }),
        parent: document.body,
    });
    editor = editorOver(view);
    views.push(view);
    return view;
}

/** Sends a real Tab keydown; `true` when the editor consumed it. */
function pressTab(view: EditorView): boolean {
    const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    view.contentDOM.dispatchEvent(event);
    return event.defaultPrevented;
}

afterEach(() => {
    for (const view of views.splice(0)) view.destroy();
});

describe("Tab through a real EditorView (B-255)", () => {
    it("replaces a trigger right before the caret", async () => {
        const view = mount("say brb", 7);
        expect(pressTab(view)).toBe(true);
        await vi.waitFor(() => expect(view.state.doc.toString()).toBe("say be right back"));
    });

    it("is not consumed when no trigger sits there (indent and other plugins keep Tab)", async () => {
        const view = mount("say hello", 9);
        expect(pressTab(view)).toBe(false);
        await new Promise((r) => setTimeout(r, 0));
        expect(view.state.doc.toString()).toBe("say hello");
    });

    it("is not consumed when Expand on Tab is off", async () => {
        const view = mount("say brb", 7, 7, { onTab: false });
        expect(pressTab(view)).toBe(false);
        await new Promise((r) => setTimeout(r, 0));
        expect(view.state.doc.toString()).toBe("say brb");
    });

    it("is not consumed for a trigger inside inline code (guards still apply)", () => {
        const view = mount("`brb", 4);
        expect(pressTab(view)).toBe(false);
    });

    it("takes a selected trigger", async () => {
        const view = mount("say brb now", 4, 7);
        expect(pressTab(view)).toBe(true);
        await vi.waitFor(() => expect(view.state.doc.toString()).toBe("say be right back now"));
    });

    it("takes the whole word around a caret inside it", async () => {
        const view = mount("say brb now", 6);
        expect(pressTab(view)).toBe(true);
        await vi.waitFor(() => expect(view.state.doc.toString()).toBe("say be right back now"));
    });

    it("honours prefix mode", async () => {
        const bare = mount("brb", 3, 3, { prefix: ":" });
        expect(pressTab(bare)).toBe(false);
        const prefixed = mount(":brb", 4, 4, { prefix: ":" });
        expect(pressTab(prefixed)).toBe(true);
        await vi.waitFor(() => expect(prefixed.state.doc.toString()).toBe("be right back"));
    });

    it("prefix mode: takes a selected prefix char + trigger and a selected bare trigger, not a bare one without prefix", async () => {
        const withPrefix = mount("x :brb y", 2, 6, { prefix: ":" });
        expect(pressTab(withPrefix)).toBe(true);
        await vi.waitFor(() => expect(withPrefix.state.doc.toString()).toBe("x be right back y"));
        const bareSel = mount("x :brb y", 3, 6, { prefix: ":" });
        expect(pressTab(bareSel)).toBe(true);
        await vi.waitFor(() => expect(bareSel.state.doc.toString()).toBe("x be right back y"));
        const noPrefix = mount("x brb y", 2, 5, { prefix: ":" });
        expect(pressTab(noPrefix)).toBe(false);
    });

    it("a snippet with fields opens a session, and the next Tab jumps to the next field", async () => {
        const view = mount("lnk", 3);
        expect(pressTab(view)).toBe(true);
        await vi.waitFor(() => expect(hasFieldSession(view.state)).toBe(true));
        expect(view.state.doc.toString()).toBe("[]()");
        expect(view.state.selection.main.head).toBe(1);
        // Inside the session Tab belongs to the session, never to a new expansion.
        expect(pressTab(view)).toBe(true);
        expect(view.state.selection.main.head).toBe(3);
        expect(view.state.doc.toString()).toBe("[]()");
    });

    describe("with pattern rules (ADR-0008)", () => {
        const date = { source: String.raw`/\bdd(\d+)$/`, replacement: "day {{1}}" };

        it("a separator rule matching before the caret takes the Tab and expands", async () => {
            const view = mount("on dd5", 6, 6, { patterns: [date] });
            expect(pressTab(view)).toBe(true);
            await vi.waitFor(() => expect(view.state.doc.toString()).toBe("on day 5"));
            expect(view.state.selection.main.head).toBe(8);
        });

        it("a Tab with no literal trigger and no rule match is not consumed (indent keeps it)", async () => {
            const view = mount("on hello", 8, 8, { patterns: [date] });
            expect(pressTab(view)).toBe(false);
            await new Promise((r) => setTimeout(r, 0));
            expect(view.state.doc.toString()).toBe("on hello");
        });

        it("a literal trigger wins over a rule that also matches", async () => {
            const view = mount("say brb", 7, 7, { patterns: [{ source: "/brb$/", replacement: "PATTERN" }] });
            expect(pressTab(view)).toBe(true);
            await vi.waitFor(() => expect(view.state.doc.toString()).toBe("say be right back"));
        });

        it("takes the whole word around a caret inside it, rule included", async () => {
            const view = mount("on dd5 now", 5, 5, { patterns: [date] });
            expect(pressTab(view)).toBe(true);
            await vi.waitFor(() => expect(view.state.doc.toString()).toBe("on day 5 now"));
        });

        it("never takes an auto-pair closer: the bracket after the caret stays, as with Expand trigger at cursor", async () => {
            // Typing `(c` in Obsidian leaves `(c|)`. An instant rule on the typing path would swallow that `)`; Tab
            // reads no pair state, so the user's bracket is kept.
            const view = mount("x (c)", 4, 4, { patterns: [{ source: String.raw`/\(c$/`, replacement: "\u00a9" }] });
            expect(pressTab(view)).toBe(true);
            await vi.waitFor(() => expect(view.state.doc.toString()).toBe("x \u00a9)"));
        });

        it("a selection is never matched against rules (only a literal trigger is replaced)", async () => {
            const view = mount("on dd5", 3, 6, { patterns: [date] });
            expect(pressTab(view)).toBe(false);
            await new Promise((r) => setTimeout(r, 0));
            expect(view.state.doc.toString()).toBe("on dd5");
        });

        it("an instant-only rule is skipped on Tab: the key is not consumed (indent keeps it) and nothing is written", async () => {
            const view = mount("a ->", 4, 4, { patterns: [{ source: "/->$/", replacement: "\u2192", mode: "instant" }] });
            expect(pressTab(view)).toBe(false);
            await new Promise((r) => setTimeout(r, 0));
            expect(view.state.doc.toString()).toBe("a ->");
            // Control: the same rule as a separator rule does take the key.
            const sep = mount("a ->", 4, 4, { patterns: [{ source: "/->$/", replacement: "\u2192", mode: "separator" }] });
            expect(pressTab(sep)).toBe(true);
            await vi.waitFor(() => expect(sep.state.doc.toString()).toBe("a \u2192"));
        });

        it("the rules run once per Tab (health.runs counts one)", async () => {
            const set = compile([date]);
            const view = mount("on dd5", 6, 6, { compiled: () => set });
            expect(pressTab(view)).toBe(true);
            await vi.waitFor(() => expect(view.state.doc.toString()).toBe("on day 5"));
            expect(set.rules[0]?.health.runs).toBe(1);
        });

        it("a rule the guard takes out after the check cannot swallow the Tab: the checked hit is expanded", async () => {
            const set = compile([date]);
            // What the guard (strikes, 8 ms budget) can do after the check ran the rule: from its first run on the
            // rule reads as switched off. A second run would find nothing, with the key already consumed.
            const health = set.rules[0]?.health;
            if (!health) throw new Error("rule missing");
            Object.defineProperty(health, "switchedOff", {
                get: () => (health.runs >= 1 ? "Switched off: test." : undefined),
                configurable: true,
            });
            const view = mount("on dd5", 6, 6, { compiled: () => set });
            expect(pressTab(view)).toBe(true);
            await vi.waitFor(() => expect(view.state.doc.toString()).toBe("on day 5"));
            expect(health.runs).toBe(1);
        });

        // Owner decision: a match that starts after the caret would replace a tail the caret is not in.
        const tail = { source: String.raw`/dd(\d+)$/`, replacement: "day {{1}}" };

        it("a caret inside a word does not take a rule that matches only the tail after it (Tab passes through)", async () => {
            const view = mount("abcdd5 x", 1, 1, { patterns: [tail] });
            expect(pressTab(view)).toBe(false);
            await new Promise((r) => setTimeout(r, 0));
            expect(view.state.doc.toString()).toBe("abcdd5 x");
            expect(view.state.selection.main.head).toBe(1);
        });

        it("a caret inside the match still expands it", async () => {
            const view = mount("abcdd5 x", 4, 4, { patterns: [tail] });
            expect(pressTab(view)).toBe(true);
            await vi.waitFor(() => expect(view.state.doc.toString()).toBe("abcday 5 x"));
        });

        it("inside an open field session Tab still jumps fields; rules do not start a new expansion", async () => {
            const view = mount("lnk dd5", 3, 3, { patterns: [date] });
            expect(pressTab(view)).toBe(true);
            await vi.waitFor(() => expect(hasFieldSession(view.state)).toBe(true));
            expect(view.state.selection.main.head).toBe(1);
            // The field text sits right before ... a rule match elsewhere on the line must not steal the key.
            expect(pressTab(view)).toBe(true);
            expect(view.state.selection.main.head).toBe(3);
            expect(view.state.doc.toString()).toBe("[]() dd5");
        });
    });
});

describe("typing through the built extension honours Expand while typing (B-255)", () => {
    /** A typed space after the caret text, the way CM6's own input handler tags it. */
    function typeSpace(view: EditorView): void {
        view.focus();
        const at = view.state.doc.length;
        view.dispatch({ changes: { from: at, insert: " " }, selection: { anchor: at + 1 }, userEvent: "input.type" });
    }

    it("control: with typing on, `brb` + space expands", async () => {
        const view = mount("brb", 3, 3, { onType: true });
        typeSpace(view);
        await vi.waitFor(() => expect(view.state.doc.toString()).toBe("be right back "));
    });

    it("with typing off the same keystroke expands nothing (the setting reaches the composition-retry plugin)", async () => {
        const view = mount("brb", 3, 3, { onType: false });
        typeSpace(view);
        // An expansion lands after the update (a microtask and more): give it every chance, then check.
        await new Promise((r) => setTimeout(r, 20));
        expect(view.state.doc.toString()).toBe("brb ");
    });
});
