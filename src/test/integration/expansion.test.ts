import { describe, it, expect } from "vitest";
import { tryExpandAtSeparator } from "../../adapters/obsidian-editor";
import type { Editor } from "obsidian";
import type { Dict } from "../../engine/types";
import { makeMockEditor } from "../factories/editor";

/**
 * Integration tests for the snippet expansion flow.
 *
 * These exercise the full path that fires on every editor keystroke:
 *
 *     cm6-bridge → tryExpandAtSeparator → makeExpandInput
 *                                       → makeContext
 *                                       → engine.expand
 *                                       → applyEditPlan
 *
 * Backlog B-081. Per ADR-0005, every assertion is at a contract
 * boundary. The high-frequency bug classes in the audit (B-010
 * multi-line cursor, B-011 variable order, code-block suppression,
 * frontmatter suppression) all lived in this seam — unit tests on
 * isolated functions weren't enough; the adapter + engine wiring
 * needed end-to-end coverage.
 *
 * Engine model (important when reading these tests):
 *
 *   - Triggers are stored as bare words in the dict: `todo`, `h1`.
 *     A colon prefix would be eaten as a separator before the
 *     trigger ever reached the engine.
 *   - Separators are: whitespace, `.,!?;:()[]{}"'`. Any of them
 *     completes a trigger on its way past the cursor.
 *   - Variables are `$date`, `$time`, `$filename`, `$clipboard`
 *     (with word boundary). The `{{date:...}}` syntax in presets is
 *     Templater's, NOT Snipsy's — engine doesn't substitute those.
 *   - Cursor marker is `$|`, resolved AFTER variable substitution
 *     so length-changing variables don't desync the caret (B-011).
 *
 * Test pattern:
 *   1. Build a `MockEditor` with the document state right after the
 *      user typed the separator character
 *   2. Place the cursor immediately past the separator
 *   3. Call `tryExpandAtSeparator(editor, dict, { now })`
 *   4. Assert the resulting document + cursor
 */

const FIXED_NOW = new Date("2026-05-15T10:30:00Z");

/** Simulates "user typed text plus a trailing separator" by placing
 *  the cursor at the very end of the line. The adapter reads
 *  `cursor.ch - 1` as the separator position. */
function typeTextEndingWithSeparator(text: string) {
    return makeMockEditor({ text, cursor: { line: 0, ch: text.length } });
}

async function expand(editor: ReturnType<typeof typeTextEndingWithSeparator>, dict: Dict) {
    await tryExpandAtSeparator(editor as unknown as Editor, dict, { now: FIXED_NOW });
}

describe("integration: keystroke → expansion (happy path)", () => {
    it("expands `todo ` to `- [ ] `", async () => {
        const editor = typeTextEndingWithSeparator("todo ");
        await expand(editor, { todo: "- [ ] " });
        // Engine replaces chars [0, 4) with the replacement; the
        // trailing separator (the space) is preserved untouched.
        expect(editor.value()).toBe("- [ ]  ");
    });

    it("expands `h1 ` to `# `", async () => {
        const editor = typeTextEndingWithSeparator("h1 ");
        await expand(editor, { h1: "# " });
        expect(editor.value()).toBe("#  ");
    });

    it("does nothing when the trigger isn't in the dict", async () => {
        const editor = typeTextEndingWithSeparator("unknown ");
        await expand(editor, { todo: "- [ ] " });
        expect(editor.value()).toBe("unknown ");
        expect(editor.getCursor()).toEqual({ line: 0, ch: "unknown ".length });
    });

    it("does nothing when the cursor is at column 0 (no separator preceding)", async () => {
        // Boundary case: cursor.ch === 0 short-circuits in the adapter
        // before the engine runs.
        const editor = makeMockEditor({ text: "todo", cursor: { line: 0, ch: 0 } });
        await expand(editor, { todo: "- [ ] " });
        expect(editor.value()).toBe("todo");
    });

    it("does nothing when the last typed char isn't a separator", async () => {
        // Cursor at end of `todo` (no separator yet typed). No
        // expansion should fire until the separator arrives.
        const editor = makeMockEditor({ text: "todo", cursor: { line: 0, ch: 4 } });
        await expand(editor, { todo: "- [ ] " });
        expect(editor.value()).toBe("todo");
    });
});

