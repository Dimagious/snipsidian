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
    let cursorDelta: number | undefined;

    // $|
    const markerIndex = text.indexOf(CURSOR);
    if (markerIndex >= 0) {
        text = text.slice(0, markerIndex) + text.slice(markerIndex + CURSOR.length);
        cursorDelta = markerIndex;
    }

    // simple variables
    text = text.replace(/\$date\b/g, () => formatDate(ctx.now));
    text = text.replace(/\$time\b/g, () => formatTime(ctx.now));
    text = text.replace(/\$filename\b/g, () => ctx.filename ?? "");

    if (/\$clipboard\b/.test(text) && ctx.readClipboard) {
        const clip = await ctx.readClipboard().catch(() => "");
        text = text.replace(/\$clipboard\b/g, () => clip ?? "");
    } else {
        text = text.replace(/\$clipboard\b/g, "");
    }

    return { text, cursorDelta };
}
