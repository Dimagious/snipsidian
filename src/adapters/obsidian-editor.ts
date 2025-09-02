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