describe("integration: cursor placement (B-010 / B-011 regression surface)", () => {
    it("places the cursor at the `$|` marker for a single-line snippet", async () => {
        const editor = typeTextEndingWithSeparator("hi ");
        await expand(editor, { hi: "Hello, $| world." });
        // After expansion the `$|` marker is gone from the document;
        // the cursor sits where it stood. Trailing space is preserved.
        expect(editor.value()).toBe("Hello,  world. ");
        // Cursor sits at column = length of "Hello, " — the marker
        // position in the substituted text.
        const cur = editor.getCursor();
        expect(cur.line).toBe(0);
        expect(cur.ch).toBe("Hello, ".length);
    });

    it("places the cursor on the correct line for a multi-line snippet (B-010)", async () => {
        // The B-010 bug: multi-line replacements landed the cursor on
        // the wrong line because `EditPlan` only carried `ch`, no
        // `lineDelta`. The fix added `lineDelta` to the plan; this
        // test pins it so a regression would fail before re-shipping.
        const editor = typeTextEndingWithSeparator("callout ");
        await expand(editor, {
            callout: "> [!note]\n> $|",
        });
        const cur = editor.getCursor();
        // The replacement contains a newline; `$|` is on the second
        // line of the inserted text. Cursor must land on that line,
        // not back on line 0.
        expect(cur.line).toBe(1);
        // Cursor sits after "> " on the second line of the inserted text.
        expect(cur.ch).toBe("> ".length);
    });

    it("substitutes variables BEFORE resolving the cursor marker (B-011)", async () => {
        // The B-011 bug: cursor index was computed against the raw
        // template (e.g. "Date $date $|done") *before* substituting
        // `$date`, so once the date was expanded the cursor landed
        // mid-string. The fix substitutes first, then locates `$|`.
        const editor = typeTextEndingWithSeparator("today ");
        await expand(editor, { today: "Date $date $|done" });
        const expectedDate = "2026-05-15";
        expect(editor.value()).toBe(`Date ${expectedDate} done `);
        const cur = editor.getCursor();
        // Cursor sits between the date and "done" — where `$|` was
        // in the *substituted* string, not the raw template.
        expect(cur.ch).toBe(`Date ${expectedDate} `.length);
    });
});

describe("integration: suppression in code / frontmatter contexts", () => {
    it("suppresses expansion inside a fenced code block", async () => {
        // Triple-backtick fence opens on line 0, trigger is on line 1
        // (still inside the fence). Expansion must NOT fire here —
        // hotstrings inside code blocks would corrupt verbatim content.
        const editor = makeMockEditor({
            text: "```\ntodo \n```",
            cursor: { line: 1, ch: "todo ".length },
        });
        await expand(editor, { todo: "- [ ] " });
        expect(editor.value()).toBe("```\ntodo \n```");
    });

    it("suppresses expansion inside YAML frontmatter", async () => {
        // Frontmatter is the `---` block at the top of the document.
        // Triggers inside the YAML must not expand — they'd corrupt
        // the document's frontmatter structure.
        const editor = makeMockEditor({
            text: "---\ntitle: todo \n---\nbody",
            cursor: { line: 1, ch: "title: todo ".length },
        });
        await expand(editor, { todo: "- [ ] " });
        expect(editor.value()).toBe("---\ntitle: todo \n---\nbody");
    });

    it("does expand outside the code fence (negative control)", async () => {
        // Counterpart of the fence-suppression test: same fence pattern
        // but the trigger is on a line AFTER the closing fence. If the
        // scanner failed to short-circuit on the closing ``` it would
        // over-suppress here.
        const editor = makeMockEditor({
            text: "```\ncode\n```\ntodo ",
            cursor: { line: 3, ch: "todo ".length },
        });
        await expand(editor, { todo: "- [ ] " });
        expect(editor.value()).toBe("```\ncode\n```\n- [ ]  ");
    });
});

describe("integration: separator characters", () => {
    it("expands on punctuation separators (period, comma)", async () => {
        // Period is a separator — typing `hi.` mid-sentence completes
        // the trigger and replaces it inline.
        const editor = typeTextEndingWithSeparator("hi.");
        await expand(editor, { hi: "Hello" });
        expect(editor.value()).toBe("Hello.");
    });

    it("treats embedded separators as trigger boundaries (`foo:hi `)", async () => {
        // `foo:hi ` — the colon is a separator that splits the line
        // into two trigger-search regions. The engine scans backwards
        // from the trailing space and stops at the colon, so the
        // trigger is `hi` (not `foo:hi`). Expansion replaces `hi` in
        // place — `foo:` is untouched.
        const editor = typeTextEndingWithSeparator("foo:hi ");
        await expand(editor, { hi: "Hello" });
        expect(editor.value()).toBe("foo:Hello ");
    });
});
