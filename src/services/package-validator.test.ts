import { describe, it, expect } from "vitest";
import {
  validatePackage,
  validatePackageFile,
  validatePackageMetadata,
  validatePackageForInstall,
  INSTALL_MAX_SNIPPETS,
  INSTALL_MAX_REPLACEMENT_LEN,
} from "./package-validator";

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

  describe("snippet validation edge cases", () => {
    it("should validate snippet description length", () => {
      const packageData = {
        name: "Test Package",
        version: "1.0.0",
        author: "test-author",
        description: "A test package",
        snippets: [
          {
            trigger: ":test",
            replace: "test replacement",
            description: "ab" // Too short
          }
        ]
      };

      const result = validatePackage(packageData, { strictMode: false });
      expect(result.warnings).toContain("Snippet 1: description should be between 5 and 200 characters");
    });

    it("should validate snippet description too long", () => {
      const packageData = {
        name: "Test Package",
        version: "1.0.0",
        author: "test-author",
        description: "A test package",
        snippets: [
          {
            trigger: ":test",
            replace: "test replacement",
            description: "a".repeat(201) // Too long
          }
        ]
      };

      const result = validatePackage(packageData, { strictMode: false });
      expect(result.warnings).toContain("Snippet 1: description should be between 5 and 200 characters");
    });

    it("should validate keywords array", () => {
      const packageData = {
        name: "Test Package",
        version: "1.0.0",
        author: "test-author",
        description: "A test package",
        snippets: [
          {
            trigger: ":test",
            replace: "test replacement",
            keywords: "not-an-array" // Should be array
          }
        ]
      };

      const result = validatePackage(packageData, { strictMode: false });
      expect(result.errors).toContain("Snippet 1: keywords must be an array");
    });

    it("should validate too many keywords", () => {
      const packageData = {
        name: "Test Package",
        version: "1.0.0",
        author: "test-author",
        description: "A test package",
        snippets: [
          {
            trigger: ":test",
            replace: "test replacement",
            keywords: Array(11).fill("keyword") // Too many keywords
          }
        ]
      };

      const result = validatePackage(packageData, { strictMode: false });
      expect(result.warnings).toContain("Snippet 1: should have no more than 10 keywords");
    });

    it("should validate keyword types", () => {
      const packageData = {
        name: "Test Package",
        version: "1.0.0",
        author: "test-author",
        description: "A test package",
        snippets: [
          {
            trigger: ":test",
            replace: "test replacement",
            keywords: ["valid", 123, "another"] // Mixed types
          }
        ]
      };

      const result = validatePackage(packageData, { strictMode: false });
      expect(result.errors).toContain("Snippet 1: all keywords must be strings");
    });

    it("should validate keyword length too short", () => {
      const packageData = {
        name: "Test Package",
        version: "1.0.0",
        author: "test-author",
        description: "A test package",
        snippets: [
          {
            trigger: ":test",
            replace: "test replacement",
            keywords: ["a"] // Too short
          }
        ]
      };

      const result = validatePackage(packageData, { strictMode: false });
      expect(result.warnings).toContain("Snippet 1: keyword 'a' should be between 2 and 20 characters");
    });

    it("should validate keyword length too long", () => {
      const packageData = {
        name: "Test Package",
        version: "1.0.0",
        author: "test-author",
        description: "A test package",
        snippets: [
          {
            trigger: ":test",
            replace: "test replacement",
            keywords: ["a".repeat(21)] // Too long
          }
        ]
      };

      const result = validatePackage(packageData, { strictMode: false });
      expect(result.warnings).toContain(`Snippet 1: keyword '${"a".repeat(21)}' should be between 2 and 20 characters`);
    });

    it("should validate empty snippets array", () => {
      const packageData = {
        name: "Test Package",
        version: "1.0.0",
        author: "test-author",
        description: "A test package",
        snippets: []
      };

      const result = validatePackage(packageData, { strictMode: false });
      expect(result.errors).toContain("Package must contain at least one snippet");
    });

    it("should warn about too many snippets", () => {
      const packageData = {
        name: "Test Package",
        version: "1.0.0",
        author: "test-author",
        description: "A test package",
        snippets: Array(201).fill({
          trigger: ":test",
          replace: "test replacement"
        })
      };

      const result = validatePackage(packageData, { strictMode: false });
      expect(result.warnings).toContain("Package contains more than 200 snippets, consider splitting");
    });

    it("should validate trigger length too long", () => {
      const packageData = {
        name: "Test Package",
        version: "1.0.0",
        author: "test-author",
        description: "A test package",
        snippets: [
          {
            trigger: "a".repeat(51), // Too long
            replace: "test replacement"
          }
        ]
      };

      const result = validatePackage(packageData, { strictMode: false });
      expect(result.errors).toContain("Snippet 1: trigger must be between 1 and 50 characters");
    });

    it("should validate trigger with invalid characters", () => {
      const packageData = {
        name: "Test Package",
        version: "1.0.0",
        author: "test-author",
        description: "A test package",
        snippets: [
          {
            trigger: ":test@invalid", // Invalid characters
            replace: "test replacement"
          }
        ]
      };

      const result = validatePackage(packageData, { strictMode: false });
      expect(result.errors).toContain("Snippet 1: trigger can only contain letters, numbers, colons, underscores, and hyphens");
    });

    it("should validate trigger as non-string", () => {
      const packageData = {
        name: "Test Package",
        version: "1.0.0",
        author: "test-author",
        description: "A test package",
        snippets: [
          {
            trigger: 123, // Not a string
            replace: "test replacement"
          }
        ]
      };

      const result = validatePackage(packageData, { strictMode: false });
      expect(result.errors).toContain("Snippet 1: trigger must be a string");
    });

    it("should validate author name with invalid characters", () => {
      const packageData = {
        name: "Test Package",
        version: "1.0.0",
        author: "test@author", // Invalid characters
        description: "A test package",
        snippets: [
          {
            trigger: ":test",
            replace: "test replacement"
          }
        ]
      };

      const result = validatePackage(packageData, { strictMode: false });
      expect(result.errors).toContain("Author name can only contain letters, numbers, spaces, hyphens, and underscores");
    });

    it("should validate package name with invalid characters", () => {
      const packageData = {
        name: "Test@Package", // Invalid characters
        version: "1.0.0",
        author: "test-author",
        description: "A test package",
        snippets: [
          {
            trigger: ":test",
            replace: "test replacement"
          }
        ]
      };

      const result = validatePackage(packageData, { strictMode: false });
      expect(result.errors).toContain("Package name can only contain letters, numbers, spaces, hyphens, and underscores");
    });

    it("should warn about inappropriate words in package name", () => {
      const packageData = {
        name: "Spam Package", // Contains "spam"
        version: "1.0.0",
        author: "test-author",
        description: "A test package",
        snippets: [
          {
            trigger: ":test",
            replace: "test replacement"
          }
        ]
      };

      const result = validatePackage(packageData, { strictMode: false });
      expect(result.warnings).toContain("Package name contains potentially inappropriate word: 'spam'");
    });

    it("should warn about inappropriate words in description", () => {
      const packageData = {
        name: "Test Package",
        version: "1.0.0",
        author: "test-author",
        description: "This is a dummy package", // Contains "dummy"
        snippets: [
          {
            trigger: ":test",
            replace: "test replacement"
          }
        ]
      };

      const result = validatePackage(packageData, { strictMode: false });
      expect(result.warnings).toContain("Package description contains potentially inappropriate word: 'dummy'");
    });

    it("should validate snippets as non-array", () => {
      const packageData = {
        name: "Test Package",
        version: "1.0.0",
        author: "test-author",
        description: "A test package",
        snippets: "not-an-array" // Should be array
      };

      const result = validatePackage(packageData, { strictMode: false });
      expect(result.errors).toContain("Snippets must be an array");
    });

    it("should validate tag length too short", () => {
      const packageData = {
        name: "Test Package",
        version: "1.0.0",
        author: "test-author",
        description: "A test package",
        tags: ["valid", "a"], // One tag too short, but array has 2 items
        snippets: [
          {
            trigger: ":test",
            replace: "test replacement"
          }
        ]
      };

      const result = validatePackage(packageData, { strictMode: false });
      expect(result.warnings).toContain("Tag 'a' should be between 2 and 20 characters");
    });

    it("should validate tag length too long", () => {
      const packageData = {
        name: "Test Package",
        version: "1.0.0",
        author: "test-author",
        description: "A test package",
        tags: ["valid", "a".repeat(21)], // One tag too long, but array has 2 items
        snippets: [
          {
            trigger: ":test",
            replace: "test replacement"
          }
        ]
      };

      const result = validatePackage(packageData, { strictMode: false });
      expect(result.warnings).toContain(`Tag '${"a".repeat(21)}' should be between 2 and 20 characters`);
    });

    it("should validate tag as non-string", () => {
      const packageData = {
        name: "Test Package",
        version: "1.0.0",
        author: "test-author",
        description: "A test package",
        tags: ["valid", 123, "another"], // Mixed types
        snippets: [
          {
            trigger: ":test",
            replace: "test replacement"
          }
        ]
      };

      const result = validatePackage(packageData, { strictMode: false });
      expect(result.errors).toContain("All tags must be strings");
    });

    it("should warn about uncommon license", () => {
      const packageData = {
        name: "Test Package",
        version: "1.0.0",
        author: "test-author",
        description: "A test package",
        license: "Custom License", // Not a common license
        snippets: [
          {
            trigger: ":test",
            replace: "test replacement"
          }
        ]
      };

      const result = validatePackage(packageData, { strictMode: false });
      expect(result.warnings).toContain("License 'Custom License' is not a common license");
    });

    it("should validate description as non-string", () => {
      const packageData = {
        name: "Test Package",
        version: "1.0.0",
        author: "test-author",
        description: 123, // Not a string
        snippets: [
          {
            trigger: ":test",
            replace: "test replacement"
          }
        ]
      };

      const result = validatePackage(packageData, { strictMode: false });
      expect(result.errors).toContain("Package description must be a string");
    });

    it("should validate description too short", () => {
      const packageData = {
        name: "Test Package",
        version: "1.0.0",
        author: "test-author",
        description: "short", // Too short
        snippets: [
          {
            trigger: ":test",
            replace: "test replacement"
          }
        ]
      };

      const result = validatePackage(packageData, { strictMode: false });
      expect(result.errors).toContain("Package description must be between 10 and 200 characters");
    });

    it("should validate description too long", () => {
      const packageData = {
        name: "Test Package",
        version: "1.0.0",
        author: "test-author",
        description: "a".repeat(201), // Too long
        snippets: [
          {
            trigger: ":test",
            replace: "test replacement"
          }
        ]
      };

      const result = validatePackage(packageData, { strictMode: false });
      expect(result.errors).toContain("Package description must be between 10 and 200 characters");
    });

    it("should validate invalid category", () => {
      const packageData = {
        name: "Test Package",
        version: "1.0.0",
        author: "test-author",
        description: "A test package",
        category: "invalid-category",
        snippets: [
          {
            trigger: ":test",
            replace: "test replacement"
          }
        ]
      };

      const result = validatePackage(packageData, { strictMode: false });
      expect(result.errors).toContain("Invalid category. Must be one of: markdown, programming, academic, business, creative, productivity, language, other");
    });

    it("should validate tags as non-array", () => {
      const packageData = {
        name: "Test Package",
        version: "1.0.0",
        author: "test-author",
        description: "A test package",
        tags: "not-an-array", // Should be array
        snippets: [
          {
            trigger: ":test",
            replace: "test replacement"
          }
        ]
      };

      const result = validatePackage(packageData, { strictMode: false });
      expect(result.errors).toContain("Tags must be an array");
    });

    it("should warn about too few tags", () => {
      const packageData = {
        name: "Test Package",
        version: "1.0.0",
        author: "test-author",
        description: "A test package",
        tags: ["single"], // Only one tag
        snippets: [
          {
            trigger: ":test",
            replace: "test replacement"
          }
        ]
      };

      const result = validatePackage(packageData, { strictMode: false });
      expect(result.warnings).toContain("Tags should be between 2 and 10 items");
    });

    it("should warn about too many tags", () => {
      const packageData = {
        name: "Test Package",
        version: "1.0.0",
        author: "test-author",
        description: "A test package",
        tags: Array(11).fill("tag"), // Too many tags
        snippets: [
          {
            trigger: ":test",
            replace: "test replacement"
          }
        ]
      };

      const result = validatePackage(packageData, { strictMode: false });
      expect(result.warnings).toContain("Tags should be between 2 and 10 items");
    });
  });

  // ---------------------------------------------------------------------
  // validatePackageForInstall — closes B-033 (install-time bypass) and
  // S-006 (slash in label/trigger). Boundary cases per ADR-0005:
  // a test should fail if the *contract* breaks, not just if a line is
  // unexecuted.
  // ---------------------------------------------------------------------

  describe("validatePackageForInstall", () => {
    const okPkg = () => ({
      label: "My Pack",
      snippets: { ":hi": "hello", ":br": "be right back" },
    });

    it("accepts a well-formed package", () => {
      const r = validatePackageForInstall(okPkg());
      expect(r.isValid).toBe(true);
      expect(r.errors).toEqual([]);
    });

    it("rejects a missing or non-string label", () => {
      const r1 = validatePackageForInstall({ label: "", snippets: { ":a": "x" } });
      expect(r1.isValid).toBe(false);
      expect(r1.errors[0]).toMatch(/label is missing/i);

      const r2 = validatePackageForInstall({ label: undefined as unknown as string, snippets: { ":a": "x" } });
      expect(r2.isValid).toBe(false);
    });

    it("rejects an empty snippets bag", () => {
      const r = validatePackageForInstall({ label: "Empty", snippets: {} });
      expect(r.isValid).toBe(false);
      expect(r.errors.join(" ")).toMatch(/no snippets/i);
    });

    it("rejects a snippets count over INSTALL_MAX_SNIPPETS", () => {
      const snippets: Record<string, string> = {};
      for (let i = 0; i <= INSTALL_MAX_SNIPPETS; i++) snippets[`t${i}`] = "x";
      const r = validatePackageForInstall({ label: "Huge", snippets });
      expect(r.isValid).toBe(false);
      expect(r.errors.join(" ")).toMatch(/exceeds limit of 500/);
    });

    it("accepts exactly INSTALL_MAX_SNIPPETS entries (boundary)", () => {
      const snippets: Record<string, string> = {};
      for (let i = 0; i < INSTALL_MAX_SNIPPETS; i++) snippets[`t${i}`] = "x";
      const r = validatePackageForInstall({ label: "Big", snippets });
      expect(r.isValid).toBe(true);
    });

    it("rejects replacement over INSTALL_MAX_REPLACEMENT_LEN", () => {
      const r = validatePackageForInstall({
        label: "Big-replace",
        snippets: { ":big": "a".repeat(INSTALL_MAX_REPLACEMENT_LEN + 1) },
      });
      expect(r.isValid).toBe(false);
      expect(r.errors.join(" ")).toMatch(/exceeds limit of 10000/);
    });

    it("accepts replacement of exactly INSTALL_MAX_REPLACEMENT_LEN chars (boundary)", () => {
      const r = validatePackageForInstall({
        label: "Edge-replace",
        snippets: { ":edge": "a".repeat(INSTALL_MAX_REPLACEMENT_LEN) },
      });
      expect(r.isValid).toBe(true);
    });

    it("rejects '/' in the label (B-033 + S-006)", () => {
      const r = validatePackageForInstall({ label: "evil/label", snippets: { ":a": "x" } });
      expect(r.isValid).toBe(false);
      expect(r.errors.join(" ")).toMatch(/cannot contain '\/'/);
    });

    it("rejects '\\' in the label (Windows separator)", () => {
      const r = validatePackageForInstall({ label: "evil\\label", snippets: { ":a": "x" } });
      expect(r.isValid).toBe(false);
    });

    it("rejects '/' in a trigger (S-006: would corrupt splitKey)", () => {
      const r = validatePackageForInstall({ label: "Pack", snippets: { "evil/trigger": "x" } });
      expect(r.isValid).toBe(false);
      expect(r.errors.join(" ")).toMatch(/can only contain letters, numbers, colons, underscores, and hyphens/);
    });

    it("rejects whitespace in a trigger", () => {
      const r = validatePackageForInstall({ label: "Pack", snippets: { "two words": "x" } });
      expect(r.isValid).toBe(false);
    });

    it("rejects a control character in a trigger (S-002 RTL-override / zero-width unicode angle)", () => {
      const r = validatePackageForInstall({ label: "Pack", snippets: { "‮:legit": "x" } });
      expect(r.isValid).toBe(false);
    });

    it("rejects a non-string replacement (defence against malformed YAML)", () => {
      const r = validatePackageForInstall({
        label: "Pack",
        snippets: { ":a": 42 as unknown as string },
      });
      expect(r.isValid).toBe(false);
      expect(r.errors.join(" ")).toMatch(/must be a string/);
    });

    it("truncates noisy trigger strings in error messages", () => {
      const longTrigger = "x".repeat(200);
      const r = validatePackageForInstall({
        label: "Pack",
        snippets: { [longTrigger]: "x" },
      });
      // First error mentions the trigger but only the truncated form (≤40 chars + "…").
      const errMsg = r.errors[0] ?? "";
      expect(errMsg).toContain("…");
      expect(errMsg.length).toBeLessThan(longTrigger.length + 80);
    });

    it("rejects aggregate-size attack (low count, huge content)", () => {
      // 250 snippets of ~10000 chars each = ~2.5 MiB total, over the 2 MiB cap.
      const snippets: Record<string, string> = {};
      const big = "a".repeat(INSTALL_MAX_REPLACEMENT_LEN);
      for (let i = 0; i < 250; i++) snippets[`t${i}`] = big;
      const r = validatePackageForInstall({ label: "Aggregate", snippets });
      expect(r.isValid).toBe(false);
      expect(r.errors.join(" ")).toMatch(/total size/);
    });
  });
});
