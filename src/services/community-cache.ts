import { loadCommunityPackagesFromGitHub, type CommunityFetchResult } from "./community-api";
import type { PackageItem } from "./community-packages";

/**
 * Community-package cache.
 *
 * Sits between the Packages-tab UI and `community-api`. The
 * Contents API + per-pack `requestUrl` calls take a couple of
 * seconds when cold — too long to spin while a user clicks
 * Settings → Packages. Cache for 24 hours; on miss, fall through
 * to the live load; on live-load failure, keep showing whatever's
 * still in the cache (even if stale) instead of an empty list.
 *
 * Extracted from `services/community-packages.ts` in 1.1.7 (B-025).
 */

/** Cache TTL: 24 hours. The community catalog doesn't change more
 *  than a few times per week, and we want the first open of
 *  Packages-tab to be instant once it's been opened before. */
const CACHE_DURATION_MS = 24 * 60 * 60 * 1000;

/** Plugin contract this cache requires. We only need (a) read/write
 *  access to the cache slot in settings and (b) `saveSettings()` to
 *  persist after a refresh. Intentionally narrower than
 *  `SnipSidianPlugin` so the cache doesn't carry the full surface. */
export interface PluginCacheHost {
    settings: {
        communityPackages?: {
            cache?: {
                packages: PackageItem[];
                lastUpdated: number;
            };
        };
    };
    saveSettings: () => Promise<void>;
}

/**
 * Outcome of a `loadCommunityPackagesWithCache` call.
 *
 * `source` lets the caller (UI) tell the user *why* they're seeing
 * what they're seeing without us having to thread Notices through
 * the cache layer:
 *   - `"cache"`: TTL-valid hit, no network round trip.
 *   - `"live"`: fresh fetch from GitHub.
 *   - `"fallback"`: live fetch failed (rate limit / network / etc.),
 *     we're showing whatever was in the cache (possibly empty).
 *
 * `error` is populated only when `source === "fallback"`. The UI
 * decides whether to surface it (PackageBrowser shows a Notice).
 *
 * Bug fix scope (1.1.7-hotfix): pre-fix, a transient live-load
 * failure persisted an empty `packages` array and reset
 * `lastUpdated` to "now", pinning the empty state for 24h. That
 * was the mobile-iOS symptom we saw on 1.1.6 and would have
 * reshipped in 1.1.7. The cache is now read-only on failure —
 * existing cached entries survive transient errors untouched.
 */
export type CommunityFetchError = Extract<CommunityFetchResult, { ok: false }>["reason"];

export interface CommunityLoadResult {
    packages: PackageItem[];
    source: "cache" | "live" | "fallback";
    error?: CommunityFetchError;
}

/**
 * Return community packages, using the 24-hour cache when valid and
 * the live GitHub load otherwise.
 *
 * Cache semantics:
 *   - **Hit** (TTL not expired): return cached packages, no network.
 *   - **Miss + live OK**: store result (even empty — guards against
 *     repeated 404 / re-listing of a genuinely empty catalog), persist.
 *   - **Live failure (rate-limit / network / non-2xx / parse)**: keep
 *     existing cache untouched (whether empty or populated), surface
 *     the reason to the caller. Pre-1.1.7-hotfix this OVERWROTE the
 *     valid cache with `[]` and pinned blank-Packages-tab for 24h.
 *
 * `not_found` (HTTP 404) is treated as live-success-with-empty since
 * "the directory genuinely does not exist" is a real catalog state,
 * not a transient failure.
 */
export async function loadCommunityPackagesWithCache(
    plugin: PluginCacheHost,
): Promise<CommunityLoadResult> {
    const now = Date.now();
    const cache = plugin.settings.communityPackages?.cache;

    if (cache && now - cache.lastUpdated < CACHE_DURATION_MS) {
        return { packages: cache.packages, source: "cache" };
    }

    const result = await loadCommunityPackagesFromGitHub();

    if (result.ok) {
        plugin.settings.communityPackages = {
            cache: { packages: result.packages, lastUpdated: now },
        };
        await plugin.saveSettings();
        return { packages: result.packages, source: "live" };
    }

    if (result.reason === "not_found") {
        plugin.settings.communityPackages = {
            cache: { packages: [], lastUpdated: now },
        };
        await plugin.saveSettings();
        return { packages: [], source: "live" };
    }

    return {
        packages: cache?.packages ?? [],
        source: "fallback",
        error: result.reason,
    };
}
