import * as YAML from "yaml";
import { requestUrl } from "obsidian";
import type { PackageData } from "./package-types";
import { normalizeTrigger } from "../engine/triggers";
import type { PackageItem } from "./community-packages";

/**
 * GitHub I/O for the community-package catalog.
 *
 * Talks to the GitHub Contents API at
 * `repos/Dimagious/snipsidian-community/contents/community-packages/approved`,
 * fetches every `.yml` / `.yaml` file in there, parses each into a
 * `PackageItem`. No caching, no fallback — pure network → result.
 *
 * Extracted from `services/community-packages.ts` in 1.1.7 (B-025).
 * The 24h cache wrapper lives in `community-cache.ts`; this file is
 * what the cache calls when its TTL expires.
 */

/** GitHub Contents API endpoint for the approved-packages directory. */
const CONTENTS_API_URL =
    "https://api.github.com/repos/Dimagious/snipsidian-community/contents/community-packages/approved";

/**
 * Hostnames allowed for the second `requestUrl` fetch in
 * `loadCommunityPackagesFromGitHub`. The Contents API returns a
 * `download_url` that is *intended* to be a raw.githubusercontent.com
 * URL — but the response is JSON over HTTPS to api.github.com, and a
 * MITM (or a future API change) could return a different host. We
 * treat this as untrusted and validate before fetching. See S-005.
 */
const ALLOWED_DOWNLOAD_HOSTS = new Set<string>(["raw.githubusercontent.com"]);

function isAllowedDownloadUrl(url: unknown): boolean {
    if (typeof url !== "string") return false;
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== "https:") return false;
        return ALLOWED_DOWNLOAD_HOSTS.has(parsed.hostname);
    } catch {
        return false;
    }
}

interface GitHubContentEntry {
    name: string;
    download_url: string;
    type?: string;
}

/**
 * Fetch and parse every community pack on the GitHub catalog.
 *
 * Returns an empty array on:
 *   - 404 (directory missing)
 *   - empty directory
 *   - network failure (logs and swallows)
 *
 * Each individual pack fetch is independent — a single bad pack does
 * not abort the whole load.
 */
export async function loadCommunityPackagesFromGitHub(): Promise<PackageItem[]> {
    try {
        const response = await requestUrl({ url: CONTENTS_API_URL });

        if (response.status !== 200) {
            if (response.status === 404) return [];
            throw new Error(`GitHub API error: ${response.status}`);
        }

        const files = JSON.parse(response.text) as GitHubContentEntry[];

        if (!Array.isArray(files) || files.length === 0) return [];

        const packages: PackageItem[] = [];

        for (const file of files) {
            if (!file.name.endsWith(".yml") && !file.name.endsWith(".yaml")) continue;
            const pkg = await fetchAndParsePack(file);
            if (pkg) packages.push(pkg);
        }

        return packages;
    } catch (error) {
        console.error("Failed to load community packages from GitHub:", error);
        return [];
    }
}

/** Fetch one pack file from its download_url and parse it into a
 *  `PackageItem`. Returns `null` on any failure (validation, network,
 *  bad YAML, empty snippets) — caller filters nulls out. */
async function fetchAndParsePack(
    file: GitHubContentEntry,
): Promise<PackageItem | null> {
    // Hostname allowlist: refuse to follow any URL outside the
    // expected raw.githubusercontent.com host. Defends against a
    // spoofed `api.github.com` response that points to an attacker
    // host. See security S-005.
    if (!isAllowedDownloadUrl(file.download_url)) {
        console.error(
            `[snipsy] refusing to fetch ${file.name}: download_url is not on allowlist`,
            file.download_url,
        );
        return null;
    }

    try {
        const contentResponse = await requestUrl({ url: file.download_url });
        const packageData = YAML.parse(contentResponse.text) as PackageData;

        if (!packageData || !packageData.name || !packageData.snippets) return null;

        const snippets = convertSnippetsToObject(packageData.snippets);
        if (Object.keys(snippets).length === 0) return null;

        const tags = Array.isArray(packageData.tags)
            ? packageData.tags.filter((t): t is string => typeof t === "string")
            : typeof packageData.tags === "string"
              ? [packageData.tags]
              : [];

        return {
            id: file.name.replace(/\.(yml|yaml)$/, ""),
            label: packageData.name,
            description: packageData.description,
            author: packageData.author,
            version: packageData.version,
            downloads: 0,
            tags,
            verified: true,
            rating: 0,
            snippets,
        };
    } catch (error) {
        console.error(`Failed to load package ${file.name}:`, error);
        return null;
    }
}

/**
 * Convert YAML-shape `snippets` (either array of `{trigger, replace}`
 * objects or `{trigger: replacement}` map) to the flat
 * `{trigger: replacement}` shape used by Snipsy's snippet store.
 *
 * Triggers are normalised through `normalizeTrigger` so Espanso-style
 * keys (`:smile:`, `:fire`, etc.) become reachable. Snipsy's engine
 * treats `:` as a separator, so any leading / trailing colons in the
 * stored key would make the trigger unmatchable via keystroke
 * expansion. The Espanso *importer* already does this
 * (`src/packages/espanso.ts`); the install path for community
 * packages historically did not, which is why `basic-emojis.yml`
 * was effectively dead code after install (B-117, closed 1.1.4).
 */
export function convertSnippetsToObject(
    snippets: PackageData["snippets"],
): { [trigger: string]: string } {
    const snippetsObj: { [trigger: string]: string } = {};

    const recordKey = (rawTrigger: string, replacement: string) => {
        const key = normalizeTrigger(rawTrigger);
        if (!key) return; // pure-colon / empty triggers can't be reached anyway
        snippetsObj[key] = replacement;
    };

    if (Array.isArray(snippets)) {
        for (const snippet of snippets) {
            if (snippet.trigger && snippet.replace) {
                recordKey(snippet.trigger, snippet.replace);
            }
        }
    } else if (snippets && typeof snippets === "object") {
        for (const [trigger, replacement] of Object.entries(snippets)) {
            if (typeof replacement === "string") {
                recordKey(trigger, replacement);
            }
        }
    }

    return snippetsObj;
}
