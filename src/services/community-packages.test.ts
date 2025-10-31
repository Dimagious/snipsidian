import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the package validator
vi.mock("./package-validator", () => ({
  validatePackage: vi.fn().mockReturnValue({
    isValid: true,
    errors: [],
    warnings: []
  }),
  validatePackageFile: vi.fn()
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
  loadCommunityPackages,
  loadDynamicCommunityPackages,
  loadAllCommunityPackages,
  loadCommunityPackagesFromVault,
  processPackageSubmission,
  loadCommunityPackagesFromGitHub,
  createPackageIssue,
  loadCommunityPackagesWithCache
} from "./community-packages";

import { requestUrl } from "obsidian";

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
      expect(packages[0].snippets).toHaveProperty(":smile", "😄");
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
  });

  describe("createPackageIssue", () => {
    it("should create GitHub issue successfully", async () => {
      const mockResponse = {
        html_url: "https://github.com/Dimagious/snipsidian-community/issues/123"
      };

      const mockApp = { vault: {} } as any;

      vi.mocked(requestUrl).mockResolvedValue({
        status: 201,
        text: JSON.stringify(mockResponse)
      });

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

      const result = await createPackageIssue(mockApp, packageData, userInfo);

      expect(result.success).toBe(true);
      expect(result.issueUrl).toBe("https://github.com/Dimagious/snipsidian-community/issues/123");
    });

    it("should handle GitHub API errors", async () => {
      const mockApp = { vault: {} } as any;

      vi.mocked(requestUrl).mockResolvedValue({
        status: 422,
        text: ""
      });

      const packageData = { name: "Test Package" };
      const userInfo = { platform: "obsidian" };

      const result = await createPackageIssue(mockApp, packageData, userInfo);

      expect(result.success).toBe(false);
      expect(result.error).toContain("GitHub API error: 422");
    });

    it("should handle network errors", async () => {
      const mockApp = { vault: {} } as any;

      vi.mocked(requestUrl).mockRejectedValue(new Error("Network error"));

      const packageData = { name: "Test Package" };
      const userInfo = { platform: "obsidian" };

      const result = await createPackageIssue(mockApp, packageData, userInfo);

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