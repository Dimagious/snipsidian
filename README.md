# Snipsidian

[![CI](https://img.shields.io/github/actions/workflow/status/Dimagious/snipsidian/ci.yml?branch=main&label=ci)](https://github.com/Dimagious/snipsidian/actions/workflows/ci.yml)
[![Coverage](https://codecov.io/gh/Dimagious/snipsidian/branch/main/graph/badge.svg)](https://codecov.io/gh/Dimagious/snipsidian)
[![Release](https://img.shields.io/github/v/release/Dimagious/snipsidian)](https://github.com/Dimagious/snipsidian/releases)
![Obsidian ≥ 1.5.0](https://img.shields.io/badge/obsidian-%E2%89%A5%201.5.0-7c3aed)
![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)
![TypeScript](https://img.shields.io/badge/typescript-5.x-3178c6)
![Vitest](https://img.shields.io/badge/tests-vitest-6b46c1)
![esbuild](https://img.shields.io/badge/bundler-esbuild-fbbf24)
[![Buy Me A Coffee](https://img.shields.io/badge/buy%20me%20a%20coffee-☕-ff813f?logo=buy-me-a-coffee&logoColor=white)](https://buymeacoffee.com/dimagious)

Snipsidian is an Obsidian plugin that brings **hotstrings / text snippets expansion** to the editor — with folders, bulk editing, and Espanso-compatible packages.

## Demo
![Snipsidian demo](docs/screens/demo.gif)

## How to install
1. Open **Settings → Community plugins** in Obsidian and disable Safe Mode.
2. Click **Browse**, search **SnipSidian**, and **Install**.
3. Toggle the plugin **ON**.
4. Open **Settings → SnipSidian** to configure snippets.

## Features

- **Triggers → replacements** (e.g., `brb` → `be right back`).
- **Auto-expand** after space, Enter, or punctuation.
- **Folders (groups):** organize snippets; rename/delete folders; move items between folders.
- **Selection mode:** multi-select with checkboxes, per-group “Select all”, floating bar for **Bulk delete** and **Move**.
- **Install packages (Espanso-compatible):**
  - Built-in curated catalog (Obsidian callouts, Markdown basics, arrows, etc.).
  - Paste YAML from Espanso Hub (`package.yml`), install into a chosen folder.
  - Conflict preview modal when needed.
- **Import/Export JSON**, **Reveal `data.json`** (desktop), and **merge defaults**.
- **Nice UI details:** expand/collapse all, persistent open/closed state of folders, responsive modals.

## Why SnipSidian?

- Smooth **bulk management** (select, move, delete) right inside Settings.
- **Folders with human-readable names** in the UI; under the hood, triggers are stored with a slugged prefix (`folder/trigger`) for portability.
- **Espanso-compatible** ingest: reuse community packages without leaving Obsidian.

## Quick start

1. Open **Settings → Community plugins → SnipSidian**.
2. In **Snippets**:
   - Create a snippet: type a **trigger** and **replacement**.
   - Use the **folder dropdown** to organize snippets; or select several and click **Move to…**.
3. Use **Selection mode** to bulk delete or move:
   - Toggle **Selection mode**, tick checkboxes (or use a group “Select all”), then **Delete** or **Move to…**.
4. Install packages:
   - **From catalog**: pick a package, adjust the folder label, click **Install**.
   - **From YAML**: paste the contents of `package.yml` from Espanso Hub, set a folder label, **Install pasted YAML**.

## Expansion rules (current)

- Expands after **space / Enter / punctuation**.
- Treats **word boundaries** conservatively (avoid false positives).

## Data & sync

All snippets are stored in your vault at:

```
.obsidian/plugins/snipsidian/data.json
```

They sync with your vault. Foldered snippets are saved under `folder/trigger` keys (e.g., `obsidian-callouts/warn`).

## Development

### Local build into your vault

1. Set the env var once (macOS zsh example):
   ```bash
   echo 'export VAULT_PLUGIN="<path-to-your-vault>/<your-vault>/.obsidian/plugins/snipsidian"' >> ~/.zshrc
   source ~/.zshrc
   ```
2. Install deps & build:
   ```bash
   npm install
   npm run build:vault     # builds main.js/styles/manifest straight into your vault
   ```
3. For watch mode:
   ```bash
   npm run dev:vault
   ```
4. In Obsidian: **disable → enable** the plugin to reload.

> Alternatively, `npm run build` produces `main.js` in the repo root; copy it to the plugin folder manually.

## Screenshots

## Screenshots

**Settings – package install (catalog & YAML)**
![Settings / packages](docs/screens/settings.png)

| Snippets manager                       | Selection mode                                |
| -------------------------------------- | --------------------------------------------- |
| ![Snippets](docs/screens/snippets.png) | ![Selection](docs/screens/selection-mode.png) |

## Roadmap

- Variables (`$date`, `$time`, `$clipboard`, `$filename`)
- Presets for English / Dev/IT / Salesforce / Notetaking

## Contributing

PRs welcome! Please keep changes small and focused. For feature ideas, open an issue first.

## License

MIT

## Coverage

- Online report: **Codecov** → https://codecov.io/gh/Dimagious/snipsidian  
- Local HTML: `npm run coverage` (отчёты в `coverage/` → открой `coverage/index.html`)

