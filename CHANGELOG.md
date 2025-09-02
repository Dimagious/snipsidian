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

