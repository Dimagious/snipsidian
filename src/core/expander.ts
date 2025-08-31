import type { Editor, EditorPosition } from "obsidian";

/**
 * Expand trigger before the cursor when the last typed character is a separator.
 * Replaces only the word; keeps the separator (undo-friendly).
 * Supports a single cursor placeholder "$|" inside the replacement.
 */
export function expandIfTriggered(editor: Editor, snippets: Record<string, string>) {
    const cursor = editor.getCursor();
    const lineText = editor.getLine(cursor.line);
    if (cursor.ch === 0) return;

    const prevChar = lineText[cursor.ch - 1] ?? "";
    if (!isSeparator(prevChar)) return;

    const sepIndex = cursor.ch - 1;    // position of the separator just typed
    const lastWordChar = sepIndex - 1; // last character of the word
    const start = findWordStart(lineText, lastWordChar);
    if (start === null) return;

    const trigger = lineText.slice(start, sepIndex);
    if (!trigger) return;

    const raw = snippets[trigger];
    if (raw === undefined) return;

    // Resolve cursor placeholder "$|"
    const marker = "$|";
    const markerIndex = raw.indexOf(marker);
    const replacement =
        markerIndex >= 0
            ? raw.slice(0, markerIndex) + raw.slice(markerIndex + marker.length)
            : raw;

    // Replace only the word; keep the separator
    const from: EditorPosition = { line: cursor.line, ch: start };
    const to: EditorPosition = { line: cursor.line, ch: sepIndex };
    editor.replaceRange(replacement, from, to);

    // Place cursor at "$|" if present
    if (markerIndex >= 0) {
        const targetPos = advancePos(from, raw.slice(0, markerIndex));
        editor.setCursor(targetPos);
    }
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

/** Move an EditorPosition forward by the given text content (handles newlines). */
function advancePos(from: EditorPosition, text: string): EditorPosition {
    let line = from.line;
    let ch = from.ch;

    const parts = text.split("\n");
    if (parts.length === 1) {
        ch += text.length;
        return { line, ch };
    }
    // Move down by number of newlines
    line += parts.length - 1;
    ch = parts[parts.length - 1].length; // length after the last newline
    return { line, ch };
}
