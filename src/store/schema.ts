export function isRecordOfString(x: unknown): x is Record<string, string> {
    if (!x || typeof x !== "object") return false;
    for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
        if (typeof k !== "string" || typeof v !== "string") return false;
    }
    return true;
}
