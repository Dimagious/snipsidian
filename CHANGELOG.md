# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2025-08-31

### Added

- Initial plugin skeleton with `manifest.json`, `main.ts`, `package.json`.
- Interactive snippets manager UI: add, edit, delete snippets.
- Export/Import snippets as JSON.
- Reveal `data.json` in file manager (desktop only).
- Automatic expansion of triggers on space/enter/punctuation.
- Default snippets (Markdown/Obsidian and general productivity).
- Modular structure: core expander, settings UI, presets, types.

### Changed

- Comments translated to English and simplified.
- Deep-merge defaults with user snippets, added "Add missing defaults" action.

### Fixed

- Correct cursor placement after expansion using `EditorPosition`.

## [0.2.0] - 2025-09-01

### Added

- Espanso-compatible packages: install from built-in catalog or paste YAML.
- Built-in package catalog (curated for Obsidian):
  - **Obsidian Callouts (builtin)** — quick callout blocks (`> [!note]`, `> [!tip]`, …).
  - **Markdown basics (builtin)** — code fence, quote, todo (was present; moved to catalog).
  - **Markdown tables (builtin)** — 3×3 table scaffold.
  - **Unicode arrows (builtin)** — → ← ↑ ↓ and shortcuts.
  - **Math symbols (lite, builtin)** — ± × ÷ ≤ ≥ ≠ ≈ µ ° ∞.
  - **Kaomoji (lite, builtin)** — ¯\\\_(ツ)\_/¯, table flip, etc. _(optional; can be toggled/edited)_

### Changed

- Settings UI: help text with link to Espanso Hub; clearer labels/tooltips.
- Styles: subtle help block, group headers, nicer empty state.
- **Package preview modal:** improved layout and readability:
  - Added spacing between buttons.
  - Monospace font and padding for snippet text.
  - Hover highlight for conflict rows.
  - Footer separated with border and spacing.

### Notes

- Catalog items are small and safe-by-default. Big sets (e.g. full emoji packs) can be installed via **Paste YAML**.

## [0.3.0] - 2025-09-02

### Added
- Selection mode: checkboxes on rows and groups; per-group “Select all”; floating action bar.
- Bulk delete: remove all selected snippets with confirmation and a live counter.
- Move snippets:
  - Bulk move to a new or existing folder via the “Move to…” modal.
  - Per-row move using a dropdown (“Ungrouped” / existing groups / “New group…”).
- Group management: rename a folder; delete a folder (with an option to move its contents).
- Expand/Collapse all and persistent open/closed state of groups across sessions.

### Changed
- Catalog/YAML installs now go into nicely named folders (label → slug); the UI shows human-readable names.
- Modals are responsive: “Move to…” no longer overflows horizontally; the preview table scrolls inside.

### Fixed
- Selection is preserved when renaming or moving snippets.

## [0.4.0] - 2025-09-02

### Added
- **Modular architecture**: split into `app/`, `engine/`, `adapters/`, `store/`, `importers/`, `shared/`, `core/`. Clear boundaries; most logic moved into small pure modules.
- **Test suite (Vitest + jsdom)** with high coverage for engine, core expander, adapters, store, importers, and shared utils.
- **CI (GitHub Actions)**: typecheck (`tsc --noEmit`), unit tests with coverage, Codecov upload, release bundle build, artifacts.
- **Release workflow** on tags `v*`: build `main.js`, pack ZIP, auto-create GitHub Release and attach assets.
- **Badges & docs**: CI/Codecov/Release/stack badges in README; coverage section.
- **Funding links**: Sponsor/Buy Me a Coffee hooks added (README + repo).
- **Dev scripts**: 
  - `scripts/assert-versions.cjs` (checks `package.json` vs `manifest.json`),
  - `scripts/version-sync.cjs` (quick bump & sync),
  - `scripts/make-zip.cjs` (release ZIP).

### Changed
- **Thin entry**: `main.ts` now delegates to `app/plugin.ts`; esbuild keeps `obsidian`/CM6 externals.
- **Importers**: Espanso/catalog moved from `packages/` to `src/importers/…`.
- **Utilities**: refactor/organize helpers (`normalizeTrigger`, `isBadTrigger`, `splitKey/joinKey`, `slugifyGroup`, `displayGroupTitle`) and shared markdown/delimiters.
- **Type safety**: add `tsconfig.json`, `@types/js-yaml`; stricter CI typecheck.

### Fixed
- Hardened expansion/guards around inline & fenced code and YAML frontmatter (covered by tests).
- Prevent version drift on releases via version-consistency check.

## [0.4.1] - 2025-09-02

### Fixed
- Release bundle now built as **CommonJS** with an interop footer so Obsidian can construct the plugin class correctly.  
  No more “TypeError: h is not a constructor” on load.

### Changed
- Build scripts unified for CI and local vault builds (consistent flags).
- Docs: clarify plugin folder name (`snipsidian`) for manual installs.

## [0.4.2] - 2025-09-03

### Added
- Demo GIF in README to showcase one-click catalog install, callouts, and symbolic triggers.

