import type { Editor } from "obsidian";

/**
 * Expand trigger before the cursor when the last typed character is a separator.
 * Replaces only the word; keeps the separator (undo-friendly).
 */
export function expandIfTriggered(editor: Editor, snippets: Record<string, string>) {
    const cursor = editor.getCursor();
    const lineText = editor.getLine(cursor.line);
    if (cursor.ch === 0) return;

    const prevChar = lineText[cursor.ch - 1] ?? "";
    if (!isSeparator(prevChar)) return;

    const sepIndex = cursor.ch - 1;    // position of the separator
    const lastWordChar = sepIndex - 1; // last character of the word
    const start = findWordStart(lineText, lastWordChar);
    if (start === null) return;

    const trigger = lineText.slice(start, sepIndex);
    if (!trigger) return;

    const replacement = snippets[trigger];
    if (replacement === undefined) return;

    const from = { line: cursor.line, ch: start };
    const to = { line: cursor.line, ch: sepIndex };
    editor.replaceRange(replacement, from, to);
}

/** Return true if the character is considered a separator */
export function isSeparator(ch: string): boolean {
    return /[\s.,!?;:()\[\]{}"'\-\\/]/.test(ch);
}

/** Find start index of a word ending at endIndex (inclusive). Return index or null. */
export function findWordStart(text: string, endIndex: number): number | null {
    if (endIndex < 0) return null;
    let i = endIndex;

    const isWord = (c: string) => /[A-Za-z0-9_]/.test(c);

    if (!isWord(text[i])) return null;
    while (i - 1 >= 0 && isWord(text[i - 1])) i--;
    return i;
}
