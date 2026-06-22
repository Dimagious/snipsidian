# Snipsy

[![CI](https://img.shields.io/github/actions/workflow/status/Dimagious/snipsidian/ci.yml?branch=main&label=ci)](https://github.com/Dimagious/snipsidian/actions/workflows/ci.yml)
[![Coverage](https://codecov.io/gh/Dimagious/snipsidian/branch/main/graph/badge.svg)](https://codecov.io/gh/Dimagious/snipsidian)
[![Release](https://img.shields.io/github/v/release/Dimagious/snipsidian)](https://github.com/Dimagious/snipsidian/releases)
![Obsidian ≥ 1.5.0](https://img.shields.io/badge/obsidian-%E2%89%A5%201.5.0-7c3aed)
![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)

> **Type `todo` and a space, get `- [ ]`.** Snipsy is the actively-maintained hotstring plugin for Obsidian — markdown-aware, with a community catalog and Espanso import. No scripting required.

<video src="https://github.com/user-attachments/assets/8e54d0ec-9b86-4741-b697-0a0a981a127b" autoplay muted loop playsinline width="100%">
  <a href="docs/screens/demo.mp4">▶ Watch the 60-second narrated demo</a>
</video>

---

## Why Snipsy

The text-expansion niche in Obsidian has three things wrong with it: the long-standing leader hasn't shipped in four years, the alternatives lean on JavaScript-templating engines, and none of them is aware of markdown context. Snipsy is the simple answer:

- **Actively maintained.** Regular releases, every change passes CI with attested artifacts. 0 vulnerable dependencies on the latest dependency scan.
- **Markdown-aware.** Triggers don't fire inside fenced code blocks, inline code, or YAML frontmatter. Most competitors don't draw that line.
- **No scripting.** If you need JavaScript or dynamic templates, use [Templater](https://github.com/SilentVoid13/Templater) — it's purpose-built for that. Snipsy is for users who want hotstrings with zero setup.
- **Community catalog.** 10 starter packs cover Markdown essentials, daily journaling, GTD, dev boilerplate, code review, research notes, math symbols and more. Install in one click. Or paste any [Espanso Hub](https://hub.espanso.org/) package's YAML.

---

## Try these out of the box

Snipsy ships with these triggers ready to use. Type the trigger followed by a space — Snipsy expands it as soon as the space lands.

| Category | Triggers |
|---|---|
| **Task states** | `todo` → `- [ ]` · `done` → `- [x]` |
| **Markdown inline** | `bold` → `**text**` · `italic` → `_text_` · `code` → `` `code` `` |
| **Headings** | `h1` → `# ` · `h2` → `## ` · `h3` → `### ` |
| **Obsidian callout** | `note` → `> [!note]` with cursor on the body line |
| **Tables** | `table` → 3×3 scaffold |
| **Dynamic** | `today` → today's date · `now` → current time |
| **Conversational** | `brb` → `be right back` · `omw` → `on my way` · `ty` → `thank you` |

Want more? Browse the **community catalog** in **Settings → Snipsy → Packages** — 10 starter packs cover Markdown essentials, daily journaling, GTD, meetings, dev boilerplate, code review, research notes, symbols & math, date stamps. Or paste any Espanso `.yml` from [hub.espanso.org](https://hub.espanso.org/) into the **Espanso import** section.

---

## Quick start

1. **Install** Snipsy from Obsidian's **Settings → Community plugins → Browse**.
2. **Enable** it.
3. **Open a Markdown note** and type `todo` followed by a space. It expands to `- [ ]`.

That's it. Open **Settings → Snipsy** to add your own snippets, browse the catalog, or set up hotkeys.

### Add a snippet

**Settings → Snipsy → Snippets** → **Add new snippet** → pick a trigger (e.g. `sig`) and replacement (e.g. `Best,\nDmitriy`). Save. Now typing `sig` and a space expands to your signature anywhere you type.

### Set up the picker hotkey

The picker is a Command Palette command called **Insert snippet…** — it's searchable, has a live preview, and inserts at the cursor. To set a hotkey: **Settings → Hotkeys** → search "snipsy" → bind.

---

## How expansion works

Snipsy watches for triggers followed by a **separator** — a space, Enter, or common punctuation. When the separator lands, the trigger gets replaced; the separator itself stays exactly where you typed it.

Two ways to invoke (identical result):

```
You type:   todo·
You get:    - [ ]·                ← cursor right after the bracket

You type:   :todo·                ← Espanso-style invocation
You get:    :- [ ]·               ← the leading ":" is your typed character, so it stays
```

The `·` is the trailing space you typed. Most users skip the leading `:` and just type `todo`, but Espanso muscle memory works too — Snipsy treats `:` as a separator, so it bounds the trigger the same way a space does.

Multi-line snippets place the cursor on the right line:

```
You type:   note·
You get:    > [!note]
            > ·                   ← cursor on the body line, ready to type the note
```

What's safe:

- ✅ Triggers don't expand mid-word
- ✅ Triggers don't expand inside fenced code blocks (`` ``` ``)
- ✅ Triggers don't expand inside inline code (`` ` ``)
- ✅ Triggers don't expand inside YAML frontmatter
- ✅ The cursor lands where the snippet defines it (`$|`), with support for `$date` / `$time` / `$filename` / `$clipboard` placeholders and `$1`/`$2` tabstops

---

## Packages

Snipsy has two ways to get pre-made snippets:

**Community catalog.** Hosted at [Dimagious/snipsidian-community](https://github.com/Dimagious/snipsidian-community). Open **Settings → Snipsy → Packages**, browse the list, click Install. Each pack lives in its own group so you can uninstall it later by deleting the group. The current catalog covers:

- **Markdown Essentials** — headings, emphasis, code fences, tables, links
- **Obsidian Power-User** — dataview blocks, frontmatter, embeds, wikilinks
- **Daily Journal** — daily note, weekly review, gratitude, morning pages
- **GTD & Productivity** — project / next-action / waiting-for / context tags
- **Meetings** — meeting notes, 1:1, standup, retrospective
- **Developer Boilerplate** — JS/TS/Python function shells, log shortcuts, try/catch
- **Code Review** — Conventional Comments labels (praise / nit / suggestion / blocking)
- **Research & Academic** — literature notes, claim-evidence, citations
- **Symbols & Math** — arrows, operators, Greek letters, currency
- **Date & Time** — `$date` / `$time` stamps, log entries
- **Obsidian Callouts** — `>note`, `>tip`, `>warning`, `>danger`, etc.
- **Basic Emojis** — common emoji shortcuts (`smile` → 😀, `fire` → 🔥, etc.)

**Espanso import.** Most Espanso packages are plain YAML. Copy the YAML from any package on [Espanso Hub](https://hub.espanso.org/), paste it into **Espanso import**, click Install. Conflicts open a preview so you can resolve them before anything writes to disk.

---

## Privacy

Snipsy is offline-first.

- Reads/writes only `.obsidian/plugins/snipsidian/data.json` in your vault.
- Network: a single request to `api.github.com` when you open the Community packages tab (to list the catalog). No analytics, no telemetry, no account.
- Optional submission flow uses a Google Form (your choice to fill it in).

---

## When Snipsy is NOT the right tool

Be honest: a few jobs are better served elsewhere.

- **Dynamic templates with JavaScript?** Use **[Templater](https://github.com/SilentVoid13/Templater)** — it owns this category.
- **System-wide expansion (in any app, not just Obsidian)?** Use **[Espanso](https://espanso.org/)** — runs as a background process.
- **Just want to retrieve and fuzzy-search snippets without auto-expansion?** **[Snippets Manager](https://github.com/ramandv/obsidian-snippets-manager)** is closer to that use case.

Snipsy fits between these — hotstring-style auto-expansion, inside Obsidian, with a catalog. No more, no less.

---

## Project status

Active. Releases are tag-driven; the [release workflow](.github/workflows/release.yml) attests build provenance for every binary it ships. The [`CHANGELOG.md`](CHANGELOG.md) is a Keep-a-Changelog file maintained on every release.

If something breaks, [open an issue](https://github.com/Dimagious/snipsidian/issues). Bug reports help; "this isn't working" without steps doesn't.

---

## Development

If you're building / contributing, the short version:

```bash
git clone https://github.com/Dimagious/snipsidian.git
cd snipsidian
npm install
npm run build:vault   # build into VAULT_PLUGIN
npm test              # vitest with coverage
```

Set `VAULT_PLUGIN` to your test vault's plugin folder:

```bash
export VAULT_PLUGIN="/path/to/vault/.obsidian/plugins/snipsidian"
```

Full conventions, release flow, and architecture notes live in [`CLAUDE.md`](https://github.com/Dimagious/snipsidian/blob/main/CLAUDE.md) (when present locally; ignored from the repo).

---

## License

[MIT](LICENSE). Use it, fork it, share it.

## Acknowledgments

[Espanso](https://espanso.org/) — inspiration and YAML format. [Obsidian](https://obsidian.md/) — the plugin host. Everyone who's filed a bug or suggested a feature so far.

## Support

If Snipsy saves you keystrokes:

- ⭐ **Star** the repo so others find it.
- 🐛 [**Open an issue**](https://github.com/Dimagious/snipsidian/issues) when something breaks.
