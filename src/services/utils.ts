export type DiffResult = {
    added: Array<{ key: string; value: string }>;
    conflicts: Array<{ key: string; incoming: string; current: string }>;
};

export function diffIncoming(
    incoming: Record<string, string>,
    current: Record<string, string>
): DiffResult {
    const added: DiffResult["added"] = [];
    const conflicts: DiffResult["conflicts"] = [];
    for (const [k, v] of Object.entries(incoming)) {
        if (current[k] === undefined) added.push({ key: k, value: v });
        else conflicts.push({ key: k, incoming: v, current: current[k] });
    }
    return { added, conflicts };
}

export function isRecordOfString(x: unknown): x is Record<string, string> {
    if (!x || typeof x !== "object") return false;
    for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
        if (typeof k !== "string" || typeof v !== "string") return false;
    }
    return true;
}

export function normalizeTrigger(raw: string): string {
    return raw.trim();
}

export function isBadTrigger(key: string): boolean {
    // Allow colons at the beginning (like :plot, :scene) but not in the middle
    // Allow underscores and hyphens
    if (key.length === 0) return true;
    
    // Check for forbidden characters (but allow colon at the beginning)
    // eslint-disable-next-line no-useless-escape -- \[ and \] are REQUIRED inside [] to match literal brackets
    if (/[\s.,!?;()\[\]{}"'/\\-]/.test(key)) return true;
    
    // Check for colon in the middle (not at the beginning)
    // This regex matches: start of string, any non-colon chars, colon, any chars, colon
    if (/^[^:]*:.*:/.test(key)) return true;
    
    // Also check for colon not at the beginning (like "a:b")
    if (key.includes(':') && !key.startsWith(':')) return true;
    
    return false;
}

export function splitKey(key: string): { group: string; name: string } {
    const i = key.indexOf("/");
    return i === -1 ? { group: "", name: key } : { group: key.slice(0, i), name: key.slice(i + 1) };
}

export function joinKey(group: string, name: string): string {
    return group ? `${group}/${name}` : name;
}

export function slugifyGroup(label: string): string {
    return (label || "")
        .trim()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase();
}

export function displayGroupTitle(groupKey: string): string {
    const last = groupKey.includes("/") ? groupKey.split("/", 1)[0] ?? groupKey : groupKey;
    return last
        .replace(/[-_]+/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
}
