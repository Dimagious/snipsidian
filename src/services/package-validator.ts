import type { PackageData } from "./package-types";

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface PackageValidationOptions {
  strictMode?: boolean;
  checkContent?: boolean;
  checkFormat?: boolean;
  checkNaming?: boolean;
}

/**
 * Validates a community package for quality and compliance
 */
export function validatePackage(
  packageData: PackageData,
  options: PackageValidationOptions = {}
): ValidationResult {
  const {
    strictMode = true,
    checkContent = true,
    checkFormat = true,
    checkNaming = true,
  } = options;

  const errors: string[] = [];
  const warnings: string[] = [];

  // Check if package data exists
  if (!packageData) {
    errors.push("Package data is missing");
    return { isValid: false, errors, warnings };
  }

  // Validate required fields
  if (checkFormat) {
    validateRequiredFields(packageData, errors);
    validateOptionalFields(packageData, warnings);
  }

  // Validate package structure
  if (checkFormat) {
    validatePackageStructure(packageData, errors, warnings);
  }

  // Validate naming conventions
  if (checkNaming) {
    validateNamingConventions(packageData, errors, warnings);
  }

  // Validate content quality
  if (checkContent) {
    validateContentQuality(packageData, errors, warnings);
  }

  // Validate snippets
  validateSnippets(packageData, errors, warnings);

  const isValid = errors.length === 0 && (!strictMode || warnings.length === 0);

  return { isValid, errors, warnings };
}

function validateRequiredFields(packageData: PackageData, errors: string[]) {
  const requiredFields = ["name", "version", "author", "description", "snippets"];
  
  for (const field of requiredFields) {
    if (!packageData[field]) {
      errors.push(`Required field '${field}' is missing`);
    }
  }
}

function validateOptionalFields(packageData: PackageData, warnings: string[]) {
  const optionalFields = ["category", "tags", "license", "homepage"];
  
  for (const field of optionalFields) {
    if (!packageData[field]) {
      warnings.push(`Optional field '${field}' is missing`);
    }
  }
}

