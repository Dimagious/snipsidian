import type { Editor, EditorPosition } from "obsidian";

/**
 * Expand trigger before the cursor when the last typed character is a separator.
 * Replaces only the word; keeps the separator (undo-friendly).
 * Supports a single cursor placeholder "$|" inside the replacement.
 * Skips expansion inside inline code, fenced code blocks, and YAML frontmatter.
 */
export function expandIfTriggered(editor: Editor, snippets: Record<string, string>) {
    const cursor = editor.getCursor();
    const lineText = editor.getLine(cursor.line);
    if (cursor.ch === 0) return;

    const prevChar = lineText[cursor.ch - 1] ?? "";
    if (!isSeparator(prevChar)) return;

    // Skip in code-oriented contexts
    if (isInCodeContext(editor, cursor)) return;

    const sepIndex = cursor.ch - 1;    // separator just typed
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

/** Returns true if the character is considered a separator */
export function isSeparator(ch: string): boolean {
    // eslint-disable-next-line no-useless-escape -- \[ and \] are REQUIRED inside [] to match literal brackets
    return /[\s.,!?;:()\[\]{}"'/\\-]/.test(ch);
}

/** Find start index of a word ending at endIndex (inclusive). Return index or null. */
export function findWordStart(text: string, endIndex: number): number | null {
    if (endIndex < 0) return null;
    let i = endIndex;

    const isWord = (c: string) => /[A-Za-z0-9_]/.test(c);

    if (!isWord(text[i] ?? "")) return null;
    while (i - 1 >= 0 && isWord(text[i - 1] ?? "")) i--;
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
    line += parts.length - 1;
    ch = parts[parts.length - 1]?.length ?? 0;
    return { line, ch };
}

/** True if cursor is inside code context: inline code, fenced code, or YAML frontmatter. */
function isInCodeContext(editor: Editor, cursor: EditorPosition): boolean {
    if (isInYamlFrontmatter(editor, cursor.line)) return true;
    if (isInFencedCode(editor, cursor.line)) return true;
    if (isInInlineCode(editor, cursor)) return true;
    return false;
}

/** YAML frontmatter: lines between leading '---' and the next '---'. */
function isInYamlFrontmatter(editor: Editor, curLine: number): boolean {
    const firstLine = editor.getLine(0)?.trim();
    if (firstLine !== "---") return false;

    // Find the closing '---' after line 0
    const last = Math.min(curLine, editor.lastLine());
    for (let i = 1; i <= last; i++) {
        const t = editor.getLine(i).trim();
        if (t === "---") {
            // closing delimiter found; cursor inside only if before closing line
            return false;
        }
        if (i === curLine) return true;
    }
    // No closing delimiter yet and cursor is below the opening
    return curLine > 0;
}

/**
 * Fenced code blocks: toggle on lines that start with ``` or ~~~ (trimmed).
 * Heuristic: a line whose trimmed text starts with triple backticks or tildes toggles fence state.
 */
function isInFencedCode(editor: Editor, curLine: number): boolean {
    let inFence = false;
    let fenceToken: "`" | "~" | null = null;

    for (let i = 0; i <= curLine; i++) {
        const line = editor.getLine(i);
        const trimmed = line.trimStart();

        // Detect a fence opener/closer at line start: ``` or ~~~
        if (trimmed.startsWith("```")) {
            if (!inFence) {
                inFence = true;
                fenceToken = "`";
            } else if (fenceToken === "`") {
                // closing the same type of fence
                // If curLine is exactly this line, we consider the cursor outside only after the line is completed.
                if (i < curLine) inFence = false;
                else inFence = false; // safest: treat as closed at this line
            }
            continue;
        }
        if (trimmed.startsWith("~~~")) {
            if (!inFence) {
                inFence = true;
                fenceToken = "~";
            } else if (fenceToken === "~") {
                if (i < curLine) inFence = false;
                else inFence = false;
            }
            continue;
        }
    }
    return inFence;
}

/**
 * Inline code: an odd number of unescaped single backticks (`) before the cursor
 * on the current line indicates the cursor is inside `inline code`.
 * We ignore triple backticks (```), treating them as fences handled elsewhere.
 */
function isInInlineCode(editor: Editor, cursor: EditorPosition): boolean {
    const line = editor.getLine(cursor.line);
    const before = line.slice(0, cursor.ch);

    let i = 0;
    let ticks = 0;
    while (i < before.length) {
        if (before[i] === "\\") {
            i += 2; // skip escaped char
            continue;
        }
        // Skip ``` sequences entirely
        if (before.startsWith("```", i)) {
            i += 3;
            continue;
        }
        if (before[i] === "`") {
            ticks++;
            i++;
            continue;
        }
        i++;
    }
    // Inside if we saw an odd number of backticks before the cursor
    return ticks % 2 === 1;
}
