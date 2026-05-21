/**
 * Snippet-key helpers.
 *
 * Settings store snippets under composite keys of the shape
 * `<group>/<trigger>` (or just `<trigger>` when ungrouped). The
 * helpers here are the only place that knows about the `/` separator
 * — keep call sites away from string-indexing into keys directly.
 *
 * Moved from `services/utils.ts` in 1.1.6 (B-026) to land in the
 * right architectural layer: keys are a `store/` concern, not a
 * cross-cutting service helper.
 */

export function splitKey(key: string): { group: string; name: string } {
    const i = key.indexOf("/");
    return i === -1 ? { group: "", name: key } : { group: key.slice(0, i), name: key.slice(i + 1) };
}

export function joinKey(group: string, name: string): string {
    return group ? `${group}/${name}` : name;
}

/**
 * Reduce a free-form group label to a URL- and key-safe slug.
 *
 * Non-alphanumerics (incl. non-Latin letters such as Cyrillic) collapse to
 * dashes. The result is what gets stored as the group prefix in the
 * snippet key; the original display name is reconstructed via
 * `displayGroupTitle` (lossy round-trip — see B-051 in backlog).
 */
export function slugifyGroup(label: string): string {
    return (label || "")
        .trim()
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-zA-Z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase();
}

/**
 * Display-format the first path segment of a snippet key as a
 * human-readable title. `my-group_name` → `My Group Name`.
 *
 * Only the first segment is used — nested groups are not a real
 * concept in Snipsy's schema, this just guards against keys like
 * `foo/bar` being passed in by mistake.
 */
export function displayGroupTitle(groupKey: string): string {
    const last = groupKey.includes("/") ? groupKey.split("/", 1)[0] ?? groupKey : groupKey;
    return last
        .replace(/[-_]+/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
}
