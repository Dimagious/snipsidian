import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the package validator
vi.mock("./package-validator", () => ({
  validatePackage: vi.fn().mockReturnValue({
    isValid: true,
    errors: [],
    warnings: []
  })
}));

// Mock requestUrl from obsidian - must be before imports
vi.mock("obsidian", async () => {
  const actual = await vi.importActual("../test/stubs/obsidian");
  return {
    ...actual,
    requestUrl: vi.fn()
  };
});

import {
  loadDynamicCommunityPackages,
  loadAllCommunityPackages,
  loadCommunityPackagesWithCache
} from "./community-packages";
import { loadCommunityPackagesFromGitHub } from "./community-api";

import { requestUrl } from "obsidian";

describe("community-packages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("loadDynamicCommunityPackages", () => {
    it("should return empty array in test environment", async () => {
      const mockApp = {
        vault: {
          getAbstractFileByPath: vi.fn(),
          read: vi.fn()
        }
      };
      
      const packages = await loadDynamicCommunityPackages(mockApp);
      expect(packages).toEqual([]);
    });

    it("should handle missing dynamic directory gracefully", async () => {
      const mockApp = {
        vault: {
          getAbstractFileByPath: vi.fn().mockReturnValue(null),
          read: vi.fn()
        }
      };
      
      // Mock process.env to simulate non-test environment
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      
      const packages = await loadDynamicCommunityPackages(mockApp);
      expect(packages).toEqual([]);
      
      // Restore original environment
      process.env.NODE_ENV = originalEnv;
    });
  });

  describe("loadAllCommunityPackages", () => {
    it("returns an empty `live` result when no vault packages exist", async () => {
      const mockApp = {
        vault: {
          getAbstractFileByPath: vi.fn(),
          read: vi.fn()
        }
      };

      const result = await loadAllCommunityPackages(mockApp);
      expect(result.packages).toEqual([]);
      expect(result.source).toBe("live");
    });

    it("returns empty live result when the vault loader's internal try/catch swallows", async () => {
      // `loadDynamicCommunityPackages` has its own try/catch that
      // logs and returns `[]` — the outer `loadAllCommunityPackages`
      // never sees the throw. Document this contract so a future
      // refactor that removes the inner catch doesn't silently
      // change the source label.
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const mockApp = {
        vault: {
          getAbstractFileByPath: vi.fn().mockImplementation(() => {
            throw new Error("Vault error");
          }),
          read: vi.fn()
        }
      };

      const result = await loadAllCommunityPackages(mockApp);
      expect(result.packages).toEqual([]);
      expect(result.source).toBe("live");
      consoleSpy.mockRestore();
    });
  });

  describe("loadCommunityPackagesFromGitHub", () => {
    it("should load packages from GitHub API successfully", async () => {
      const mockFiles = [
        {
          name: "basic-emojis.yml",
          download_url: "https://raw.githubusercontent.com/Dimagious/snipsidian-community/main/approved/basic-emojis.yml"
        }
      ];

      const mockYamlContent = `
name: "Basic Emojis"
version: "1.0.0"
author: "snipsidian-community"
description: "Basic emoji shortcuts"
snippets:
  - trigger: ":smile"
    replace: "😄"
  - trigger: ":heart"
    replace: "❤️"
`;

      vi.mocked(requestUrl)
        .mockResolvedValueOnce({
          status: 200,
          text: JSON.stringify(mockFiles)
        } as any)
        .mockResolvedValueOnce({
          status: 200,
          text: mockYamlContent
        } as any);

      const result = await loadCommunityPackagesFromGitHub();

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.packages).toHaveLength(1);
      expect(result.packages[0].label).toBe("Basic Emojis");
      // B-117: leading `:` is stripped on convert so `:smile` becomes
      // `smile` — the form Snipsy's engine can actually match.
      expect(result.packages[0].snippets).toHaveProperty("smile", "😄");
      expect(result.packages[0].snippets).not.toHaveProperty(":smile");
    });

    it("returns not_found on HTTP 404 (genuine empty-catalog)", async () => {
      vi.mocked(requestUrl).mockResolvedValue({ status: 404, text: "" } as any);

      const result = await loadCommunityPackagesFromGitHub();

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.reason).toBe("not_found");
      expect(result.status).toBe(404);
    });

    it("returns rate_limited on HTTP 403 (the iOS-mobile foot-gun)", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.mocked(requestUrl).mockResolvedValue({ status: 403, text: "" } as any);

      const result = await loadCommunityPackagesFromGitHub();

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.reason).toBe("rate_limited");
      expect(result.status).toBe(403);
      consoleSpy.mockRestore();
    });

    it("returns rate_limited on HTTP 429 too", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.mocked(requestUrl).mockResolvedValue({ status: 429, text: "" } as any);

      const result = await loadCommunityPackagesFromGitHub();

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.reason).toBe("rate_limited");
      consoleSpy.mockRestore();
    });

    it("returns http for non-2xx that isn't 403/404/429", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.mocked(requestUrl).mockResolvedValue({ status: 500, text: "" } as any);

      const result = await loadCommunityPackagesFromGitHub();

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.reason).toBe("http");
      expect(result.status).toBe(500);
      consoleSpy.mockRestore();
    });

    it("returns network when requestUrl throws", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.mocked(requestUrl).mockRejectedValue(new Error("Network error"));

      const result = await loadCommunityPackagesFromGitHub();

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.reason).toBe("network");
      consoleSpy.mockRestore();
    });

    it("returns parse when listing JSON is malformed", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.mocked(requestUrl).mockResolvedValue({ status: 200, text: "{not json" } as any);

      const result = await loadCommunityPackagesFromGitHub();

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.reason).toBe("parse");
      consoleSpy.mockRestore();
    });

    it("treats individual pack YAML parse errors as ok:true with the bad pack skipped", async () => {
      const mockFiles = [
        {
          name: "invalid.yml",
          download_url: "https://raw.githubusercontent.com/Dimagious/snipsidian-community/main/approved/invalid.yml"
        }
      ];

      vi.mocked(requestUrl)
        .mockResolvedValueOnce({
          status: 200,
          text: JSON.stringify(mockFiles)
        } as any)
        .mockResolvedValueOnce({
          status: 200,
          text: "invalid: yaml: content: ["
        } as any);

      const result = await loadCommunityPackagesFromGitHub();

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.packages).toEqual([]);
    });

    it("treats a pack with empty snippets as ok:true with the pack skipped", async () => {
      const mockFiles = [
        {
          name: "empty.yml",
          download_url: "https://raw.githubusercontent.com/Dimagious/snipsidian-community/main/approved/empty.yml"
        }
      ];

      const mockYamlContent = `
name: "Empty Package"
version: "1.0.0"
author: "test"
snippets: []
`;

      vi.mocked(requestUrl)
        .mockResolvedValueOnce({
          status: 200,
          text: JSON.stringify(mockFiles)
        } as any)
        .mockResolvedValueOnce({
          status: 200,
          text: mockYamlContent
        } as any);

      const result = await loadCommunityPackagesFromGitHub();

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.packages).toEqual([]);
    });

    // Regression: security S-005 / B-036 — `download_url` from the GitHub
    // Contents API is treated as untrusted. A spoofed or future-changed API
    // response that returns an off-host URL must NOT be followed.
    it("refuses to follow download_url outside raw.githubusercontent.com (S-005)", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const mockFiles = [
        {
          name: "attacker.yml",
          download_url: "https://attacker.example/payload.yml",
        },
      ];

      // First call returns the directory listing with a hostile download_url.
      // If the allowlist works, NO second `requestUrl` should fire — so we
      // intentionally don't mock a second response.
      vi.mocked(requestUrl).mockResolvedValueOnce({
        status: 200,
        text: JSON.stringify(mockFiles),
      } as any);

      const result = await loadCommunityPackagesFromGitHub();

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.packages).toEqual([]);
      expect(vi.mocked(requestUrl)).toHaveBeenCalledTimes(1); // only the listing call
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringMatching(/refusing to fetch/),
        expect.anything(),
      );

      consoleSpy.mockRestore();
    });

    it("refuses to follow http:// download_url (must be https)", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const mockFiles = [
        {
          name: "downgrade.yml",
          download_url: "http://raw.githubusercontent.com/X/Y/main/approved/x.yml",
        },
      ];

      vi.mocked(requestUrl).mockResolvedValueOnce({
        status: 200,
        text: JSON.stringify(mockFiles),
      } as any);

      const result = await loadCommunityPackagesFromGitHub();
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.packages).toEqual([]);
      expect(vi.mocked(requestUrl)).toHaveBeenCalledTimes(1);
      consoleSpy.mockRestore();
    });

    // Regression: security S-011 — the listing JSON is cast to
    // GitHubContentEntry[] on trust. A malformed/spoofed entry (missing
    // `name`, or non-string `name`) used to make `f.name.endsWith(...)`
    // throw a TypeError OUTSIDE the parse try/catch, rejecting the whole
    // load. The entry-shape guard must skip bad entries and still return
    // the valid ones.
    it("[S-011] skips malformed listing entries without throwing", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const mockFiles = [
        { type: "dir" }, // no name / no download_url
        { name: 42, download_url: "https://raw.githubusercontent.com/x/y/z.yml" }, // non-string name
        { name: "ok.yml", download_url: "https://raw.githubusercontent.com/Dimagious/snipsidian-community/main/approved/ok.yml" },
      ];

      vi.mocked(requestUrl)
        .mockResolvedValueOnce({ status: 200, text: JSON.stringify(mockFiles) } as any)
        .mockResolvedValueOnce({
          status: 200,
          text: "name: OK\nsnippets:\n  - trigger: brb\n    replace: be right back\n",
        } as any);

      // Must resolve (not reject) and return the one valid package.
      const result = await loadCommunityPackagesFromGitHub();
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.packages).toHaveLength(1);
      expect(result.packages[0]?.label).toBe("OK");
      // Only the listing + the single valid file → 2 calls, malformed entries skipped.
      expect(vi.mocked(requestUrl)).toHaveBeenCalledTimes(2);
      consoleSpy.mockRestore();
    });
  });

  // `createPackageIssue` tests removed in 1.1.7 with the function
  // itself. Active submission flow opens a prefilled GitHub issue
  // via `services/github-issue-url.ts`; the direct-API path had no
  // production callers.

  describe("loadCommunityPackagesWithCache", () => {
    it("returns a `cache` hit when TTL has not expired", async () => {
      const mockPlugin = {
        settings: {
          communityPackages: {
            cache: {
              packages: [
                {
                  label: "Cached Package",
                  author: "test",
                  version: "1.0.0",
                  snippets: { ":test": "test" }
                }
              ],
              lastUpdated: Date.now() - 1000 // 1 second ago
            }
          }
        },
        saveSettings: vi.fn()
      };

      const result = await loadCommunityPackagesWithCache(mockPlugin);

      expect(result.source).toBe("cache");
      expect(result.packages).toHaveLength(1);
      expect(result.packages[0].label).toBe("Cached Package");
      expect(requestUrl).not.toHaveBeenCalled();
    });

    it("fetches live when cache has expired", async () => {
      const mockPlugin = {
        app: { vault: {} },
        settings: {
          communityPackages: {
            cache: {
              packages: [],
              lastUpdated: Date.now() - 25 * 60 * 60 * 1000 // 25 hours ago
            }
          }
        },
        saveSettings: vi.fn()
      };

      vi.mocked(requestUrl).mockResolvedValue({
        status: 200,
        text: JSON.stringify([])
      } as any);

      const result = await loadCommunityPackagesWithCache(mockPlugin);

      expect(result.packages).toEqual([]);
      expect(result.source).toBe("live");
      expect(requestUrl).toHaveBeenCalled();
      expect(mockPlugin.saveSettings).toHaveBeenCalled();
    });

    it("fetches live when no cache exists at all", async () => {
      const mockPlugin = {
        app: { vault: {} },
        settings: {},
        saveSettings: vi.fn()
      };

      vi.mocked(requestUrl).mockResolvedValue({
        status: 200,
        text: JSON.stringify([])
      } as any);

      const result = await loadCommunityPackagesWithCache(mockPlugin);

      expect(result.packages).toEqual([]);
      expect(result.source).toBe("live");
      expect(requestUrl).toHaveBeenCalled();
      expect(mockPlugin.saveSettings).toHaveBeenCalled();
    });

    it("on HTTP 404 (genuine empty catalog): treats as live-success-empty and persists", async () => {
      const mockPlugin = {
        app: { vault: {} },
        settings: {},
        saveSettings: vi.fn()
      };

      vi.mocked(requestUrl).mockResolvedValue({
        status: 404,
        text: ""
      } as any);

      const result = await loadCommunityPackagesWithCache(mockPlugin);

      expect(result.packages).toEqual([]);
      expect(result.source).toBe("live");
      expect(mockPlugin.saveSettings).toHaveBeenCalled();
    });

    // The bug fix this PR is built around: a transient live-load
    // failure used to overwrite a populated cache with `[]` and reset
    // the timestamp to "now", pinning a blank Packages tab for 24h.
    // Mobile iOS hit this constantly via rate-limit / network errors.
    it("on rate_limit: PRESERVES populated cache (never overwrites with empty)", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const cachedPacks = [
        { label: "Cached A", snippets: { test: "1" } },
        { label: "Cached B", snippets: { test: "2" } },
      ];
      const originalTimestamp = Date.now() - 25 * 60 * 60 * 1000; // expired
      const mockPlugin = {
        app: { vault: {} },
        settings: {
          communityPackages: {
            cache: {
              packages: cachedPacks,
              lastUpdated: originalTimestamp
            }
          }
        },
        saveSettings: vi.fn()
      };

      vi.mocked(requestUrl).mockResolvedValue({ status: 403, text: "" } as any);

      const result = await loadCommunityPackagesWithCache(mockPlugin);

      expect(result.source).toBe("fallback");
      expect(result.error).toBe("rate_limited");
      // Caller sees the cached packages, not the empty live result.
      expect(result.packages).toHaveLength(2);
      // Cache is NOT overwritten: timestamp unchanged, packages unchanged.
      expect(mockPlugin.settings.communityPackages?.cache?.packages).toBe(cachedPacks);
      expect(mockPlugin.settings.communityPackages?.cache?.lastUpdated).toBe(originalTimestamp);
      expect(mockPlugin.saveSettings).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it("on network failure: PRESERVES populated cache", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const cachedPacks = [{ label: "Cached", snippets: { test: "1" } }];
      const originalTimestamp = Date.now() - 25 * 60 * 60 * 1000;
      const mockPlugin = {
        app: { vault: {} },
        settings: {
          communityPackages: {
            cache: {
              packages: cachedPacks,
              lastUpdated: originalTimestamp
            }
          }
        },
        saveSettings: vi.fn()
      };

      vi.mocked(requestUrl).mockRejectedValue(new Error("offline"));

      const result = await loadCommunityPackagesWithCache(mockPlugin);

      expect(result.source).toBe("fallback");
      expect(result.error).toBe("network");
      expect(result.packages).toHaveLength(1);
      expect(mockPlugin.saveSettings).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it("on failure with no existing cache: fallback with empty packages and no save", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const mockPlugin = {
        app: { vault: {} },
        settings: {},
        saveSettings: vi.fn()
      };

      vi.mocked(requestUrl).mockResolvedValue({ status: 500, text: "" } as any);

      const result = await loadCommunityPackagesWithCache(mockPlugin);

      expect(result.source).toBe("fallback");
      expect(result.error).toBe("http");
      expect(result.packages).toEqual([]);
      // No save: pre-fix this WAS saving `{ packages: [], lastUpdated: now }`,
      // which pinned the blank state for 24h. Critical invariant.
      expect(mockPlugin.saveSettings).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

});