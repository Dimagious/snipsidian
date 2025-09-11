import { describe, it, expect } from "vitest";
import { validatePackage, validatePackageFile, validatePackageMetadata } from "./package-validator";

describe("package-validator", () => {
  describe("validatePackage", () => {
    it("should validate a correct package", () => {
      const packageData = {
        name: "Test Package",
        version: "1.0.0",
        author: "test-author",
        description: "A test package for validation",
        category: "productivity",
        tags: ["test", "example"],
        license: "MIT",
        snippets: [
          {
            trigger: ":test",
            replace: "This is a test",
            description: "Test snippet",
            keywords: ["test", "example"]
          }
        ]
      };

      const result = validatePackage(packageData, { strictMode: false });
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should detect missing required fields", () => {
      const packageData = {
        name: "Test Package",
        // Missing version, author, description, snippets
      };

      const result = validatePackage(packageData);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Required field 'version' is missing");
      expect(result.errors).toContain("Required field 'author' is missing");
      expect(result.errors).toContain("Required field 'description' is missing");
      expect(result.errors).toContain("Required field 'snippets' is missing");
    });

    it("should validate package name length", () => {
      const packageData = {
        name: "A", // Too short
        version: "1.0.0",
        author: "test-author",
        description: "A test package",
        snippets: []
      };

      const result = validatePackage(packageData);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Package name must be between 3 and 50 characters");
    });

    it("should validate semantic version", () => {
      const packageData = {
        name: "Test Package",
        version: "invalid-version",
        author: "test-author",
        description: "A test package",
        snippets: []
      };

      const result = validatePackage(packageData);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Package version must follow semantic versioning (e.g., '1.0.0')");
    });

    it("should validate category", () => {
      const packageData = {
        name: "Test Package",
        version: "1.0.0",
        author: "test-author",
        description: "A test package",
        category: "invalid-category",
        snippets: []
      };

      const result = validatePackage(packageData);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Invalid category. Must be one of: markdown, programming, academic, business, creative, productivity, language, other");
    });

    it("should validate snippets", () => {
      const packageData = {
        name: "Test Package",
        version: "1.0.0",
        author: "test-author",
        description: "A test package",
        snippets: [
          {
            trigger: "", // Empty trigger
            replace: "This is a test"
          },
          {
            trigger: ":test",
            replace: "" // Empty replacement
          }
        ]
      };

      const result = validatePackage(packageData);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Snippet 1: trigger is missing");
      expect(result.errors).toContain("Snippet 2: replacement is missing");
    });

    it("should detect duplicate triggers", () => {
      const packageData = {
        name: "Test Package",
        version: "1.0.0",
        author: "test-author",
        description: "A test package",
        snippets: [
          {
            trigger: ":test",
            replace: "First test"
          },
          {
            trigger: ":test", // Duplicate
            replace: "Second test"
          }
        ]
      };

      const result = validatePackage(packageData);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Duplicate triggers found: :test");
    });

    it("should validate trigger format", () => {
      const packageData = {
        name: "Test Package",
        version: "1.0.0",
        author: "test-author",
        description: "A test package",
        snippets: [
          {
            trigger: ":test with spaces", // Invalid characters
            replace: "This is a test"
          }
        ]
      };

      const result = validatePackage(packageData);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Snippet 1: trigger can only contain letters, numbers, colons, underscores, and hyphens");
    });

    it("should warn about missing optional fields", () => {
      const packageData = {
        name: "Test Package",
        version: "1.0.0",
        author: "test-author",
        description: "A test package",
        snippets: [
          {
            trigger: ":test",
            replace: "This is a test"
          }
        ]
      };

      const result = validatePackage(packageData, { strictMode: false });
      expect(result.isValid).toBe(true);
      expect(result.warnings).toContain("Optional field 'category' is missing");
      expect(result.warnings).toContain("Optional field 'tags' is missing");
    });

    it("should warn about inappropriate content", () => {
      const packageData = {
        name: "Test Package",
        version: "1.0.0",
        author: "test-author",
        description: "This is a test package with spam content",
        snippets: [
          {
            trigger: ":test",
            replace: "This is a test"
          }
        ]
      };

      const result = validatePackage(packageData, { strictMode: false });
      expect(result.isValid).toBe(true);
      expect(result.warnings).toContain("Package description contains potentially inappropriate word: 'spam'");
    });
  });

  describe("validatePackageFile", () => {
    it("should validate correct file path", () => {
      const result = validatePackageFile("community-packages/approved/test-package.yml");
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should reject invalid file extension", () => {
      const result = validatePackageFile("community-packages/approved/test-package.txt");
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Package file must have .yml or .yaml extension");
    });

    it("should reject invalid directory", () => {
      const result = validatePackageFile("invalid-directory/test-package.yml");
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Package file must be in one of: approved, pending, rejected, templates");
    });

    it("should reject invalid file name", () => {
      const result = validatePackageFile("community-packages/approved/test package.yml");
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Package file name can only contain letters, numbers, hyphens, and underscores");
    });
  });

  describe("validatePackageMetadata", () => {
    it("should validate correct metadata", () => {
      const packageData = {
        name: "Test Package",
        version: "1.0.0",
        author: "test-author",
        description: "A test package",
        license: "MIT",
        homepage: "https://github.com/test/package"
      };

      const result = validatePackageMetadata(packageData);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should require author for community packages", () => {
      const packageData = {
        name: "Test Package",
        version: "1.0.0",
        description: "A test package"
      };

      const result = validatePackageMetadata(packageData);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Author is required for community packages");
    });

    it("should require version for community packages", () => {
      const packageData = {
        name: "Test Package",
        author: "test-author",
        description: "A test package"
      };

      const result = validatePackageMetadata(packageData);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Version is required for community packages");
    });

    it("should warn about missing optional metadata", () => {
      const packageData = {
        name: "Test Package",
        version: "1.0.0",
        author: "test-author",
        description: "A test package"
      };

      const result = validatePackageMetadata(packageData);
      expect(result.isValid).toBe(true);
      expect(result.warnings).toContain("License is recommended for community packages");
      expect(result.warnings).toContain("Homepage is recommended for community packages");
    });

    it("should warn about test packages", () => {
      const packageData = {
        name: "Test Package",
        version: "1.0.0",
        author: "test-author",
        description: "A test package"
      };

      const result = validatePackageMetadata(packageData);
      expect(result.isValid).toBe(true);
      expect(result.warnings).toContain("Package name contains 'test' - ensure this is not a test package");
    });
  });
});
