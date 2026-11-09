import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Lint for the `integration/` layer (B-219). Kept out of
 * the main `eslint.config.js`: that one is type-aware against the plugin's
 * `tsconfig.json` (src only) and carries the Obsidian scorecard rules, which
 * are about shipped code. This is test infrastructure, so the TypeScript
 * recommended set against its own tsconfig is the right bar.
 *
 *   npm run it:lint
 */
export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { args: 'all', argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
];
