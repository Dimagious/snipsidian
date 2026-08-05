/**
 * In-memory Editor mock — promoted from `adapters/obsidian-editor.test.ts`
 * so multiple test suites (adapter, integration, future UI) share a
 * single implementation. Backlog B-077.
 *
 * Implements the surface of `obsidian.Editor` that Snipsy actually
 * uses: cursor + selection + line access + range replacement. The
 * stub deliberately doesn't try to model every Obsidian Editor
 * method — only what the code under test calls. Adding new fields
 * here is cheap; modelling fold/transaction state is not necessary.
 */

export interface CursorPos {
    line: number;
    ch: number;
}

export class MockEditor {
    /** Document content as line array. Last element is the line the
     *  cursor sits on for single-line documents. */
    lines: string[];
    /** Current cursor position. */
    cursor: CursorPos = { line: 0, ch: 0 };
    /** Currently selected text (or empty string for no selection).
     *  The mock treats selection as a string only — we don't model
     *  selection anchors because Snipsy doesn't depend on anchor
     *  positions, only on `getSelection()` returning the text. */
    selection: string = "";

    constructor(text: string = "") {
        this.lines = text.split("\n");
    }

    setCursor(pos: CursorPos): void {
        this.cursor = { line: pos.line, ch: pos.ch };
    }

    getCursor(_mode?: "from" | "to" | "head" | "anchor"): CursorPos {
        // All cursor modes collapse to the single tracked position in
        // this mock. Snipsy only reads `getCursor()` (no mode) on the
        // hot path and `getCursor("from")` / `getCursor("to")` for
        // selection bounds, which we don't model separately.
        return { ...this.cursor };
    }

    getLine(i: number): string {
        return this.lines[i] ?? "";
    }

    lastLine(): number {
        return this.lines.length - 1;
    }

    getSelection(): string {
        return this.selection;
    }

    /**
     * Fold-in (2026-08 improvement audit, tests#6): the pre-fix
     * version spliced `text` into the selection's line verbatim,
     * never splitting on embedded `\n` — a multi-line wrap result
     * (e.g. a snippet's `$1` replaced by a multi-line selection)
     * produced a single "line" that actually contained newline
     * characters, an editor state no real Obsidian document can be
     * in. Delegates to `replaceRange` (which already splits
     * correctly) over the selection's `[from, to)` span — the
     * selection itself is assumed single-line (Snipsy never selects
     * across lines for the wrap-with-snippet flow this mock backs),
     * so only the FROM/TO computation stays a same-line approximation;
     * the inserted `text` is free to be multi-line.
     */
    replaceSelection(text: string): void {
        if (this.selection) {
            const cursor = this.getCursor();
            const from: CursorPos = { line: cursor.line, ch: cursor.ch - this.selection.length };
            const to: CursorPos = { line: cursor.line, ch: cursor.ch };
            this.replaceRange(text, from, to);
            this.selection = "";

            // `replaceRange` only auto-advances the cursor for a
            // zero-width `from === to` insert (the hot-path
            // expansion case) — a selection replacement always has
            // `from.ch !== to.ch`, so land the cursor here instead,
            // at the real end of the inserted text.
            const insertLines = text.split("\n");
            this.cursor =
                insertLines.length === 1
                    ? { line: from.line, ch: from.ch + text.length }
                    : {
                          line: from.line + insertLines.length - 1,
                          ch: insertLines[insertLines.length - 1]?.length ?? 0,
                      };
        } else {
            const cursor = this.getCursor();
            this.replaceRange(text, cursor, cursor);
        }
    }

    /**
     * Replace the range `[from, to)` with `text`. Supports multi-line
     * inserts (text containing `\n`). Mirrors Obsidian's contract
     * closely enough for the engine's edit plans.
     */
    replaceRange(text: string, from: CursorPos, to: CursorPos): void {
        const startLine = this.lines[from.line] ?? "";
        const endLine = this.lines[to.line] ?? "";
        const before = startLine.slice(0, from.ch);
        const after = endLine.slice(to.ch);

        const insertLines = text.split("\n");

        if (from.line === to.line) {
            if (insertLines.length === 1) {
                this.lines[from.line] = before + text + after;
            } else {
                const newLines = [
                    before + insertLines[0],
                    ...insertLines.slice(1, -1),
                    insertLines[insertLines.length - 1] + after,
                ];
                this.lines.splice(from.line, 1, ...newLines);
            }
        } else {
            const head = this.lines.slice(0, from.line);
            const tail = this.lines.slice(to.line + 1);
            const midFirst = before + insertLines[0];
            const midLast = insertLines[insertLines.length - 1] + after;
            const mids = insertLines.slice(1, -1);
            this.lines = [...head, midFirst, ...mids, midLast, ...tail];
        }

        // Only auto-advance the cursor on the simple-insert case; the
        // engine's edit plans set the cursor explicitly otherwise.
        if (from.line === to.line && insertLines.length === 1 && from.ch === to.ch) {
            this.cursor.ch = from.ch + text.length;
        }
    }

    /** Convenience for tests: render the document back to a single
     *  string so assertions can be `expect(editor.value()).toBe(...)`. */
    value(): string {
        return this.lines.join("\n");
    }
}

/**
 * Builds a `MockEditor` with optional initial content and cursor
 * position. Default cursor: end of document.
 */
export function makeMockEditor(opts: {
    text?: string;
    cursor?: CursorPos;
    selection?: string;
} = {}): MockEditor {
    const editor = new MockEditor(opts.text ?? "");
    if (opts.cursor) {
        editor.setCursor(opts.cursor);
    } else {
        // Default to end of document.
        const lastLine = editor.lastLine();
        const lastLineText = editor.getLine(lastLine);
        editor.setCursor({ line: lastLine, ch: lastLineText.length });
    }
    if (opts.selection) editor.selection = opts.selection;
    return editor;
}
