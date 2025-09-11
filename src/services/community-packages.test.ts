import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  loadCommunityPackages,
  loadDynamicCommunityPackages,
  loadAllCommunityPackages,
  loadCommunityPackagesFromVault,
  processPackageSubmission,
  loadCommunityPackagesFromGitHub,
  createPackageIssue,
  loadCommunityPackagesWithCache
} from "./community-packages";

// Mock the package validator
vi.mock("./package-validator", () => ({
  validatePackage: vi.fn(),
  validatePackageFile: vi.fn()
}));

// Mock fetch API
global.fetch = vi.fn();

describe("community-packages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("loadCommunityPackages", () => {
    it("should return empty array when no packages are available", async () => {
      const packages = await loadCommunityPackages();
      expect(packages).toEqual([]);
    });

    it("should handle errors gracefully", async () => {
      // Mock console.error to avoid noise in tests
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      
      const packages = await loadCommunityPackages();
      expect(packages).toEqual([]);
      
      consoleSpy.mockRestore();
    });

    it("should return empty array in test environment", async () => {
      // This test verifies the test environment check
      const packages = await loadCommunityPackages();
      expect(packages).toEqual([]);
    });
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

  describe("loadCommunityPackagesFromVault", () => {
    it("should return empty array (deprecated function)", async () => {
      const mockApp = {
        vault: {
          getAbstractFileByPath: vi.fn(),
          read: vi.fn()
        }
      };
      
      const packages = await loadCommunityPackagesFromVault(mockApp);
      expect(packages).toEqual([]); // Deprecated function returns empty array
    });
  });

  describe("processPackageSubmission", () => {
    it("should process valid package submission", async () => {
      const { validatePackage, validatePackageFile } = await import("./package-validator");
      
      vi.mocked(validatePackage).mockReturnValue({
        isValid: true,
        errors: [],
        warnings: []
      });
      
      vi.mocked(validatePackageFile).mockReturnValue({
        isValid: true,
        errors: [],
        warnings: []
      });

      const packageData = {
        name: "Test Package",
        version: "1.0.0",
        author: "test-author",
        description: "A test package",
        kind: "community",
        snippets: []
      };

      const result = await processPackageSubmission(packageData, "community-packages/pending/test-package.yml");
      
      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should handle invalid package submission", async () => {
      const { validatePackage, validatePackageFile } = await import("./package-validator");
      
      vi.mocked(validatePackage).mockReturnValue({
        isValid: false,
        errors: ["Invalid package data"],
        warnings: []
      });
      
      vi.mocked(validatePackageFile).mockReturnValue({
        isValid: true,
        errors: [],
        warnings: []
      });

      const packageData = {
        name: "Test Package",
        // Missing required fields
      };

      const result = await processPackageSubmission(packageData, "community-packages/pending/test-package.yml");
      
      expect(result.success).toBe(false);
      expect(result.errors).toContain("Invalid package data");
    });

    it("should handle invalid file path", async () => {
      const { validatePackage, validatePackageFile } = await import("./package-validator");
      
      vi.mocked(validatePackage).mockReturnValue({
        isValid: true,
        errors: [],
        warnings: []
      });
      
      vi.mocked(validatePackageFile).mockReturnValue({
        isValid: false,
        errors: ["Invalid file path"],
        warnings: ["File warning"]
      });

      const packageData = {
        name: "Test Package",
        author: "test-author",
        version: "1.0.0",
        description: "A test package",
        kind: "community",
        snippets: []
      };

      const result = await processPackageSubmission(packageData, "invalid-path.yml");
      
      expect(result.success).toBe(false);
      expect(result.errors).toContain("Invalid file path");
      expect(result.warnings).toContain("File warning");
    });

    it("should handle exceptions during processing", async () => {
      const { validatePackage, validatePackageFile } = await import("./package-validator");
      
      vi.mocked(validatePackage).mockImplementation(() => {
        throw new Error("Validation error");
      });
      
      vi.mocked(validatePackageFile).mockReturnValue({
        isValid: true,
        errors: [],
        warnings: []
      });

      const packageData = {
        name: "Test Package",
        author: "test-author",
        version: "1.0.0",
        description: "A test package",
        kind: "community",
        snippets: []
      };

      const result = await processPackageSubmission(packageData, "community-packages/pending/test-package.yml");
      
      expect(result.success).toBe(false);
      expect(result.errors).toContain("Failed to process package submission: Error: Validation error");
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

      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockFiles
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          text: async () => mockYamlContent
        } as Response);

      const packages = await loadCommunityPackagesFromGitHub();

      expect(packages).toHaveLength(1);
      expect(packages[0].label).toBe("Basic Emojis");
      expect(packages[0].snippets).toHaveProperty(":smile", "😄");
    });

    it("should handle GitHub API errors gracefully", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: async () => []
      } as Response);

      const packages = await loadCommunityPackagesFromGitHub();

      expect(packages).toEqual([]);
    });

    it("should handle network errors gracefully", async () => {
      // Mock console.error to avoid noise in tests
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      
      vi.mocked(fetch).mockRejectedValue(new Error("Network error"));

      const packages = await loadCommunityPackagesFromGitHub();

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

      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockFiles
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          text: async () => "invalid: yaml: content: ["
        } as Response);

      const packages = await loadCommunityPackagesFromGitHub();

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

      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockFiles
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          text: async () => mockYamlContent
        } as Response);

      const packages = await loadCommunityPackagesFromGitHub();

      expect(packages).toEqual([]);
    });
  });

  describe("createPackageIssue", () => {
    it("should create GitHub issue successfully", async () => {
      const mockResponse = {
        html_url: "https://github.com/Dimagious/snipsidian-community/issues/123"
      };

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => mockResponse
      } as Response);

      const packageData = {
        name: "Test Package",
        version: "1.0.0",
        author: "test-author",
        description: "A test package"
      };

      const userInfo = {
        platform: "obsidian",
        version: "1.0.0"
      };

      const result = await createPackageIssue(packageData, userInfo);

      expect(result.success).toBe(true);
      expect(result.issueUrl).toBe("https://github.com/Dimagious/snipsidian-community/issues/123");
    });

    it("should handle GitHub API errors", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 422,
        statusText: "Unprocessable Entity",
        json: async () => ({})
      } as Response);

      const packageData = { name: "Test Package" };
      const userInfo = { platform: "obsidian" };

      const result = await createPackageIssue(packageData, userInfo);

      expect(result.success).toBe(false);
      expect(result.error).toContain("GitHub API error: 422");
    });

    it("should handle network errors", async () => {
      vi.mocked(fetch).mockRejectedValue(new Error("Network error"));

      const packageData = { name: "Test Package" };
      const userInfo = { platform: "obsidian" };

      const result = await createPackageIssue(packageData, userInfo);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Network error");
    });
  });

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
      expect(fetch).not.toHaveBeenCalled();
    });

    it("should fetch from GitHub when cache is expired", async () => {
      const mockPlugin = {
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

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => []
      } as Response);

      const packages = await loadCommunityPackagesWithCache(mockPlugin);

      expect(packages).toEqual([]);
      expect(fetch).toHaveBeenCalled();
      expect(mockPlugin.saveSettings).toHaveBeenCalled();
    });

    it("should fetch from GitHub when no cache exists", async () => {
      const mockPlugin = {
        settings: {},
        saveSettings: vi.fn()
      };

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => []
      } as Response);

      const packages = await loadCommunityPackagesWithCache(mockPlugin);

      expect(packages).toEqual([]);
      expect(fetch).toHaveBeenCalled();
      expect(mockPlugin.saveSettings).toHaveBeenCalled();
    });

    it("should handle GitHub API errors gracefully", async () => {
      const mockPlugin = {
        settings: {},
        saveSettings: vi.fn()
      };

      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found"
      } as Response);

      const packages = await loadCommunityPackagesWithCache(mockPlugin);

      expect(packages).toEqual([]);
      expect(mockPlugin.saveSettings).toHaveBeenCalled();
    });
  });
});