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
    let inFence = false;
    let fenceToken: "`" | "~" | null = null;

    for (let i = 0; i <= Math.min(curLine, lastLine); i++) {
        const t = (getLine(i) ?? "");
        const m = t.match(/^\s*(```|~~~)/);
        if (!m) continue;
        const token = m[1] === "```" ? "`" : "~";
        if (!inFence) {
            inFence = true; fenceToken = token;
        } else if (fenceToken === token) {
            inFence = false; fenceToken = null;
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

// ---------------------------------------------------------------------------
// Math ($…$ inline, $$…$$ display) — B-167
// ---------------------------------------------------------------------------

const MATH_FENCE_RE = /^\s*(```|~~~)/;
const WHITESPACE_RE = /\s/;
const DIGIT_RE = /[0-9]/;

/** Pandoc/Obsidian closing-`$` rule: preceded by non-space, not followed by a digit
 *  (and not part of a `$$`). */
function isInlineCloser(line: string, j: number): boolean {
    const prev = line[j - 1];
    const next = line[j + 1];
    if (prev === undefined || WHITESPACE_RE.test(prev)) return false;
    if (next === "$") return false;
    return next === undefined || !DIGIT_RE.test(next);
}

/** Index of the closing `$` for an inline opener at `from`, or -1. Skips `\x` escapes
 *  and inline-code spans (same rule as the main scan: an unclosed run is literal). */
function findInlineCloser(line: string, from: number): number {
    for (let j = from + 1; j < line.length; j++) {
        const c = line[j];
        if (c === "\\") { j++; continue; }
        if (c === "`") {
            let n = 1;
            while (line[j + n] === "`") n++;
            const close = line.indexOf("`".repeat(n), j + n);
            j = close === -1 ? j + n - 1 : close + n - 1; // loop's j++ lands after the run
            continue;
        }
        if (c !== "$") continue;
        if (line[j + 1] === "$") { j++; continue; }
        if (isInlineCloser(line, j)) return j;
    }
    return -1;
}

/**
 * Scans `line[0, endCh)` for math state. `inDisplay` carries a `$$` block
 * opened on an earlier line. Honors `\$` escapes and skips inline-code spans
 * (outside display math). Inline math never carries across lines.
 */
function scanMathLine(
    line: string,
    endCh: number,
    inDisplay: boolean
): { inDisplay: boolean; inInline: boolean } {
    const end = Math.min(endCh, line.length);
    let i = 0;
    // Once one opener finds no closer, no later `$` can close either (closer
    // validity is positional), so skip the rescans: keeps the scan O(n).
    // Known exception: a lone backtick inside a same-line `$$…$$` span can
    // misalign the sub-scan and report math where there is none (fail-safe:
    // a trigger just doesn't expand). Fix if needed: treat `$$…$$` as opaque
    // in findInlineCloser.
    let noCloserLeft = false;
    while (i < end) {
        const c = line[i];
        if (c === "\\") { i += 2; continue; }
        if (inDisplay) {
            if (c === "$" && line[i + 1] === "$") { inDisplay = false; i += 2; continue; }
            i++;
            continue;
        }
        if (c === "`") {
            let n = 1;
            while (line[i + n] === "`") n++;
            const close = line.indexOf("`".repeat(n), i + n);
            i = close === -1 ? i + n : close + n; // unclosed run = literal backticks
            continue;
        }
        if (c !== "$") { i++; continue; }
        if (line[i + 1] === "$") { inDisplay = true; i += 2; continue; }

        const next = line[i + 1];
        if (next === undefined || WHITESPACE_RE.test(next)) { i++; continue; } // opener needs non-space after
        const closer = noCloserLeft ? -1 : findInlineCloser(line, i);
        if (closer === -1) {
            noCloserLeft = true;
            // Still being typed: treat as math unless it looks like a price (`$5`).
            if (DIGIT_RE.test(next)) { i++; continue; }
            return { inDisplay, inInline: true };
        }
        if (end <= closer) return { inDisplay, inInline: true }; // cursor sits inside $…$
        i = closer + 1;
    }
    return { inDisplay, inInline: false };
}

/**
 * True when the cursor (`curLine`, `curCh`) sits inside inline math (`$…$`)
 * or display math (`$$…$$`, single- or multi-line). One top-down pass, like
 * `isInFencedCode`: fenced code and YAML frontmatter lines are skipped, and
 * lines without `$` cost one `indexOf`. A lone `$` before a digit (`costs $5
 * and $10`) is a price, not math. An opener with no closer yet counts as math
 * while it is being typed (the closer may not exist yet).
 */
export function isInMath(
    getLine: (i: number) => string,
    lastLine: number,
    curLine: number,
    curCh: number
): boolean {
    let inFence = false;
    let fenceToken: "`" | "~" | null = null;
    let inDisplay = false;
    let inFront = (getLine(0) ?? "").trim() === "---" && curLine > 0;

    for (let i = 0; i <= Math.min(curLine, lastLine); i++) {
        const t = getLine(i) ?? "";
        if (inFront) {
            if (i > 0 && t.trim() === "---") inFront = false;
            continue;
        }
        const m = t.match(MATH_FENCE_RE);
        if (m) {
            const token = m[1] === "```" ? "`" : "~";
            if (!inFence) { inFence = true; fenceToken = token; }
            else if (fenceToken === token) { inFence = false; fenceToken = null; }
            continue;
        }
        if (inFence) continue;
        if (i < curLine) {
            if (t.includes("$")) inDisplay = scanMathLine(t, t.length, inDisplay).inDisplay;
            continue;
        }
        const r = scanMathLine(t, curCh, inDisplay);
        return r.inDisplay || r.inInline;
    }
    return false;
}
