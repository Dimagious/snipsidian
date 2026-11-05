# Snipsy

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Dimagious/snipsidian/HEAD/docs/banner-dark.svg">
  <img alt="Snipsy: type a trigger and a space, get the text. Typing note and a space turns into a Note callout (snipsidian)"
       src="docs/banner-light.svg">
</picture>

[![Downloads](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fobsidianmd%2Fobsidian-releases%2Fmaster%2Fcommunity-plugin-stats.json&query=%24.snipsidian.downloads&label=downloads&color=0f9d7a)](https://community.obsidian.md/plugins/snipsidian)
[![Latest release](https://img.shields.io/github/v/release/Dimagious/snipsidian?color=0f9d7a)](https://github.com/Dimagious/snipsidian/releases)
[![Stars](https://img.shields.io/github/stars/Dimagious/snipsidian?color=0f9d7a)](https://github.com/Dimagious/snipsidian/stargazers)

Type `todo` and a space, get a task. Snipsy turns short triggers into text as you write in
Obsidian. **No scripting, and no templates to learn.**

<img alt="Typing h2, todo, today and note, each followed by a space, turns them into a heading, a task, today's date and a callout" src="docs/screens/hero.gif" width="100%">

**Install:** Settings → **Community plugins** → **Browse** → search for **Snipsy**. Then open a
note, type `todo` and a space.

[Website](https://dimagious.github.io/snipsidian/) · [60-second demo](https://github.com/Dimagious/snipsidian/blob/HEAD/docs/screens/demo.mp4) · [Full reference](https://github.com/Dimagious/snipsidian/blob/HEAD/docs/reference.md)

## Why Snipsy

- **It knows Markdown.** Triggers stay as you typed them in code blocks, inline code, math and
  frontmatter.
- **Only your typing fires it.** Paste, undo, another plugin's edit and IME composition expand
  nothing.
- **It works on your phone.** Same snippets, same picker.

<img alt="Typing todo and a space expands into a task in the note, and stays as plain todo inside a code block" src="docs/screens/markdown-aware.gif" width="100%">

## What you can do

**Find a snippet when you forget its trigger.** Run **Snipsy: Insert snippet…** to search
triggers and replacements, preview the result and insert it. You can give it a hotkey.

<img alt="The Insert snippet window: typing meet narrows the list and previews a meeting template, and Enter inserts it into the note" src="docs/screens/picker.gif" width="100%">

**Add your own.** Select text, run **Snipsy: Add snippet from selection** and type a trigger.
Symbols work too, so `->` can become `→`.

**Install a pack.** Twelve packs, one click each: Meetings, Daily Journal, Code Review, Symbols &
Math and more. Each pack gets its own group, so you can mute it or delete it whole.

**Take an expansion back.** Undo removes it in one step. Turn on **Highlight expansions** and
Backspace restores the trigger too.

**Stop accidental expansions.** Mute a group, or turn on prefix mode so only `:todo` expands and
`todo` stays a word.

## Coming from another tool

**Text Snippets.** Its last release was in May 2022. On the Packages page, press **Import** under
**Text Snippets import**. Snipsy shows a preview and copies your snippets into their own group,
without changing anything in Text Snippets. Two differences: Snipsy expands as you type instead of
waiting for Tab, and it has no tab stops.

<img alt="Pressing Import on the Packages page opens a preview of four new snippets. After Apply, typing sig and a space expands into a signature" src="docs/screens/text-snippets-import.gif" width="100%">

**Espanso.** Paste the YAML of a package and name a group. Forms, scripts and other things Snipsy
can't represent are skipped and named.

**Other system-wide expanders.** Espanso, Raycast, Keyboard Maestro and AutoHotkey work in every
app, and Snipsy works only in Obsidian. Pick Snipsy for Markdown awareness and the same snippets on
your phone.

## What ships with it

Sixteen triggers in one group called **Defaults**. Type the trigger, then a space.

| Trigger | Becomes |
|---|---|
| `todo` · `done` | `- [ ] ` · `- [x] ` |
| `h1` · `h2` · `h3` | `# ` · `## ` · `### ` |
| `bold` · `italic` · `code` | `**\|**` · `_\|_` · `` `\|` ``, cursor inside |
| `note` | a `> [!note]` callout, cursor on the body line |
| `table` | a table, cursor in the first cell |
| `today` · `now` | `2026-09-28` · `14:05` |
| `brb` · `omw` · `ty` · `imo` | be right back · on my way · thank you · in my opinion |

Delete any of them. **Settings → Snipsy → Restore default snippets** brings back the missing ones.

## Placeholders

| Placeholder | Becomes |
|---|---|
| `$\|` | where the cursor lands |
| `$1` | the selected text, when you insert from the picker |
| `$date` · `$time` | today · now |
| `{{date:dddd, D MMMM}}` | your own [Moment.js format](https://momentjs.com/docs/#/displaying/format/) |
| `$filename` | the note's file name, with its extension |
| `$clipboard` | what is on your clipboard |

The [reference](https://github.com/Dimagious/snipsidian/blob/HEAD/docs/reference.md#placeholders) has the exact rules.

## What it does not do

- **JavaScript or dynamic templates:** use [Templater](https://github.com/SilentVoid13/Templater).
- **Expansion outside Obsidian:** use [Espanso](https://espanso.org/).
- **Regex triggers, or replacing text inside a word** (`y^2` into `y²`): use
  [Substitutions](https://github.com/BambusControl/obsidian-substitutions).
- **Tab stops that jump between fields.**

## Privacy

No analytics, no telemetry, no account. Snipsy goes online only when you open the Packages page, to
fetch the catalog from GitHub. Your snippets stay in the plugin's `data.json`.

## Questions

<details>
<summary>It keeps expanding <code>now</code> in my sentences</summary>

Delete that snippet, switch off the Defaults group, or turn on prefix mode so only `:now` expands.

</details>

<details>
<summary>My emoji snippets with colons (<code>:smile:</code>) don't expand</summary>

`:` is a separator, so `:smile:` can't be typed as one word. Settings → Snipsy → Snippets shows a
**Fix triggers** button that renames them to `smile` after a preview.

</details>

<details>
<summary>Triggers don't expand on Linux (Wayland)</summary>

Start Obsidian with `--ozone-platform=x11`. If that fixes it, please report it in an issue with your
desktop and input method.

</details>

## If something is wrong, or missing

[Open an issue](https://github.com/Dimagious/snipsidian/issues) with what you typed and what you
got. The feature list is short on purpose, and the fastest way to change it is to say what you
tried to do and could not.

If Snipsy saves you keystrokes, a [star on GitHub](https://github.com/Dimagious/snipsidian) helps
other people find it, and a [coffee](https://buymeacoffee.com/dimagious) says thanks.

**Also by the author:** [Dashy](https://dimagious.github.io/dashsidian/), a dashboard inside an
Obsidian note, built from seven Markdown blocks, with no JavaScript or Dataview.

Development commands are in the [reference](https://github.com/Dimagious/snipsidian/blob/HEAD/docs/reference.md#development).

## License

[MIT](LICENSE) © Dmitriy Yurkin
