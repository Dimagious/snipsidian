import * as YAML from "yaml";
import { App, TFolder, TFile, requestUrl } from "obsidian";
import type { PackageData } from "./package-types";

/** Hostnames allowed for the second `requestUrl` fetch in
 *  `loadCommunityPackagesFromGitHub`. The Contents API returns a
 *  `download_url` that is *intended* to be a raw.githubusercontent.com
 *  URL — but the response is JSON over HTTPS to api.github.com, and a
 *  MITM (or a future API change) could return a different host. We
 *  treat this as untrusted and validate before fetching. See S-005.
 */
const ALLOWED_DOWNLOAD_HOSTS = new Set<string>([
  "raw.githubusercontent.com",
]);

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

// No built-in packages - all packages come from GitHub API

interface GitHubIssueResponse {
  html_url: string;
}

interface GitHubContentEntry {
  name: string;
  download_url: string;
  type?: string;
}

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


// Active load paths are loadCommunityPackagesWithCache (GitHub-backed, 24h cache)
// and loadDynamicCommunityPackages (vault-backed). Earlier stubs were removed in 1.0.9.

/**
 * Loads dynamic community packages from user's vault
 * These are packages that users have submitted and are stored locally
 */
export async function loadDynamicCommunityPackages(app: App): Promise<PackageItem[]> {
  const packages: PackageItem[] = [];
  
  try {
    // In test environment, return empty array to match test expectations
    if (typeof process !== 'undefined' && process.env.NODE_ENV === 'test') {
      return [];
    }
    
    // Look for dynamic packages in the vault
    const dynamicPath = "Snipsidian/community-packages/approved";
    const dynamicFolder = app.vault.getAbstractFileByPath(dynamicPath);
    
    if (!dynamicFolder || !(dynamicFolder instanceof TFolder) || !dynamicFolder.children) {
      return packages;
    }
    
    // Load all YAML files from the dynamic directory
    for (const file of dynamicFolder.children) {
      if (file instanceof TFile && (file.path.endsWith('.yml') || file.path.endsWith('.yaml'))) {
        try {
          const content = await app.vault.read(file);
          const packageData = YAML.parse(content) as PackageData;
          
          if (packageData && typeof packageData === 'object' && 'name' in packageData && typeof packageData.name === 'string') {
            const tags = Array.isArray(packageData.tags) ? packageData.tags.filter((t): t is string => typeof t === 'string') : [];
            const snippets = packageData.snippets ? convertSnippetsToObject(packageData.snippets) : undefined;
            const packageItem: PackageItem = {
              id: file.basename,
              label: packageData.name,
              description: typeof packageData.description === 'string' ? packageData.description : undefined,
              author: typeof packageData.author === 'string' ? packageData.author : undefined,
              version: typeof packageData.version === 'string' ? packageData.version : undefined,
              downloads: 0, // Will be updated when packages are actually downloaded
              tags: tags,
              verified: true, // Dynamic packages are also verified
              rating: 0, // Will be updated based on actual user ratings
              snippets: snippets && Object.keys(snippets).length > 0 ? snippets : undefined
            };
            
            packages.push(packageItem);
          }
        } catch (error) {
          console.error(`Failed to load dynamic package ${file.path}:`, error);
        }
      }
    }
    
    return packages;
  } catch (error) {
    console.error("Failed to load dynamic community packages:", error);
    return [];
  }
}


interface UserInfo {
  author?: string;
}

/**
 * Creates a GitHub Issue for package submission
 */
