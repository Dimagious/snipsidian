/**
 * Pure helpers for determining Markdown contexts.
 * Work via the provided getLine/lastLine callbacks (no dependencies on the Obsidian API).
 */

export function isInYamlFrontmatter(
    getLine: (i: number) => string,
    lastLine: number,
    curLine: number
): boolean {
    const first = (getLine(0) ?? "").trim();
    if (first !== "---") return false;

    for (let i = 1; i <= Math.min(curLine, lastLine); i++) {
        const t = (getLine(i) ?? "").trim();
        if (t === "---") return false;
        if (i === curLine) return true;
    }
    return curLine > 0; // no closing found, but cursor is below the first line
}

export function isInFencedCode(
    getLine: (i: number) => string,
    lastLine: number,
    curLine: number
): boolean {
    let inFence = false as boolean;
    let fenceToken: "`" | "~" | null = null;

    for (let i = 0; i <= Math.min(curLine, lastLine); i++) {
        const trimmed = (getLine(i) ?? "").trimStart();
        if (trimmed.startsWith("```")) {
            if (!inFence) { inFence = true; fenceToken = "`"; }
            else if (fenceToken === "`") inFence = (i === curLine) ? false : false;
            continue;
        }
        if (trimmed.startsWith("~~~")) {
            if (!inFence) { inFence = true; fenceToken = "~"; }
            else if (fenceToken === "~") inFence = (i === curLine) ? false : false;
            continue;
        }
    }
    return inFence;
}

export function isInInlineCode(line: string, cursorCh: number): boolean {
    const before = line.slice(0, cursorCh);
    let i = 0, ticks = 0;
    while (i < before.length) {
        if (before[i] === "\\") { i += 2; continue; }
        if (before.startsWith("```", i)) { i += 3; continue; } // ignore triple backticks
        if (before[i] === "`") { ticks++; i++; continue; }
        i++;
    }
    return ticks % 2 === 1;
}
