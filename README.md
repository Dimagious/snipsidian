# SnipSidian

SnipSidian is an Obsidian plugin that brings **hotstrings and text snippets expansion** into the editor.

## Features (MVP)
- Define custom triggers → replacements (e.g., `brb` → `be right back`).
- Expand snippets automatically after space, enter, or punctuation.
- Cursor placeholder `$|` (planned).
- Markdown awareness (don’t expand inside code blocks, planned).
- Simple settings UI with JSON-based snippets.

## Roadmap
- [ ] Cursor placeholder `$|`
- [ ] Markdown-awareness
- [ ] Improved Settings UI (table with add/remove rows)
- [ ] Presets (English, Dev/IT, Salesforce, Notetaking)
- [ ] Variables ($date, $time, $clipboard, $filename)

## Installation (development)
1. Clone the repo inside your Obsidian vault:
<Vault>/.obsidian/plugins/snipsidian/

2. Install dependencies:
```bash
npm install
npm run build
```
3. Enable the plugin in Obsidian → Settings → Community plugins.


💡 SnipSidian aims to be more user-friendly and feature-rich compared to existing hotstring plugins.
