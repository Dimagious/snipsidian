/**
 * Google Form integration for package submission
 * Handles package submission through Google Forms as an alternative to GitHub Issues
 */

import * as yaml from "js-yaml";
import { App } from "obsidian";
import { 
  buildPackageFormUrl, 
  collectPackageFormMeta, 
  PackageSubmissionData,
  PackageFormMeta,
  packageFormEntryIdMap
} from "./feedback-form";
import { validatePackage } from "./package-validator";

// Google Form URL for package submission
export const PACKAGE_SUBMISSION_FORM_URL = "https://docs.google.com/forms/d/e/1FAIpQLSd65G0T_9o6ec8FmWa1BkxiU3dqInS6cad-uPGN-xHpfPplQw/viewform";

export interface PackageFormSubmissionResult {
  success: boolean;
  formUrl?: string;
  error?: string;
}

/**
 * Validates package data and prepares it for Google Form submission
 * @param packageData - Raw package data (YAML string or object)
 * @param submitterEmail - Optional submitter email
 * @param submitterName - Optional submitter name
 * @returns Validation result with prepared data
 */
export function validateAndPreparePackageData(
  packageData: string | PackageData,
  submitterEmail?: string,
  submitterName?: string
): { 
  isValid: boolean; 
  errors: string[]; 
  warnings: string[]; 
  preparedData?: PackageSubmissionData 
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  try {
    // Parse YAML if it's a string
    let parsedData: PackageData;
    if (typeof packageData === 'string') {
      parsedData = yaml.load(packageData) as PackageData;
    } else {
      parsedData = packageData;
    }
    
    if (!parsedData || typeof parsedData !== 'object') {
      errors.push("Invalid package data format");
      return { isValid: false, errors, warnings };
    }
    
    // Validate using existing validator
    const validation = validatePackage(parsedData, { strictMode: false });
    
    if (!validation.isValid) {
      errors.push(...validation.errors);
    }
    
    if (validation.warnings) {
      warnings.push(...validation.warnings);
    }
    
    // Prepare data for form submission
    const preparedData: PackageSubmissionData = {
      name: parsedData.name || '',
      version: parsedData.version || '',
      author: parsedData.author || '',
      description: parsedData.description || '',
      category: parsedData.category || '',
      tags: Array.isArray(parsedData.tags) 
        ? parsedData.tags 
        : typeof parsedData.tags === 'string' 
          ? parsedData.tags.split(',').map((tag: string) => tag.trim()).filter((tag: string) => tag.length > 0)
          : [],
      license: parsedData.license || '',
      homepage: parsedData.homepage || '',
      readme: parsedData.readme || '',
      yamlContent: typeof packageData === 'string' ? packageData : yaml.dump(parsedData, { 
        indent: 2,
        lineWidth: -1,
        noRefs: true
      }),
      submitterEmail: submitterEmail || '',
      submitterName: submitterName || ''
    };
    
    return {
      isValid: validation.isValid,
      errors,
      warnings,
      preparedData: validation.isValid ? preparedData : undefined
    };
    
  } catch (error) {
    errors.push(`Failed to parse package data: ${error}`);
    return { isValid: false, errors, warnings };
  }
}

/**
 * Submits a package through Google Form
 * @param packageData - Package data (YAML string or object)
 * @param app - Obsidian App instance
 * @param pluginVersion - Plugin version
 * @param submitterEmail - Optional submitter email
 * @param submitterName - Optional submitter name
 * @returns Submission result with form URL
 */
export async function submitPackageViaGoogleForm(
  packageData: Record<string, unknown>,
  app: App,
  pluginVersion: string,
  submitterEmail?: string,
  submitterName?: string
): Promise<PackageFormSubmissionResult> {
  try {
    // Validate and prepare package data
    const validation = validateAndPreparePackageData(packageData, submitterEmail, submitterName);
    
    if (!validation.isValid || !validation.preparedData) {
      return {
        success: false,
        error: `Package validation failed: ${validation.errors.join(', ')}`
      };
    }
    
    // Collect system metadata
    const meta = collectPackageFormMeta(app, pluginVersion, submitterName, submitterEmail);
    
    // Build Google Form URL with pre-filled data
    const formUrl = buildPackageFormUrl(
      PACKAGE_SUBMISSION_FORM_URL,
      validation.preparedData,
      meta
    );
    
    return {
      success: true,
      formUrl
    };
    
  } catch (error) {
    return {
      success: false,
      error: `Failed to prepare package submission: ${error}`
    };
  }
}

/**
 * Opens Google Form for package submission in a new tab
 * @param packageData - Package data (YAML string or object)
 * @param app - Obsidian App instance
 * @param pluginVersion - Plugin version
 * @param submitterEmail - Optional submitter email
 * @param submitterName - Optional submitter name
 * @returns Promise that resolves when form is opened
 */
export async function openPackageSubmissionForm(
  packageData: Record<string, unknown>,
  app: App,
  pluginVersion: string,
  submitterEmail?: string,
  submitterName?: string
): Promise<PackageFormSubmissionResult> {
  const result = await submitPackageViaGoogleForm(
    packageData,
    app,
    pluginVersion,
    submitterEmail,
    submitterName
  );
  
  if (result.success && result.formUrl) {
    // Open form in new tab
    window.open(result.formUrl, '_blank', 'noopener,noreferrer');
  }
  
  return result;
}

/**
 * Creates a simple package submission form URL without pre-filled data
 * @returns Google Form URL for manual package submission
 */
export function getPackageSubmissionFormUrl(): string {
  return PACKAGE_SUBMISSION_FORM_URL;
}


/**
 * Validates if a package has the minimum required fields for submission
 * @param packageData - Package data to validate
 * @returns Validation result
 */
export function validatePackageForSubmission(packageData: PackageData): {
  isValid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // Check required fields
  if (!packageData.name || typeof packageData.name !== 'string' || packageData.name.trim().length === 0) {
    errors.push("Package name is required");
  }
  
  if (!packageData.author || typeof packageData.author !== 'string' || packageData.author.trim().length === 0) {
    errors.push("Package author is required");
  }
  
  if (!packageData.version || typeof packageData.version !== 'string' || packageData.version.trim().length === 0) {
    errors.push("Package version is required");
  }
  
  if (!packageData.description || typeof packageData.description !== 'string' || packageData.description.trim().length === 0) {
    errors.push("Package description is required");
  }
  
  if (!packageData.snippets || !Array.isArray(packageData.snippets) || packageData.snippets.length === 0) {
    errors.push("Package must contain at least one snippet");
  }
  
  // Check snippet structure
  if (packageData.snippets && Array.isArray(packageData.snippets)) {
    packageData.snippets.forEach((snippet: { trigger?: string; replace?: string }, index: number) => {
      if (!snippet.trigger || typeof snippet.trigger !== 'string' || snippet.trigger.trim().length === 0) {
        errors.push(`Snippet ${index + 1}: trigger is required`);
      }
      
      if (!snippet.replace || typeof snippet.replace !== 'string' || snippet.replace.trim().length === 0) {
        errors.push(`Snippet ${index + 1}: replace text is required`);
      }
    });
  }
  
  // Warnings for optional but recommended fields
  if (!packageData.category) {
    warnings.push("Package category is recommended for better organization");
  }
  
  if (!packageData.tags || !Array.isArray(packageData.tags) || packageData.tags.length === 0) {
    warnings.push("Package tags are recommended for better discoverability");
  }
  
  if (!packageData.license) {
    warnings.push("Package license is recommended");
  }
  
  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
}
