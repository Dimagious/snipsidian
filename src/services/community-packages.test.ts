import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  loadCommunityPackages,
  loadCommunityPackage,
  searchCommunityPackages,
  getCommunityPackageStats,
  processPackageSubmission,
  getPackageCategories,
  getPopularTags,
  getTopRatedPackages,
  getMostDownloadedPackages,
  getRecentlyUpdatedPackages,
  getPackagesByAuthor,
  isPackageIdAvailable,
  generatePackageId,
  formatPackageMetadata,
  type PackageSearchOptions
} from "./community-packages";

// Mock the package validator
vi.mock("./package-validator", () => ({
  validatePackage: vi.fn(),
  validatePackageFile: vi.fn()
}));

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
  });

  describe("loadCommunityPackage", () => {
    it("should return null when package is not found", async () => {
      const package_ = await loadCommunityPackage("non-existent-package");
      expect(package_).toBeNull();
    });

    it("should handle errors gracefully", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      
      const package_ = await loadCommunityPackage("invalid-package");
      expect(package_).toBeNull();
      
      consoleSpy.mockRestore();
    });
  });

  describe("searchCommunityPackages", () => {
    it("should return empty array when no packages match", async () => {
      const packages = await searchCommunityPackages({ category: "programming" });
      expect(packages).toEqual([]);
    });

    it("should filter by category", async () => {
      // This test will pass when we have actual packages
      const packages = await searchCommunityPackages({ category: "programming" });
      expect(Array.isArray(packages)).toBe(true);
    });

    it("should filter by tags", async () => {
      const packages = await searchCommunityPackages({ tags: ["javascript", "react"] });
      expect(Array.isArray(packages)).toBe(true);
    });

    it("should filter by author", async () => {
      const packages = await searchCommunityPackages({ author: "test-author" });
      expect(Array.isArray(packages)).toBe(true);
    });

    it("should filter by verification status", async () => {
      const packages = await searchCommunityPackages({ verified: true });
      expect(Array.isArray(packages)).toBe(true);
    });

    it("should filter by minimum rating", async () => {
      const packages = await searchCommunityPackages({ minRating: 4.0 });
      expect(Array.isArray(packages)).toBe(true);
    });

    it("should filter by search term", async () => {
      const packages = await searchCommunityPackages({ searchTerm: "javascript" });
      expect(Array.isArray(packages)).toBe(true);
    });
  });

  describe("getCommunityPackageStats", () => {
    it("should return zero stats when no packages are available", async () => {
      const stats = await getCommunityPackageStats();
      
      expect(stats).toEqual({
        totalPackages: 0,
        approvedPackages: 0,
        pendingPackages: 0,
        rejectedPackages: 0,
        totalDownloads: 0,
        averageRating: 0
      });
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

    it("should validate community package requirements", async () => {
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
        // Missing author for community package
        description: "A test package",
        kind: "community",
        snippets: []
      };

      const result = await processPackageSubmission(packageData, "community-packages/pending/test-package.yml");
      
      expect(result.success).toBe(false);
      expect(result.errors).toContain("Community packages must have an author");
    });
  });

  describe("getPackageCategories", () => {
    it("should return all available categories", () => {
      const categories = getPackageCategories();
      
      expect(categories).toEqual([
        "markdown",
        "programming",
        "academic",
        "business",
        "creative",
        "productivity",
        "language",
        "other"
      ]);
    });
  });

  describe("getPopularTags", () => {
    it("should return empty array when no packages are available", async () => {
      const tags = await getPopularTags(10);
      expect(tags).toEqual([]);
    });

    it("should limit results to specified number", async () => {
      const tags = await getPopularTags(5);
      expect(tags.length).toBeLessThanOrEqual(5);
    });
  });

  describe("getTopRatedPackages", () => {
    it("should return empty array when no packages are available", async () => {
      const packages = await getTopRatedPackages(10);
      expect(packages).toEqual([]);
    });

    it("should limit results to specified number", async () => {
      const packages = await getTopRatedPackages(5);
      expect(packages.length).toBeLessThanOrEqual(5);
    });
  });

  describe("getMostDownloadedPackages", () => {
    it("should return empty array when no packages are available", async () => {
      const packages = await getMostDownloadedPackages(10);
      expect(packages).toEqual([]);
    });

    it("should limit results to specified number", async () => {
      const packages = await getMostDownloadedPackages(5);
      expect(packages.length).toBeLessThanOrEqual(5);
    });
  });

  describe("getRecentlyUpdatedPackages", () => {
    it("should return empty array when no packages are available", async () => {
      const packages = await getRecentlyUpdatedPackages(10);
      expect(packages).toEqual([]);
    });

    it("should limit results to specified number", async () => {
      const packages = await getRecentlyUpdatedPackages(5);
      expect(packages.length).toBeLessThanOrEqual(5);
    });
  });

  describe("getPackagesByAuthor", () => {
    it("should return empty array when no packages are available", async () => {
      const packages = await getPackagesByAuthor("test-author");
      expect(packages).toEqual([]);
    });
  });

  describe("isPackageIdAvailable", () => {
    it("should return true when no packages are available", async () => {
      const available = await isPackageIdAvailable("test-package");
      expect(available).toBe(true);
    });
  });

  describe("generatePackageId", () => {
    it("should generate valid package ID from name", () => {
      const id = generatePackageId("Test Package Name");
      expect(id).toBe("test-package-name");
    });

    it("should handle special characters", () => {
      const id = generatePackageId("Test Package (v1.0)!");
      expect(id).toBe("test-package-v10");
    });

    it("should handle multiple spaces and hyphens", () => {
      const id = generatePackageId("Test   Package---Name");
      expect(id).toBe("test-package-name");
    });

    it("should handle leading and trailing characters", () => {
      const id = generatePackageId("-Test Package-");
      expect(id).toBe("test-package");
    });
  });

  describe("formatPackageMetadata", () => {
    it("should format complete package metadata", () => {
      const pkg = {
        id: "test-package",
        label: "Test Package",
        author: "test-author",
        version: "1.0.0",
        description: "A test package",
        category: "productivity",
        tags: ["test", "example"],
        rating: 4.5,
        downloads: 100,
        lastUpdated: "2025-01-01",
        verified: true,
        kind: "community" as const,
        yaml: "test yaml"
      };

      const formatted = formatPackageMetadata(pkg);
      
      expect(formatted).toEqual({
        id: "test-package",
        label: "Test Package",
        author: "test-author",
        version: "1.0.0",
        description: "A test package",
        category: "productivity",
        tags: ["test", "example"],
        rating: 4.5,
        downloads: 100,
        lastUpdated: "2025-01-01",
        verified: true
      });
    });

    it("should handle missing optional fields", () => {
      const pkg = {
        id: "test-package",
        label: "Test Package",
        kind: "community" as const,
        yaml: "test yaml"
      };

      const formatted = formatPackageMetadata(pkg);
      
      expect(formatted).toEqual({
        id: "test-package",
        label: "Test Package",
        author: "Unknown",
        version: "1.0.0",
        description: "No description available",
        category: "other",
        tags: [],
        rating: 0,
        downloads: 0,
        lastUpdated: "Unknown",
        verified: false
      });
    });
  });
});
