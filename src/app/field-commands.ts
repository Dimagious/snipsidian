// src/app/field-commands.ts
import type { App, Editor } from "obsidian";
import { tryExpandAtCursor } from "../adapters/obsidian-editor";
import { readClipboardSafe } from "../adapters/clipboard";
import { clock } from "../adapters/clock";
import type { Dict } from "../engine/types";
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
 */
export async function expandTriggerAtCursor(
    app: App,
    editor: Editor,
    getSnippets: () => Dict,
    getPrefix: () => string | undefined,
): Promise<void> {
    const filename = app.workspace.activeEditor?.file?.name;
    const result = await tryExpandAtCursor(editor, getSnippets(), {
        filename,
        now: clock.now(),
        readClipboard: readClipboardSafe,
        prefix: getPrefix(),
    });
    if (result) {
        startFieldSessionInEditor(editor, result.session);
        return;
    }
    jumpToNextField(editor);
}
