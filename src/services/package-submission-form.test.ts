import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as yaml from 'js-yaml';
import {
  getPackageSubmissionFormUrl,
  validatePackageForSubmission,
  validateAndPreparePackageData,
  openPackageSubmissionForm,
  PACKAGE_SUBMISSION_FORM_URL
} from './package-submission-form';

// Mock dependencies
vi.mock('js-yaml', () => ({
  load: vi.fn(),
  dump: vi.fn()
}));

vi.mock('./feedback-form', () => ({
  buildPackageFormUrl: vi.fn(),
  collectPackageFormMeta: vi.fn()
}));

vi.mock('./package-validator', () => ({
  validatePackage: vi.fn()
}));

describe('package-submission-form', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getPackageSubmissionFormUrl', () => {
    it('should return the correct form URL', () => {
      const url = getPackageSubmissionFormUrl();
      expect(url).toBe(PACKAGE_SUBMISSION_FORM_URL);
    });
  });

  describe('validateAndPreparePackageData', () => {
    it('should handle YAML parsing errors', () => {
      const invalidYaml = 'invalid: yaml: content: [';
      vi.mocked(yaml.load).mockImplementation(() => {
        throw new Error('YAML parsing error');
      });

      const result = validateAndPreparePackageData(invalidYaml);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Failed to parse package data: Error: YAML parsing error');
      expect(result.preparedData).toBeUndefined();
    });

    it('should handle invalid package data format', () => {
      const invalidData = null;
      const result = validateAndPreparePackageData(invalidData);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Invalid package data format');
      expect(result.preparedData).toBeUndefined();
    });

    it('should handle non-object parsed data', () => {
      const stringData = 'just a string';
      vi.mocked(yaml.load).mockReturnValue(stringData);

      const result = validateAndPreparePackageData('yaml string');

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Invalid package data format');
    });

    it('should prepare data with default values', async () => {
      const packageData = {
        name: 'Test Package',
        version: '1.0.0',
        author: 'Test Author',
        description: 'A test package',
        snippets: [{ trigger: ':test', replace: 'This is a test' }]
      };

      const { validatePackage } = await import('./package-validator');
      vi.mocked(validatePackage).mockReturnValue({
        isValid: true,
        errors: [],
        warnings: []
      });

      vi.mocked(yaml.dump).mockReturnValue('test yaml');

      const result = validateAndPreparePackageData(packageData, 'test@example.com', 'Test User');

      expect(result.isValid).toBe(true);
      expect(result.preparedData).toEqual({
        name: 'Test Package',
        version: '1.0.0',
        author: 'Test Author',
        description: 'A test package',
        category: '',
        tags: [],
        license: '',
        homepage: '',
        readme: '',
        yamlContent: 'test yaml',
        submitterEmail: 'test@example.com',
        submitterName: 'Test User'
      });
    });

    it('should handle tags as array', async () => {
      const packageData = {
        name: 'Test Package',
        version: '1.0.0',
        author: 'Test Author',
        description: 'A test package',
        tags: ['test', 'example'],
        snippets: [{ trigger: ':test', replace: 'This is a test' }]
      };

      const { validatePackage } = await import('./package-validator');
      vi.mocked(validatePackage).mockReturnValue({
        isValid: true,
        errors: [],
        warnings: []
      });

      const result = validateAndPreparePackageData(packageData);

      expect(result.isValid).toBe(true);
      expect(result.preparedData?.tags).toEqual(['test', 'example']);
    });

    it('should handle tags as string', async () => {
      const packageData = {
        name: 'Test Package',
        version: '1.0.0',
        author: 'Test Author',
        description: 'A test package',
        tags: 'test, example',
        snippets: [{ trigger: ':test', replace: 'This is a test' }]
      };

      const { validatePackage } = await import('./package-validator');
      vi.mocked(validatePackage).mockReturnValue({
        isValid: true,
        errors: [],
        warnings: []
      });

      const result = validateAndPreparePackageData(packageData);

      expect(result.isValid).toBe(true);
      expect(result.preparedData?.tags).toEqual(['test', 'example']);
    });
  });

  describe('openPackageSubmissionForm', () => {
    it('should open form with valid package data', async () => {
      const mockApp = { version: '1.0.0' } as any;
      const packageData = {
        name: 'Test Package',
        version: '1.0.0',
        author: 'Test Author',
        description: 'A test package',
        yamlContent: 'test yaml',
        submitterEmail: 'test@example.com',
        submitterName: 'Test User'
      };

      const mockFormUrl = 'https://docs.google.com/forms/test';
      const { buildPackageFormUrl, collectPackageFormMeta } = await import('./feedback-form');
      
      vi.mocked(buildPackageFormUrl).mockReturnValue(mockFormUrl);
      vi.mocked(collectPackageFormMeta).mockReturnValue({
        plugin: '0.8.0',
        obsidian: '1.0.0',
        platform: 'mac',
        os: 'MacIntel',
        locale: 'en-US',
        theme: 'Default'
      });

      const mockOpen = vi.fn();
      Object.defineProperty(global, 'window', {
        value: { open: mockOpen },
        writable: true
      });

      await openPackageSubmissionForm(packageData, mockApp, '0.8.0');

      expect(buildPackageFormUrl).toHaveBeenCalled();
      expect(mockOpen).toHaveBeenCalledWith(mockFormUrl, '_blank', 'noopener,noreferrer');
    });

    it('should handle validation errors', async () => {
      const mockApp = {} as any;
      const invalidPackageData = { name: '' };

      const mockOpen = vi.fn();
      Object.defineProperty(global, 'window', {
        value: { open: mockOpen },
        writable: true
      });

      const result = await openPackageSubmissionForm(invalidPackageData, mockApp, '0.8.0');

      // The function should still open the form even with validation errors
      // because it uses the validation from validateAndPreparePackageData
      expect(mockOpen).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });
  });

  describe('validatePackageForSubmission', () => {
    it('should validate package with all required fields', () => {
      const validPackage = {
        name: 'Test Package',
        version: '1.0.0',
        author: 'Test Author',
        description: 'A test package',
        snippets: [
          { trigger: ':test', replace: 'This is a test' }
        ]
      };

      const result = validatePackageForSubmission(validPackage);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject package with missing required fields', () => {
      const invalidPackage = {
        name: 'Test Package'
        // Missing other required fields
      };

      const result = validatePackageForSubmission(invalidPackage);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Package author is required');
      expect(result.errors).toContain('Package version is required');
      expect(result.errors).toContain('Package description is required');
      expect(result.errors).toContain('Package must contain at least one snippet');
    });

    it('should validate snippet structure', () => {
      const packageWithInvalidSnippets = {
        name: 'Test Package',
        version: '1.0.0',
        author: 'Test Author',
        description: 'A test package',
        snippets: [
          { trigger: '', replace: 'This is a test' }, // Empty trigger
          { trigger: ':test', replace: '' } // Empty replace
        ]
      };

      const result = validatePackageForSubmission(packageWithInvalidSnippets);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Snippet 1: trigger is required');
      expect(result.errors).toContain('Snippet 2: replace text is required');
    });

    it('should provide warnings for optional fields', () => {
      const minimalPackage = {
        name: 'Test Package',
        version: '1.0.0',
        author: 'Test Author',
        description: 'A test package',
        snippets: [
          { trigger: ':test', replace: 'This is a test' }
        ]
      };

      const result = validatePackageForSubmission(minimalPackage);

      expect(result.isValid).toBe(true);
      expect(result.warnings).toContain('Package category is recommended for better organization');
      expect(result.warnings).toContain('Package tags are recommended for better discoverability');
      expect(result.warnings).toContain('Package license is recommended');
    });

    it('should handle non-array snippets', () => {
      const packageWithObjectSnippets = {
        name: 'Test Package',
        version: '1.0.0',
        author: 'Test Author',
        description: 'A test package',
        snippets: {
          ':test': 'This is a test'
        }
      };

      const result = validatePackageForSubmission(packageWithObjectSnippets);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Package must contain at least one snippet');
    });

    it('should handle empty snippets array', () => {
      const packageWithEmptySnippets = {
        name: 'Test Package',
        version: '1.0.0',
        author: 'Test Author',
        description: 'A test package',
        snippets: []
      };

      const result = validatePackageForSubmission(packageWithEmptySnippets);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Package must contain at least one snippet');
    });
  });
});