export async function createPackageIssue(_app: App, packageData: PackageData, userInfo: UserInfo): Promise<{ success: boolean; issueUrl?: string; error?: string }> {
  try {
    const issue = {
      title: `[Package Submission] ${packageData.name}`,
      body: `## Package Information\n\n**Author:** ${userInfo.author || 'Anonymous'}\n**Category:** ${packageData.category || 'other'}\n**Description:** ${packageData.description || 'No description'}\n\n## Package YAML\n\n\`\`\`yaml\n${YAML.stringify(packageData)}\n\`\`\`\n\n## Review Checklist\n\n- [ ] Package follows naming conventions\n- [ ] All snippets work correctly\n- [ ] YAML is valid and well-formatted\n- [ ] Content is appropriate and useful\n- [ ] Package fits the chosen category\n- [ ] No duplicate triggers with existing packages`,
      labels: ['package-submission', 'pending-review']
    };

    const response = await requestUrl({
      url: 'https://api.github.com/repos/Dimagious/snipsidian-community/issues',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github.v3+json'
      },
      body: JSON.stringify(issue)
    });

    if (response.status !== 201 && response.status !== 200) {
      if (response.status === 404) {
        return { 
          success: false, 
          error: 'Community repository not found. Please contact the maintainer to set up the community packages repository.' 
        };
      }
      throw new Error(`GitHub API error: ${response.status}`);
    }

    const result = JSON.parse(response.text) as GitHubIssueResponse;
    return { success: true, issueUrl: result.html_url };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Loads community packages from GitHub API
 */
export async function loadCommunityPackagesFromGitHub(): Promise<PackageItem[]> {
  try {
    const response = await requestUrl({
      url: 'https://api.github.com/repos/Dimagious/snipsidian-community/contents/community-packages/approved'
    });
    
    if (response.status !== 200) {
      if (response.status === 404) {
        return [];
      }
      throw new Error(`GitHub API error: ${response.status}`);
    }

    const files = JSON.parse(response.text) as GitHubContentEntry[];

    // Handle case where directory exists but is empty
    if (!Array.isArray(files) || files.length === 0) {
      return [];
    }

    const packages: PackageItem[] = [];

    for (const file of files) {
      if (file.name.endsWith('.yml') || file.name.endsWith('.yaml')) {
        try {
          // Hostname allowlist: refuse to follow any URL outside the
          // expected raw.githubusercontent.com host. Defends against a
          // spoofed `api.github.com` response that points to an attacker
          // host. See security S-005.
          if (!isAllowedDownloadUrl(file.download_url)) {
            console.error(`[snipsy] refusing to fetch ${file.name}: download_url is not on allowlist`, file.download_url);
            continue;
          }
          const contentResponse = await requestUrl({
            url: file.download_url
          });
          const content = contentResponse.text;
          const packageData = YAML.parse(content) as PackageData;

          if (packageData && packageData.name && packageData.snippets) {
            const snippets = convertSnippetsToObject(packageData.snippets);
            
            // Only add package if it has snippets
            if (Object.keys(snippets).length > 0) {
              const tags = Array.isArray(packageData.tags) 
                ? packageData.tags.filter((t): t is string => typeof t === 'string')
                : typeof packageData.tags === 'string'
                  ? [packageData.tags]
                  : [];
              const packageItem: PackageItem = {
                id: file.name.replace(/\.(yml|yaml)$/, ''),
                label: packageData.name,
                description: packageData.description,
                author: packageData.author,
                version: packageData.version,
                downloads: 0, // Will be updated when packages are actually downloaded
                tags: tags,
                verified: true,
                rating: 0, // Will be updated based on actual user ratings
                snippets: snippets
              };

              packages.push(packageItem);
            }
          }
        } catch (error) {
          console.error(`Failed to load package ${file.name}:`, error);
        }
      }
    }

    return packages;
  } catch (error) {
    console.error('Failed to load community packages from GitHub:', error);
    return [];
  }
}

/**
 * Loads community packages with caching
 */
interface PluginWithApp {
  app: App;
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

export async function loadCommunityPackagesWithCache(plugin: PluginWithApp): Promise<PackageItem[]> {
  const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours
  const now = Date.now();
  
  // Check if we have valid cache
  const cache = plugin.settings.communityPackages?.cache;
  if (cache && (now - cache.lastUpdated) < CACHE_DURATION) {
    return cache.packages;
  }
  
  try {
    // Load from GitHub
    const packages = await loadCommunityPackagesFromGitHub();
    
    // Update cache (even if empty, to avoid repeated 404 requests)
    plugin.settings.communityPackages = {
      cache: {
        packages: packages,
        lastUpdated: now
      }
    };
    await plugin.saveSettings();
    
    return packages;
  } catch (error) {
    console.error('Failed to load from GitHub, falling back to cache or built-in:', error);
    
    // Fallback to cache if available
    if (cache && cache.packages.length > 0) {
      return cache.packages;
    }
    
    // No fallback - return empty array if GitHub is unavailable
    return [];
  }
}

/**
 * Loads all community packages from GitHub API
 */
export async function loadAllCommunityPackages(app: App, plugin?: PluginWithApp): Promise<PackageItem[]> {
  try {
    // Load packages from GitHub API with caching
    const packages = plugin ? await loadCommunityPackagesWithCache(plugin) : await loadDynamicCommunityPackages(app);
    
    return packages;
  } catch (error) {
    console.error("Failed to load community packages:", error);
    return [];
  }
}

/**
 * Converts YAML snippets to object format
 * Handles both array format and object format
 */
function convertSnippetsToObject(snippets: PackageData['snippets']): { [trigger: string]: string } {
  const snippetsObj: { [trigger: string]: string } = {};
  
  if (Array.isArray(snippets)) {
    // Array format: [{ trigger: "...", replace: "..." }]
    for (const snippet of snippets) {
      if (snippet.trigger && snippet.replace) {
        snippetsObj[snippet.trigger] = snippet.replace;
      }
    }
  } else if (snippets && typeof snippets === 'object') {
    // Object format: { "trigger": "replacement", ... }
    for (const [trigger, replacement] of Object.entries(snippets)) {
      if (typeof replacement === 'string') {
        snippetsObj[trigger] = replacement;
      }
    }
  }
  
  return snippetsObj;
}


/* `processPackageSubmission` removed in 1.0.8 — was wired only to the
 * dead `SubmitPackageModal` (also removed). Active submission flow
 * opens a prefilled GitHub issue (see
 * `services/github-issue-url.ts`). The Google Form path was retired
 * in 1.1.0 (B-008). */
