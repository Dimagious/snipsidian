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
    if (plan.newCursorCh !== undefined) {
        editor.setCursor({ line: cur.line, ch: plan.newCursorCh });
    }
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

    // Handle cursor position after insertion
    const cursorMatch = replacement.indexOf('$|');
    let cleanReplacement = replacement;
    let cursorOffset = 0;

    if (cursorMatch !== -1) {
        // Remove $| from text
        cleanReplacement = replacement.replace(/\$\|/g, '');
        cursorOffset = cursorMatch;
    }

    if (selection) {
        // If there's a selection, replace it
        editor.replaceSelection(cleanReplacement);
        // Set cursor to the correct position
        if (cursorOffset > 0) {
            try {
                const newCursor = {
                    line: cursor.line,
                    ch: cursor.ch - selection.length + cursorOffset
                };
                editor.setCursor(newCursor);
            } catch (error) {
                console.warn('Failed to set cursor position:', error);
            }
        }
    } else {
        // Otherwise insert at cursor position
        editor.replaceRange(cleanReplacement, cursor, cursor);
        // Set cursor to the correct position
        if (cursorOffset > 0) {
            try {
                const newCursor = {
                    line: cursor.line,
                    ch: cursor.ch + cursorOffset
                };
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
    
    // Handle cursor position after insertion
    const cursorMatch = replacement.indexOf('$|');
    let cleanReplacement = replacement;
    let cursorOffset = 0;

    if (cursorMatch !== -1) {
        // Remove $| from text
        cleanReplacement = replacement.replace(/\$\|/g, '');
        cursorOffset = cursorMatch;
    }
    
    // Get current cursor position before replacement
    const from = editor.getCursor('from');
    const to = editor.getCursor('to');
    
    // Check if snippet supports wrapping
    if (cleanReplacement.includes('${SEL}')) {
        // Replace ${SEL} with selected text
        const wrappedReplacement = cleanReplacement.replace('${SEL}', selection);
        editor.replaceSelection(wrappedReplacement);
    } else if (cleanReplacement.includes('$1')) {
        // If $1 exists, use it as a container for selection
        const wrappedReplacement = cleanReplacement.replace('$1', selection);
        editor.replaceSelection(wrappedReplacement);
    } else if (cursorOffset > 0) {
        // If cursor position $| exists, insert selected text there
        const beforeCursor = cleanReplacement.substring(0, cursorOffset);
        const afterCursor = cleanReplacement.substring(cursorOffset);
        const wrappedReplacement = beforeCursor + selection + afterCursor;
        editor.replaceSelection(wrappedReplacement);
    } else {
        // Otherwise just replace selection with replacement
        editor.replaceSelection(cleanReplacement);
    }
    
    // Set cursor to the correct position
    if (cursorOffset > 0) {
        try {
            let newCursor;
            if (cleanReplacement.includes('${SEL}') || cleanReplacement.includes('$1')) {
                // If special placeholders were used, cursor stays at the end
                newCursor = {
                    line: from.line,
                    ch: from.ch + cleanReplacement.length
                };
            } else {
                // If selected text was inserted at $| position, cursor is placed after it
                newCursor = {
                    line: from.line,
                    ch: from.ch + cursorOffset + selection.length
                };
            }
            editor.setCursor(newCursor);
        } catch (error) {
            console.warn('Failed to set cursor position:', error);
        }
    }
}
