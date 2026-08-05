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
        tsconfigRootDir: import.meta.dirname,
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

      // eslint-plugin-obsidianmd 0.4.x additions (scorecard parity, 2026-08-05):
      // `prefer-window-timers` flipped direction vs 0.1.x — it now demands
      // bare `window.setTimeout`/`window.clearTimeout` and flags
      // `activeWindow.*` timers (popout windows still get a `window` that
      // resolves correctly via the timer's own closure; `activeWindow` was
      // never required for timers specifically, only for DOM/`document`
      // access). See src/ui/utils/ui-state.ts, SnippetPickerModal.ts,
      // SnippetsTab.ts, BasicTab.ts for the flipped call sites.
      'obsidianmd/prefer-window-timers': 'error',
      // Presence-only check: flags PluginSettingTab subclasses missing a
      // getSettingDefinitions() method. See src/ui/components/SettingsTab.ts
      // for why it returns `[]` rather than real per-field definitions.
      'obsidianmd/settings-tab/prefer-setting-definitions': 'error',

      // UI sentence case with custom options
      // Disabled - too many false positives with validation messages, button texts, etc.
      'obsidianmd/ui/sentence-case': 'off',

      // Match the Obsidian scorecard scanner's strict no-unused-vars policy:
      // every declared argument must be used (or prefixed with `_`).
      '@typescript-eslint/no-unused-vars': ['error', {
        args: 'all',
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'all',
        caughtErrorsIgnorePattern: '^_',
      }],

      // Scorecard parity (0.4.1): a Promise returned where a DOM listener
      // (or other void-typed callback) expects `void` silently drops
      // rejections. Requires parserOptions.project (already configured
      // above) for the type information the rule needs.
      '@typescript-eslint/no-misused-promises': 'error',
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
      // e2e/**, e2e-vault.pristine/**, and playwright.config.ts are
      // git-tracked, but outside tsconfig's `include` (`src/**/*.ts`
      // only), so the type-aware rules can't parse them ("file not
      // found in any of the provided project(s)"); none of this code
      // ships in main.js. E2E lint setup (its own tsconfig + config
      // block) is a separate future task.
      // .obsidian-unpacked/** is a local/untracked unpacked-vault
      // artifact, not source.
      '.obsidian-unpacked/**',
      'e2e-vault.pristine/**',
      'e2e/**',
      'playwright.config.ts',
    ],
  },
];

