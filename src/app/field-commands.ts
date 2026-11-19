// src/app/field-commands.ts
import type { App, Editor } from "obsidian";
import { tryExpandAtCursor, type CursorExpansion, type ExpansionResult } from "../adapters/obsidian-editor";
import { readClipboardSafe } from "../adapters/clipboard";
import { clock } from "../adapters/clock";
import type { Dict } from "../engine/types";
import { NO_PATTERNS, type CompiledPatterns } from "../engine/patterns";
import { nextField, startFieldSessionInEditor } from "../adapters/field-session";

/**
 * Command "Next field" (mobile toolbar, no default hotkey): jumps to the next
 * field while a session is open, otherwise does nothing.
 */
export function jumpToNextField(editor: Editor): boolean {
    const view = editor.cm;
    return view ? nextField(view) : false;
}

/**
 * B-244, command "Expand trigger at cursor": expands the trigger that ends at
 * the caret through the same engine and guards as typing, then opens the field
 * session if the snippet has fields. With no trigger there, jumps to the next
 * field of an open session (one hotkey for both). Neither applies: nothing
 * happens and nothing is shown.
 *
 * B-255 `manual` (the Tab key, the Text Snippets alias command): also takes a
 * selection that is a trigger and a caret inside a word. Returns what was
 * expanded (for the Tab path's highlight mark), `undefined` when nothing was.
 */
export async function expandTriggerAtCursor(
    app: App,
    editor: Editor,
    getSnippets: () => Dict,
    getPrefix: () => string | undefined,
    /** ADR-0008: separator-mode pattern rules are tried too (also on Tab); never an auto-pair closer. */
    getPatterns: () => CompiledPatterns = () => NO_PATTERNS,
    options: { manual?: boolean; prepared?: CursorExpansion } = {},
): Promise<ExpansionResult | undefined> {
    const filename = app.workspace.activeEditor?.file?.name;
    const result = await tryExpandAtCursor(editor, getSnippets(), {
        filename,
        now: clock.now(),
        readClipboard: readClipboardSafe,
        prefix: getPrefix(),
        patterns: getPatterns().rules,
        manual: options.manual,
        prepared: options.prepared,
    });
    if (result) {
        startFieldSessionInEditor(editor, result.session);
        return result;
    }
    jumpToNextField(editor);
    return undefined;
}
