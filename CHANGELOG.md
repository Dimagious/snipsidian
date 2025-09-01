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
  - **Kaomoji (lite, builtin)** — ¯\\\_(ツ)\_/¯, table flip, etc. *(optional; can be toggled/edited)*

### Changed
- Settings UI: help text with link to Espanso Hub; clearer labels/tooltips.
- Styles: subtle help block, group headers, nicer empty state.

### Removed
- “Install from URL” (disabled due to browser CORS limits on GitHub blob/raw in Obsidian).

### Notes
- Catalog items are small and safe-by-default. Big sets (e.g. full emoji packs) can be installed via **Paste YAML**.
