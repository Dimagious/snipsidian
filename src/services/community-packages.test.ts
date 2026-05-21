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
    it("should return empty array when GitHub API is unavailable", async () => {
      const mockApp = {
        vault: {
          getAbstractFileByPath: vi.fn(),
          read: vi.fn()
        }
      };
      
      const packages = await loadAllCommunityPackages(mockApp);
      expect(packages).toEqual([]);
    });

    it("should handle errors gracefully", async () => {
      const mockApp = {
        vault: {
          getAbstractFileByPath: vi.fn().mockImplementation(() => {
            throw new Error("Vault error");
          }),
          read: vi.fn()
        }
      };
      
      const packages = await loadAllCommunityPackages(mockApp);
      expect(packages).toEqual([]);
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

      const mockApp = { vault: {} } as any;

      vi.mocked(requestUrl)
        .mockResolvedValueOnce({
          status: 200,
          text: JSON.stringify(mockFiles)
        })
        .mockResolvedValueOnce({
          status: 200,
          text: mockYamlContent
        });

      const packages = await loadCommunityPackagesFromGitHub(mockApp);

      expect(packages).toHaveLength(1);
      expect(packages[0].label).toBe("Basic Emojis");
      // B-117: leading `:` is stripped on convert so `:smile` becomes
      // `smile` — the form Snipsy's engine can actually match. Old
      // assertion checked for `:smile` which would be unreachable.
      expect(packages[0].snippets).toHaveProperty("smile", "😄");
      expect(packages[0].snippets).not.toHaveProperty(":smile");
    });

    it("should handle GitHub API errors gracefully", async () => {
      const mockApp = { vault: {} } as any;

      vi.mocked(requestUrl).mockResolvedValue({
        status: 404,
        text: ""
      });

      const packages = await loadCommunityPackagesFromGitHub(mockApp);

      expect(packages).toEqual([]);
    });

    it("should handle network errors gracefully", async () => {
      // Mock console.error to avoid noise in tests
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      
      const mockApp = { vault: {} } as any;

      vi.mocked(requestUrl).mockRejectedValue(new Error("Network error"));

      const packages = await loadCommunityPackagesFromGitHub(mockApp);

      expect(packages).toEqual([]);
      
      consoleSpy.mockRestore();
    });

    it("should handle invalid YAML content gracefully", async () => {
      const mockFiles = [
        {
          name: "invalid.yml",
          download_url: "https://raw.githubusercontent.com/Dimagious/snipsidian-community/main/approved/invalid.yml"
        }
      ];

      const mockApp = { vault: {} } as any;

      vi.mocked(requestUrl)
        .mockResolvedValueOnce({
          status: 200,
          text: JSON.stringify(mockFiles)
        })
        .mockResolvedValueOnce({
          status: 200,
          text: "invalid: yaml: content: ["
        });

      const packages = await loadCommunityPackagesFromGitHub(mockApp);

      expect(packages).toEqual([]);
    });

    it("should handle packages with no snippets", async () => {
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
description: "Package with no snippets"
snippets: []
`;

      const mockApp = { vault: {} } as any;

      vi.mocked(requestUrl)
        .mockResolvedValueOnce({
          status: 200,
          text: JSON.stringify(mockFiles)
        })
        .mockResolvedValueOnce({
          status: 200,
          text: mockYamlContent
        });

      const packages = await loadCommunityPackagesFromGitHub(mockApp);

      expect(packages).toEqual([]);
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

      const mockApp = { vault: {} } as any;

      // First call returns the directory listing with a hostile download_url.
      // If the allowlist works, NO second `requestUrl` should fire — so we
      // intentionally don't mock a second response.
      vi.mocked(requestUrl).mockResolvedValueOnce({
        status: 200,
        text: JSON.stringify(mockFiles),
      });

      const packages = await loadCommunityPackagesFromGitHub(mockApp);

      expect(packages).toEqual([]);
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

      const mockApp = { vault: {} } as any;
      vi.mocked(requestUrl).mockResolvedValueOnce({
        status: 200,
        text: JSON.stringify(mockFiles),
      });

      const packages = await loadCommunityPackagesFromGitHub(mockApp);
      expect(packages).toEqual([]);
      expect(vi.mocked(requestUrl)).toHaveBeenCalledTimes(1);
      consoleSpy.mockRestore();
    });
  });

  // `createPackageIssue` tests removed in 1.1.7 with the function
  // itself. Active submission flow opens a prefilled GitHub issue
  // via `services/github-issue-url.ts`; the direct-API path had no
  // production callers.

  describe("loadCommunityPackagesWithCache", () => {
    it("should load packages from cache when cache is valid", async () => {
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

      const packages = await loadCommunityPackagesWithCache(mockPlugin);

      expect(packages).toHaveLength(1);
      expect(packages[0].label).toBe("Cached Package");
      expect(requestUrl).not.toHaveBeenCalled();
    });

    it("should fetch from GitHub when cache is expired", async () => {
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
      });

      const packages = await loadCommunityPackagesWithCache(mockPlugin);

      expect(packages).toEqual([]);
      expect(requestUrl).toHaveBeenCalled();
      expect(mockPlugin.saveSettings).toHaveBeenCalled();
    });

    it("should fetch from GitHub when no cache exists", async () => {
      const mockPlugin = {
        app: { vault: {} },
        settings: {},
        saveSettings: vi.fn()
      };

      vi.mocked(requestUrl).mockResolvedValue({
        status: 200,
        text: JSON.stringify([])
      });

      const packages = await loadCommunityPackagesWithCache(mockPlugin);

      expect(packages).toEqual([]);
      expect(requestUrl).toHaveBeenCalled();
      expect(mockPlugin.saveSettings).toHaveBeenCalled();
    });

    it("should handle GitHub API errors gracefully", async () => {
      const mockPlugin = {
        app: { vault: {} },
        settings: {},
        saveSettings: vi.fn()
      };

      vi.mocked(requestUrl).mockResolvedValue({
        status: 404,
        text: ""
      });

      const packages = await loadCommunityPackagesWithCache(mockPlugin);

      expect(packages).toEqual([]);
      expect(mockPlugin.saveSettings).toHaveBeenCalled();
    });
  });

});