function validatePackageStructure(packageData: PackageData, errors: string[], warnings: string[]) {
  // Validate name
  if (packageData.name) {
    if (typeof packageData.name !== "string") {
      errors.push("Package name must be a string");
    } else if (packageData.name.length < 3 || packageData.name.length > 50) {
      errors.push("Package name must be between 3 and 50 characters");
    }
  }

  // Validate version
  if (packageData.version) {
    if (typeof packageData.version !== "string") {
      errors.push("Package version must be a string");
    } else if (!isValidSemanticVersion(packageData.version)) {
      errors.push("Package version must follow semantic versioning (e.g., '1.0.0')");
    }
  }

  // Validate author
  if (packageData.author) {
    if (typeof packageData.author !== "string") {
      errors.push("Package author must be a string");
    } else if (packageData.author.length < 3 || packageData.author.length > 50) {
      errors.push("Package author must be between 3 and 50 characters");
    }
  }

  // Validate description
  if (packageData.description) {
    if (typeof packageData.description !== "string") {
      errors.push("Package description must be a string");
    } else if (packageData.description.length < 10 || packageData.description.length > 200) {
      errors.push("Package description must be between 10 and 200 characters");
    }
  }

  // Validate category
  if (packageData.category) {
    const validCategories = [
      "markdown", "programming", "academic", "business",
      "creative", "productivity", "language", "other"
    ];
    if (!validCategories.includes(packageData.category)) {
      errors.push(`Invalid category. Must be one of: ${validCategories.join(", ")}`);
    }
  }

  // Validate tags
  if (packageData.tags) {
    if (!Array.isArray(packageData.tags)) {
      errors.push("Tags must be an array");
    } else if (packageData.tags.length < 2 || packageData.tags.length > 10) {
      warnings.push("Tags should be between 2 and 10 items");
    } else {
      for (const tag of packageData.tags) {
        if (typeof tag !== "string") {
          errors.push("All tags must be strings");
        } else if (tag.length < 2 || tag.length > 20) {
          warnings.push(`Tag '${tag}' should be between 2 and 20 characters`);
        }
      }
    }
  }

  // Validate license
  if (packageData.license) {
    const validLicenses = ["MIT", "GPL", "Apache", "BSD", "CC", "Other"];
    if (!validLicenses.includes(packageData.license)) {
      warnings.push(`License '${packageData.license}' is not a common license`);
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- _warnings parameter kept for consistency with other validation functions
function validateNamingConventions(packageData: PackageData, errors: string[], _warnings: string[]) {
  // Validate package name
  if (packageData.name) {
    // Hyphen moved to end of character class to avoid escaping
    if (!/^[a-zA-Z0-9\s_-]+$/.test(packageData.name)) {
      errors.push("Package name can only contain letters, numbers, spaces, hyphens, and underscores");
    }
  }

  // Validate author name
  if (packageData.author) {
    // Hyphen moved to end of character class to avoid escaping
    if (!/^[a-zA-Z0-9\s_-]+$/.test(packageData.author)) {
      errors.push("Author name can only contain letters, numbers, spaces, hyphens, and underscores");
    }
  }
}

function validateContentQuality(packageData: PackageData, errors: string[], warnings: string[]) {
  // Check for inappropriate content
  const inappropriateWords = ["spam", "test", "dummy", "placeholder"];
  
  if (packageData.name) {
    for (const word of inappropriateWords) {
      if (packageData.name.toLowerCase().includes(word)) {
        warnings.push(`Package name contains potentially inappropriate word: '${word}'`);
      }
    }
  }

  if (packageData.description && typeof packageData.description === "string") {
    for (const word of inappropriateWords) {
      if (packageData.description.toLowerCase().includes(word)) {
        warnings.push(`Package description contains potentially inappropriate word: '${word}'`);
      }
    }
  }
}

function validateSnippets(packageData: PackageData, errors: string[], warnings: string[]) {
  if (!packageData.snippets) {
    errors.push("Package must contain snippets");
    return;
  }

  if (!Array.isArray(packageData.snippets)) {
    errors.push("Snippets must be an array");
    return;
  }

  if (packageData.snippets.length === 0) {
    errors.push("Package must contain at least one snippet");
    return;
  }

  if (packageData.snippets.length > 200) {
    warnings.push("Package contains more than 200 snippets, consider splitting");
  }

  const triggers = new Set<string>();
  const duplicates: string[] = [];

  for (let i = 0; i < packageData.snippets.length; i++) {
    const snippet = packageData.snippets[i];
    if (!snippet) {
      errors.push(`Snippet ${i + 1}: snippet is undefined or null`);
      continue;
    }
    const snippetErrors: string[] = [];
    const snippetWarnings: string[] = [];

    // Validate snippet structure
    if (!snippet.trigger) {
      snippetErrors.push(`Snippet ${i + 1}: trigger is missing`);
    } else if (typeof snippet.trigger !== "string") {
      snippetErrors.push(`Snippet ${i + 1}: trigger must be a string`);
    } else if (snippet.trigger.length < 1 || snippet.trigger.length > 50) {
      snippetErrors.push(`Snippet ${i + 1}: trigger must be between 1 and 50 characters`);
    } else if (!/^[a-zA-Z0-9:_-]+$/.test(snippet.trigger)) {
      snippetErrors.push(`Snippet ${i + 1}: trigger can only contain letters, numbers, colons, underscores, and hyphens`);
    } else {
      // Check for duplicate triggers
      if (triggers.has(snippet.trigger)) {
        duplicates.push(snippet.trigger);
      } else {
        triggers.add(snippet.trigger);
      }
    }

    if (!snippet.replace) {
      snippetErrors.push(`Snippet ${i + 1}: replacement is missing`);
    } else if (typeof snippet.replace !== "string") {
      snippetErrors.push(`Snippet ${i + 1}: replacement must be a string`);
    } else if (snippet.replace.length < 1 || snippet.replace.length > 10000) {
      snippetErrors.push(`Snippet ${i + 1}: replacement must be between 1 and 10000 characters`);
    }

    // Validate description
    if (snippet.description && typeof snippet.description !== "string") {
      snippetErrors.push(`Snippet ${i + 1}: description must be a string`);
    } else if (snippet.description && (snippet.description.length < 5 || snippet.description.length > 200)) {
      snippetWarnings.push(`Snippet ${i + 1}: description should be between 5 and 200 characters`);
    }

    // Validate keywords
    if (snippet.keywords) {
      if (!Array.isArray(snippet.keywords)) {
        snippetErrors.push(`Snippet ${i + 1}: keywords must be an array`);
      } else if (snippet.keywords.length > 10) {
        snippetWarnings.push(`Snippet ${i + 1}: should have no more than 10 keywords`);
      } else {
        for (const keyword of snippet.keywords) {
          if (typeof keyword !== "string") {
            snippetErrors.push(`Snippet ${i + 1}: all keywords must be strings`);
          } else if (keyword.length < 2 || keyword.length > 20) {
            snippetWarnings.push(`Snippet ${i + 1}: keyword '${keyword}' should be between 2 and 20 characters`);
          }
        }
      }
    }

    errors.push(...snippetErrors);
    warnings.push(...snippetWarnings);
  }

  // Add duplicate trigger warnings
  if (duplicates.length > 0) {
    errors.push(`Duplicate triggers found: ${duplicates.join(", ")}`);
  }
}

function isValidSemanticVersion(version: string): boolean {
  const semverRegex = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
  return semverRegex.test(version);
}

/**
 * Validates a package file path and structure
 */
export function validatePackageFile(filePath: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check file extension
  if (!filePath.endsWith('.yml') && !filePath.endsWith('.yaml')) {
    errors.push("Package file must have .yml or .yaml extension");
  }

  // Check file path structure
  const pathParts = filePath.split('/');
  if (pathParts.length < 2) {
    errors.push("Package file must be in a subdirectory");
  }

  const directory = pathParts[pathParts.length - 2];
  const validDirectories = ['approved', 'pending', 'rejected', 'templates'];
  if (directory && !validDirectories.includes(directory)) {
    errors.push(`Package file must be in one of: ${validDirectories.join(', ')}`);
  }

  // Check file name
  const fileName = pathParts[pathParts.length - 1];
  // Hyphen moved to end of character class to avoid escaping
  if (fileName && !/^[a-zA-Z0-9_-]+\.(yml|yaml)$/.test(fileName)) {
    errors.push("Package file name can only contain letters, numbers, hyphens, and underscores");
  }

  const isValid = errors.length === 0;
  return { isValid, errors, warnings };
}

/**
 * Validates package metadata for community submission
 */
export function validatePackageMetadata(packageData: PackageData): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check for required metadata
  if (!packageData.author) {
    errors.push("Author is required for community packages");
  }

  if (!packageData.version) {
    errors.push("Version is required for community packages");
  }

  if (!packageData.license) {
    warnings.push("License is recommended for community packages");
  }

  if (!packageData.homepage) {
    warnings.push("Homepage is recommended for community packages");
  }

  // Check for appropriate content
  if (packageData.name && packageData.name.toLowerCase().includes('test')) {
    warnings.push("Package name contains 'test' - ensure this is not a test package");
  }

  const isValid = errors.length === 0;
  return { isValid, errors, warnings };
}
