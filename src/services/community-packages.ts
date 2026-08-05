import {
    loadCommunityPackagesWithCache,
    type PluginCacheHost,
    type CommunityLoadResult,
} from "./community-cache";

// Module split (B-025, 1.1.7):
//   - GitHub I/O                  → community-api.ts
//   - 24h cache wrapper           → community-cache.ts
// This file is now the facade: PackageItem type + the router
// `loadAllCommunityPackages`.
//
// B-143: the vault-backed `loadDynamicCommunityPackages` loader (and
// the router's fallback branch that called it when `plugin` was
// omitted) were removed here. The only production caller
// (`PackageBrowser.ts`) always passed `plugin`, so that path was
// unreachable outside tests — it also carried the repo's only
// `process.env.NODE_ENV === 'test'` sniff. If vault-backed dynamic
// packages come back as a real feature, reintroduce it deliberately
// rather than resurrecting this dead branch.

export interface PackageItem {
    id?: string;
    label: string;
    description?: string;
    author?: string;
    version?: string;
    downloads?: number;
    tags?: string[];
    verified?: boolean;
    category?: string;
    rating?: number;
    status?: string;
    lastUpdated?: string;
    snippets?: { [trigger: string]: string };
}


// The active load path is loadCommunityPackagesWithCache
// (GitHub-backed, 24h cache). Earlier stubs were removed in 1.0.9; the
// vault-backed dynamic loader was removed in 1.3.1 (B-143, see note
// above).

// `createPackageIssue` removed in 1.1.7 — was the legacy direct-API
// submission flow, replaced by `services/github-issue-url.ts`
// (opens a prefilled GitHub issue in the browser via `window.open`).
// The legacy function had no production callers, only its own tests.

// `loadCommunityPackagesWithCache` + `PluginCacheHost` moved to
// `community-cache.ts` in 1.1.7 (B-025). Re-exported here so
// existing callers (PackageBrowser.ts, types.ts) don't see the move.
export { loadCommunityPackagesWithCache, type PluginCacheHost, type CommunityLoadResult };

/**
 * Router for the Packages-tab data load — the single entry point UI
 * components should call. `plugin` is required (B-143: the pre-1.3.1
 * vault-backed fallback for an omitted `plugin` was unreachable in
 * production, since the only caller always passed one).
 *
 * Returns a `CommunityLoadResult` so the UI can differentiate
 * "live-fresh / cache-hit / fallback-after-failure" — the
 * Notice text in `PackageBrowser.refresh` keys off `source`. The
 * try/catch is a last-resort safety net around `saveSettings()` (the
 * cache layer's own GitHub-fetch errors already resolve to a
 * `fallback` result rather than throwing).
 */
export async function loadAllCommunityPackages(
    plugin: PluginCacheHost,
): Promise<CommunityLoadResult> {
    try {
        return await loadCommunityPackagesWithCache(plugin);
    } catch (error) {
        console.error("Failed to load community packages:", error);
        return { packages: [], source: "fallback", error: "network" };
    }
}

/* `processPackageSubmission` removed in 1.0.8 — was wired only to the
 * dead `SubmitPackageModal` (also removed). Active submission flow
 * opens a prefilled GitHub issue (see
 * `services/github-issue-url.ts`). The Google Form path was retired
 * in 1.1.0 (B-008). */
