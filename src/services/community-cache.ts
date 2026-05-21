import { loadCommunityPackagesFromGitHub } from "./community-api";
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
 * Return community packages, using the 24-hour cache when valid and
 * the live GitHub load otherwise.
 *
 * Cache semantics:
 *   - **Hit** (TTL not expired): return cached packages, no network.
 *   - **Miss** (TTL expired or no cache yet): load live, store
 *     result (even empty — prevents repeated 404 fetches), persist.
 *   - **Live-load failure**: log, fall back to whatever's in cache
 *     (even if expired), else empty array.
 */
export async function loadCommunityPackagesWithCache(
    plugin: PluginCacheHost,
): Promise<PackageItem[]> {
    const now = Date.now();
    const cache = plugin.settings.communityPackages?.cache;

    if (cache && now - cache.lastUpdated < CACHE_DURATION_MS) {
        return cache.packages;
    }

    try {
        const packages = await loadCommunityPackagesFromGitHub();

        // Persist even when empty — guards against repeated 404
        // requests if the catalog directory is temporarily gone.
        plugin.settings.communityPackages = {
            cache: {
                packages,
                lastUpdated: now,
            },
        };
        await plugin.saveSettings();

        return packages;
    } catch (error) {
        console.error(
            "Failed to load from GitHub, falling back to cache:",
            error,
        );

        if (cache && cache.packages.length > 0) {
            return cache.packages;
        }

        return [];
    }
}
