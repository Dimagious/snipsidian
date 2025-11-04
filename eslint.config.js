import obsidianmd from 'eslint-plugin-obsidianmd';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  // Base JavaScript recommended
  js.configs.recommended,
  
  // TypeScript recommended (without type checking for faster linting)
  ...tseslint.configs.recommended,
  
  // Obsidian plugin rules
  {
    plugins: {
      obsidianmd: obsidianmd,
    },
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: './tsconfig.json',
        // Use import.meta.dirname (ESM) or process.cwd() (CJS) for tsconfigRootDir
        // eslint-disable-next-line no-undef
        tsconfigRootDir: import.meta.dirname || (typeof process !== 'undefined' ? process.cwd() : import.meta.url ? new URL('.', import.meta.url).pathname : ''),
      },
      globals: {
        process: 'readonly',
      },
    },
    rules: {
      // Obsidian recommended rules
      'obsidianmd/commands/no-command-in-command-id': 'error',
      'obsidianmd/commands/no-command-in-command-name': 'error',
      'obsidianmd/commands/no-default-hotkeys': 'error',
      'obsidianmd/commands/no-plugin-id-in-command-id': 'error',
      'obsidianmd/commands/no-plugin-name-in-command-name': 'error',
      'obsidianmd/settings-tab/no-manual-html-headings': 'error',
      'obsidianmd/settings-tab/no-problematic-settings-headings': 'error',
      'obsidianmd/vault/iterate': 'error',
      'obsidianmd/detach-leaves': 'error',
      'obsidianmd/hardcoded-config-path': 'error',
      'obsidianmd/no-forbidden-elements': 'error',
      'obsidianmd/no-plugin-as-component': 'error',
      'obsidianmd/no-sample-code': 'error',
      'obsidianmd/no-tfile-tfolder-cast': 'error',
      'obsidianmd/no-view-references-in-plugin': 'error',
      'obsidianmd/no-static-styles-assignment': 'error',
      'obsidianmd/object-assign': 'error',
      'obsidianmd/platform': 'error',
      'obsidianmd/prefer-file-manager-trash-file': 'warn',
      'obsidianmd/prefer-abstract-input-suggest': 'error',
      'obsidianmd/regex-lookbehind': 'error',
      'obsidianmd/sample-names': 'error',
      'obsidianmd/validate-manifest': 'error',
      'obsidianmd/validate-license': 'error',
      
      // UI sentence case with custom options
      'obsidianmd/ui/sentence-case': ['warn', {
        brands: ['Snipsy', 'SnipSidian', 'GitHub', 'Espanso'],
        acronyms: ['UI', 'API', 'JSON', 'YAML', 'HTML', 'CSS', 'DOM', 'GIF'],
        enforceCamelCaseLower: true,
      }],
    },
  },
  
  // Config files - no type checking
  {
    files: ['*.config.ts', '*.config.js', 'vitest.config.ts'],
    languageOptions: {
      parser: tseslint.parser,
      // No parserOptions.project for config files to avoid parsing errors
    },
    rules: {
      // Disable rules that require type checking for config files
      'obsidianmd/no-plugin-as-component': 'off',
    },
  },
  
  // Ignore patterns
  {
    ignores: [
      'node_modules/**',
      'coverage/**',
      'dist/**',
      'main.js',
      'scripts/**',
      'src/**/*.test.ts',
      'vitest.config.ts', // Exclude from type checking to avoid parsing errors
    ],
  },
];

