export async function readClipboardSafe(): Promise<string> {
    try {
        if (typeof navigator !== "undefined" && navigator.clipboard?.readText) {
            return await navigator.clipboard.readText();
        }
    } catch { /* noop */ }
    return "";
}