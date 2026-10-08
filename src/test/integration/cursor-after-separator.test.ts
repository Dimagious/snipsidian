import { describe, it, expect } from "vitest";
import { tryExpandAtSeparator } from "../../adapters/obsidian-editor";
import type { Editor } from "obsidian";
import type { Dict } from "../../engine/types";
import { makeMockEditor } from "../factories/editor";

/**
 * B-182: after an expansion without `$|` the cursor must sit right AFTER the
 * separator the user typed, so typing continues there. Pre-fix the adapter
 * set the cursor to the end of the insert, i.e. BEFORE the separator
 * (`brb then` became `be right backthen `).
 *
 * "Typing on" is simulated by inserting at the editor's cursor after the
 * expansion, which is exactly what the next keystroke does.
 */

const NOW = new Date("2026-10-08T10:00:00Z");
const dict: Dict = { brb: "be right back", box: "line1\nline2", h1: "# $|", cb: "> [!note]\n> $|" };

async function expandAt(
    text: string,
    cursor: { line: number; ch: number },
    prefix?: string,
): Promise<ReturnType<typeof makeMockEditor>> {
    const editor = makeMockEditor({ text, cursor });
    await tryExpandAtSeparator(editor as unknown as Editor, dict, { now: NOW, prefix });
    return editor;
}

function typeNext(editor: ReturnType<typeof makeMockEditor>, s: string): string {
    const c = editor.getCursor();
    editor.replaceRange(s, c, c);
    return editor.value();
}

describe("B-182: cursor lands after the typed separator", () => {
    it("`brb ` then typing continues after the space", async () => {
        const ed = await expandAt("brb ", { line: 0, ch: 4 });
        expect(ed.value()).toBe("be right back ");
        expect(ed.getCursor()).toEqual({ line: 0, ch: "be right back ".length });
        expect(typeNext(ed, "then ")).toBe("be right back then ");
    });

    it("punctuation separator mid-line: `x brb, y` keeps the comma before the cursor", async () => {
        const ed = await expandAt("x brb, y", { line: 0, ch: 6 });
        expect(ed.value()).toBe("x be right back, y");
        expect(ed.getCursor()).toEqual({ line: 0, ch: "x be right back,".length });
        expect(typeNext(ed, "Z")).toBe("x be right back,Z y");
    });

    it("multi-line replacement without `$|`: cursor after the separator on the last inserted line", async () => {
        const ed = await expandAt("box ", { line: 0, ch: 4 });
        expect(ed.value()).toBe("line1\nline2 ");
        expect(ed.getCursor()).toEqual({ line: 1, ch: "line2 ".length });
        expect(typeNext(ed, "more")).toBe("line1\nline2 more");
    });

    it("multi-line replacement with text after the cursor keeps the tail intact", async () => {
        const ed = await expandAt("box tail", { line: 0, ch: 4 });
        expect(ed.value()).toBe("line1\nline2 tail");
        expect(ed.getCursor()).toEqual({ line: 1, ch: "line2 ".length });
    });

    it("`$|` replacement is unchanged: cursor at the marker", async () => {
        const ed = await expandAt("h1 ", { line: 0, ch: 3 });
        expect(ed.value()).toBe("#  ");
        expect(ed.getCursor()).toEqual({ line: 0, ch: 2 });
        expect(typeNext(ed, "Hello")).toBe("# Hello ");
    });

    it("multi-line `$|` replacement is unchanged: cursor on the second line", async () => {
        const ed = await expandAt("cb ", { line: 0, ch: 3 });
        expect(ed.getCursor()).toEqual({ line: 1, ch: 2 });
    });

    it("Enter as separator: cursor stays on the new line", async () => {
        const ed = await expandAt("brb\n", { line: 1, ch: 0 });
        expect(ed.value()).toBe("be right back\n");
        expect(ed.getCursor()).toEqual({ line: 1, ch: 0 });
    });

    it("Enter as separator with a multi-line replacement: cursor follows to the shifted line", async () => {
        const ed = await expandAt("box\n", { line: 1, ch: 0 });
        expect(ed.value()).toBe("line1\nline2\n");
        expect(ed.getCursor()).toEqual({ line: 2, ch: 0 });
    });

    it("prefix mode: `:brb ` consumes the prefix and the cursor stays after the space", async () => {
        const ed = await expandAt(":brb ", { line: 0, ch: 5 }, ":");
        expect(ed.value()).toBe("be right back ");
        expect(ed.getCursor()).toEqual({ line: 0, ch: "be right back ".length });
        expect(typeNext(ed, "then")).toBe("be right back then");
    });
});
