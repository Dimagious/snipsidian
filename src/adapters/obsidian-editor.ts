import type { Editor, EditorPosition } from "obsidian";
import { expand } from "../engine";
import type { Dict, EditPlan, ExpandContext, ExpandInput } from "../engine/types";
import { isSeparator } from "../shared/delimiters";
import { isInFencedCode, isInInlineCode, isInYamlFrontmatter } from "../shared/markdown";

export function makeExpandInput(editor: Editor, sepCh: number, lastTyped: string): ExpandInput {
    const cursor = editor.getCursor();
    const lineText = editor.getLine(cursor.line) ?? "";
    const textBefore = lineText.slice(0, sepCh);
    const textAfter = lineText.slice(sepCh + 1);
    return { textBefore, textAfter, lastTyped, sepCh };
}

export function makeContext(
    editor: Editor,
    filename: string | undefined,
    now: Date,
    readClipboard?: () => Promise<string>
): ExpandContext {
    const cursor = editor.getCursor();
    const getLine = (i: number) => editor.getLine(i) ?? "";
    const last = editor.lastLine();

    const isFront = isInYamlFrontmatter(getLine, last, cursor.line);
    const isFence = isInFencedCode(getLine, last, cursor.line);
    const isInline = isInInlineCode(getLine(cursor.line), cursor.ch);

    return {
        isInCode: isFence || isInline,
        isInMath: false,
        isInFrontmatter: isFront,
        filename,
        now,
        readClipboard
    };
}

export function applyEditPlan(editor: Editor, plan: EditPlan) {
    const cur = editor.getCursor();
    const from: EditorPosition = { line: cur.line, ch: plan.fromCh };
    const to: EditorPosition = { line: cur.line, ch: plan.toCh };
    editor.replaceRange(plan.insert, from, to);
    if (plan.newCursor !== undefined) {
        editor.setCursor({
            line: cur.line + plan.newCursor.lineDelta,
            ch: plan.newCursor.ch,
        });
    }
}

function advancePosition(from: EditorPosition, text: string): EditorPosition {
    const parts = text.split("\n");
    if (parts.length === 1) {
        return { line: from.line, ch: from.ch + text.length };
    }
    return {
        line: from.line + parts.length - 1,
        ch: parts[parts.length - 1]?.length ?? 0
    };
}

export async function tryExpandAtSeparator(
    editor: Editor,
    dict: Dict,
    deps: {
        filename?: string;
        now: Date;
        readClipboard?: () => Promise<string>;
    }
) {
    const cursor = editor.getCursor();
    const lineText = editor.getLine(cursor.line) ?? "";
    if (cursor.ch === 0) return;

    const lastTyped = lineText[cursor.ch - 1] ?? "";
    if (!isSeparator(lastTyped)) return;

    const sepCh = cursor.ch - 1;
    const input = makeExpandInput(editor, sepCh, lastTyped);
    const ctx = makeContext(editor, deps.filename, deps.now, deps.readClipboard);

    const plan = await expand(input, dict, ctx);
    if (!plan) return;

    applyEditPlan(editor, plan);
}

/**
 * Inserts a snippet at the current cursor position
 */
export function insertSnippetAtCursor(editor: Editor, replacement: string): void {
    const cursor = editor.getCursor();
    const selection = editor.getSelection();
    const from = selection ? editor.getCursor("from") : cursor;

    // Handle cursor position after insertion
    const cursorMatch = replacement.indexOf('$|');
    let cleanReplacement = replacement;
    let cursorPrefix = "";

    if (cursorMatch !== -1) {
        // Remove $| from text
        cleanReplacement = replacement.replace(/\$\|/g, '');
        cursorPrefix = replacement.slice(0, cursorMatch);
    }

    if (selection) {
        // If there's a selection, replace it
        editor.replaceSelection(cleanReplacement);
        // Set cursor to the correct position
        if (cursorMatch >= 0) {
            try {
                const newCursor = advancePosition(from, cursorPrefix);
                editor.setCursor(newCursor);
            } catch (error) {
                console.warn('Failed to set cursor position:', error);
            }
        }
    } else {
        // Otherwise insert at cursor position
        editor.replaceRange(cleanReplacement, cursor, cursor);
        // Set cursor to the correct position
        if (cursorMatch >= 0) {
            try {
                const newCursor = advancePosition(from, cursorPrefix);
                editor.setCursor(newCursor);
            } catch (error) {
                console.warn('Failed to set cursor position:', error);
            }
        }
    }
}

/**
 * Wraps selection with a snippet (if supported)
 */
export function wrapSelectionWithSnippet(editor: Editor, replacement: string): void {
    const selection = editor.getSelection();
    
    if (!selection) {
        // If no selection, just insert
        insertSnippetAtCursor(editor, replacement);
        return;
    }
    
    // Get current cursor position before replacement
    const from = editor.getCursor('from');

    const CURSOR_SENTINEL = "__SNIPSIDIAN_CURSOR__";
    const cursorMatch = replacement.indexOf("$|");

    let template = replacement;
    if (cursorMatch >= 0) {
        template = replacement.replace("$|", CURSOR_SENTINEL).replace(/\$\|/g, "");
    } else {
        template = replacement.replace(/\$\|/g, "");
    }

    if (template.includes("${SEL}")) {
        template = template.replace("${SEL}", selection);
    } else if (template.includes("$1")) {
        template = template.replace("$1", selection);
    } else if (template.includes(CURSOR_SENTINEL)) {
        // If no selection placeholders exist, insert selection at cursor marker.
        template = template.replace(CURSOR_SENTINEL, `${selection}${CURSOR_SENTINEL}`);
    }

    const cursorOffset = template.indexOf(CURSOR_SENTINEL);
    const finalText = template.replace(CURSOR_SENTINEL, "");

    editor.replaceSelection(finalText);

    if (cursorOffset >= 0) {
        try {
            const newCursor = advancePosition(from, finalText.slice(0, cursorOffset));
            editor.setCursor(newCursor);
        } catch (error) {
            console.warn('Failed to set cursor position:', error);
        }
    }
}
