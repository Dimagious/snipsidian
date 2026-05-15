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

    replaceSelection(text: string): void {
        if (this.selection) {
            const cursor = this.getCursor();
            const line = this.getLine(cursor.line);
            const before = line.slice(0, cursor.ch - this.selection.length);
            const after = line.slice(cursor.ch);
            this.lines[cursor.line] = before + text + after;
            this.selection = "";
            this.cursor.ch = before.length + text.length;
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
