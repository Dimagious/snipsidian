import type { AppliedReplacement, ExpandContext } from "./types";

const CURSOR = "$|";

function pad2(n: number) { return n < 10 ? `0${n}` : `${n}`; }

function formatDate(d: Date): string {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function formatTime(d: Date): string {
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export async function applyPlaceholders(
    replacement: string,
    ctx: ExpandContext
): Promise<AppliedReplacement> {
    let text = replacement;

    // Substitute variables FIRST so the `$|` cursor marker is located against
    // the final string. If we resolved `$|` first, any length change in
    // `$date` / `$time` / `$filename` / `$clipboard` to the left of `$|`
    // would silently desync the caret (e.g. `"$date $|"` would place the
    // cursor at index 6 of the *raw* string rather than at the end of the
    // expanded date).
    text = text.replace(/\$date\b/g, () => formatDate(ctx.now));
    text = text.replace(/\$time\b/g, () => formatTime(ctx.now));
    text = text.replace(/\$filename\b/g, () => ctx.filename ?? "");

    if (/\$clipboard\b/.test(text) && ctx.readClipboard) {
        const clip = await ctx.readClipboard().catch(() => "");
        text = text.replace(/\$clipboard\b/g, () => clip ?? "");
    } else {
        text = text.replace(/\$clipboard\b/g, "");
    }

    // Locate `$|` in the substituted text (first occurrence wins, matching
    // pre-existing behaviour). If a substituted variable happens to contain a
    // literal `$|` (unlikely outside contrived clipboard payloads), the marker
    // there will be honoured.
    let cursorDelta: number | undefined;
    const markerIndex = text.indexOf(CURSOR);
    if (markerIndex >= 0) {
        text = text.slice(0, markerIndex) + text.slice(markerIndex + CURSOR.length);
        cursorDelta = markerIndex;
    }

    return { text, cursorDelta };
}
