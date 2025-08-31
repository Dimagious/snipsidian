# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2025-09-01
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