### Changed
- Delimiters: -, /, \, | are no longer treated as separators (enables ->, <-, etc.); double and single quotes added to the separator set for better Markdown behavior.
- Runtime dictionary: engine now compiles the dict from grouped keys, so groups are UI-only and do not affect matching.
- Settings UX: edits no longer save & resort on every keystroke; changes are debounced and saved on blur—no flicker, no focus loss.

### Fixed
- Symbolic & structural triggers: -> → →, info → callout now expand reliably; token detection scans left to the nearest separator instead of relying on \w boundaries.
- Markdown awareness: sturdier checks for fenced code/inline code/frontmatter to avoid false positives.
- Tests updated to reflect the new delimiter contract.

## [0.5.0] - 2025-09-03

### Added
- **Emoji (lite, builtin)** — ~120 most popular emojis.
- **Task states (builtin)** — task states (`- [ ]`, `- [x]`, doing, waiting, canceled, etc.).
- Extended:
  - **Markdown basics** (bold, italic, headings, links).
  - **Obsidian Callouts** (summary, question, success, error, etc.).

### Changed
- Package catalog (`PACKAGE_CATALOG`) is now sorted alphabetically by `label` for convenience.

## [0.8.0] - 2025-09-11

### Added
- **🎯 Snippet Picker Command** - New "Insert Snippet…" command for quick snippet search and insertion
  - Real-time search by trigger or replacement text
  - Live preview of snippet content with placeholder highlighting
  - Keyboard navigation support for accessibility
  - Smart cursor placement and tabstop detection
- **⚙️ Commands Section** in Basic settings tab with hotkey configuration
  - "Set Hotkey" buttons for both main commands
  - Direct navigation to Obsidian's hotkey settings
  - Auto-scroll to specific commands for easy configuration
- **📦 Built-in Markdown Package** with comprehensive markdown snippets
- **🔧 Enhanced Editor Integration** with improved snippet insertion
  - Better handling of selected text wrapping
  - Improved cursor positioning after insertion
  - Robust error handling for edge cases

### Changed
- **🎨 Unified Green Styling** across all settings tabs
  - All sections now use consistent green theme (`var(--color-green)`)
  - Removed emoji icons from all sections for professional appearance
  - Clean, modern interface design throughout
- **📁 Collapsed Groups by Default** - Snippet groups start collapsed to reduce visual clutter
- **🏗️ Enhanced Architecture** with new core services
  - `SnippetPickerAPI` for snippet management
  - `getAllSnippetsFlat` function for efficient data access
  - Improved type definitions (`SnippetItem`, `SnippetSearchQuery`)

### Fixed
- **🐛 UI Initialization Error** - Resolved "Cannot access section before initialization" in BasicTab
- **🔧 TypeScript Errors** - Fixed CI compilation issues with proper type handling
- **📝 Code Quality** - Translated all Russian comments to English for consistency

### Technical Improvements
- **🧪 Test Coverage** - All 119 tests passing with 91.89% coverage
- **📦 Build Optimization** - Maintained efficient bundle size
- **🔒 Type Safety** - Enhanced TypeScript configuration and error handling

### Notes
- **Command Palette Integration** - Both commands are now available in Obsidian's Command Palette
- **Backward Compatibility** - All existing functionality preserved
- **Performance** - No impact on existing snippet expansion performance

## [0.7.0] - 2025-01-XX

### Added
- **Enhanced TypeScript configuration** with stricter type checking (`noImplicitAny`, `noUncheckedIndexedAccess`)
- **Comprehensive test coverage** for core expander with 13 new test cases covering edge cases
- **Modular UI architecture** with separated components for better maintainability

### Changed
- **Settings UI refactored** into modular components (BasicTab, PackagesTab, SnippetsTab)
- **Catalog module extracted** from packages into dedicated `src/catalog/` module
- **Improved type safety** throughout the codebase with reduced `any` usage
- **Enhanced test coverage** for `src/core/expander.ts` (92.68% coverage)

### Fixed
- **TypeScript compilation errors** resolved with proper nullish coalescing and type annotations
- **Import path consistency** after architectural refactoring

### Notes
- All user-facing functionality remains unchanged
- Focus on code quality, maintainability, and architectural improvements
- Build size optimized to 76.6kb

## [0.6.0] - 2025-09-05

### Changed
- **Settings UI redesigned** in a Copilot-like style with tabs (Basic / Packages / Snippets):
  - Larger header title for clarity.
  - Removed **Advanced** tab (was placeholder-only).
  - **Packages**:
    - Simplified *Install from catalog*: dropdown + single **Install** button.  
      Removed confusing overwrite toggle and folder rename option — packages now install into fixed folders by label.
    - Simplified *Install from YAML*: cleaner three-column layout (folder label / YAML textarea / install button).  
      Removed overwrite toggle for clarity.
  - **Snippets**:
    - Removed redundant "Snippets" heading at the top of the tab.
    - Group actions (**Rename**, **Delete group**) are now aligned to the right for consistency.
- Polished spacing, alignment and layout across sections for a cleaner look.

### Notes
- All snippet management logic, package install behavior, and export/import functionality remain unchanged.  
  This release focuses purely on improving usability and consistency of the settings panel.

