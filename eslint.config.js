import { obsidianPlugin } from 'obsidian-plugin-dev-kit/eslint';

// The lint config is the kit's: eslint-plugin-obsidianmd's `recommended` preset
// (which carries ESLint's recommended rules and typescript-eslint's
// type-checked ones), with `prefer-window-timers`, `prefer-setting-definitions`
// and the unused-variable policy of the community scanner as errors. Run with
// `--max-warnings=0`, so a warning from the preset fails the run too.
export default [
  ...obsidianPlugin({
    rootDir: import.meta.dirname,
    ignores: [
      // .claude/** is the git-excluded local assistant workspace (probe
      // scripts, notes); never shipped, never linted.
      '.claude/**',
      // Playwright output, gitignored; minified trace-viewer JS.
      'test-results/**',
      'playwright-report/**',
      // Integration layer (B-219): its own tsconfig and lint config
      // (`npm run it:lint`), outside this project's tsconfig.
      'integration/**',
      // Test scaffolding: the fake Obsidian, the DOM shim, the fake vault and
      // the factories. None of it is bundled, and the plugin preset's rules
      // have no meaning for code that stands in for the host.
      'src/test/**',
    ],
  }),
  {
    files: ['**/*.ts'],
    rules: {
      // The preset leaves this off in favour of obsidianmd/no-nodejs-modules,
      // which only warns. The plugin runs on phones: no `require` belongs in it.
      '@typescript-eslint/no-require-imports': 'error',
    },
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      // Snipsy kept UI text in sentence case on purpose (B-153, B-180), with the
      // strict option it had under obsidianmd 0.4.1; the 0.5.x preset turns the
      // rule off. It reports nothing in src today.
      'obsidianmd/ui/sentence-case': ['error', { enforceCamelCaseLower: true }],
      // Snipsy's own scorecard gate (the retired scripts/scorecard-check.cjs)
      // failed on a bare `window.<member>` besides `window.open` and the timer
      // functions, which the preset's rules do not cover: a bare `window`
      // belongs to the main window and breaks in a popout, where
      // `activeWindow` is the right one. `opdk scan` does not check it either.
      'no-restricted-syntax': ['error', {
        selector: "MemberExpression[object.name='window'][property.name!=/^(open|setTimeout|clearTimeout|setInterval|clearInterval|requestAnimationFrame)$/]",
        message: 'A bare `window.*` breaks in popout windows. Use `activeWindow.*` (`window.open` and the timer functions are the only exceptions).',
      }],
    },
  },
];
