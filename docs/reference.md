# Snipsy reference

Everything the [README](../README.md) leaves out: exact rules, edge cases, every import detail.

## Where triggers stay quiet

- **It reads markdown.** A trigger inside a fenced code block, inline code, math (`$…$`, `$$…$$`) or YAML
  frontmatter stays as you typed it. So does a trigger in the middle of a word.
  A `$` directly followed by a letter or symbol opens math (prices like `$5` don't) until the closing `$` on that line, or to the end of the line
  if there is none, so triggers don't expand there (`$HOME` in prose stops expansion for the rest of that
  line); write `\$` for a literal dollar.
- **Only your typing fires it.** Pasting text that ends in `todo `, undo, redo, drag and
  drop, another plugin's edit, IME composition for Chinese, Japanese or Korean: none of these
  expand anything.

## Commands and settings

For the snippets you do not remember by name, run **Snipsy: Insert snippet…** from the command
palette. It searches triggers and replacements, previews the result, and inserts at the cursor.
Select some text first and `$1` in the snippet receives it. **Settings → Snipsy → Set hotkey
for Insert snippet** opens the Hotkeys tab already filtered to that command.

**Snipsy: Expand trigger at cursor** expands the trigger that ends right at the caret, without
typing a separator. It follows the same rules as typing (code, math, frontmatter, prefix mode,
disabled groups), and it tries pattern rules that fire After a separator when no trigger matches
(see [Patterns](#patterns)). When there is no trigger at the caret but a field session is open, it jumps to the
next field, so one hotkey can do both. Otherwise it does nothing and shows nothing. It has no default
hotkey; assign one in Obsidian's Hotkeys. It expands only when the caret is at the end of the
trigger: inside a word (`sig|nature`) nothing happens, the next character has to be a separator or the
end of the line. **Snipsy: Next field** jumps to the next field of an open
session, for devices without a Tab key (add it to the mobile toolbar); with no session open it does
nothing. It has no default hotkey either.

To turn text you already wrote into a snippet, select it and run **Snipsy: Add snippet from
selection**. The Add snippet window opens with the replacement filled in from your selection;
type a trigger and save. The note is not changed.

On Obsidian 1.13 and later, Snipsy's settings are native: **Snippets**, **Patterns** and
**Packages** open as pages, everything else sits right on the Snipsy settings screen, and
Obsidian's settings search finds them ("prefix", "hotstring", "export", "pattern"). On
older Obsidian the same settings are grouped into Snippets, Patterns, Packages, General and About
tabs.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Dimagious/snipsidian/HEAD/site/img/settings-root-dark.png">
  <img alt="Snipsy settings on Obsidian 1.13: Snippets and Packages entries with their counts, then the Expansion group" src="../site/img/settings-root-light.png" width="600">
</picture>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Dimagious/snipsidian/HEAD/site/img/picker-dark.png">
  <img alt="The Insert snippet picker: the query da, seven matching triggers with their groups, and a preview of the selected one" src="../site/img/picker-light.png" width="560">
</picture>

## How expansion works

A trigger expands when a separator lands after it: a space, Tab, Enter, or one of
`. , ! ? ; : ( ) [ ] { } " '`. The separator stays where you typed it.

```
You type:   todo·
You get:    - [ ] ·
```

`·` is the space you typed. Undo right after an expansion takes back the trigger and the
expansion together, in one step.

### Prefix mode

If `now` or `today` keeps turning into a time in the middle of your sentences, you have three
answers. Delete that one snippet. Switch off the whole Defaults group with the toggle on its
header. Or turn on **Require a prefix before triggers** under **Settings → Snipsy → Expansion**: from
then on `todo` stays a word, and only `:todo` (or `;todo`, your pick) expands. The prefix is
eaten by the expansion. It is one switch for every snippet, off by default.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Dimagious/snipsidian/HEAD/site/img/prefix-dark.png">
  <img alt="Expansion settings: Require a prefix before triggers is on, prefix character colon" src="../site/img/prefix-light.png">
</picture>

### Highlight expansions

Turn on **Highlight expansions** under **Settings → Snipsy → Expansion** (off by default) and every
expansion gets a dotted underline (the background flash is brief; the underline stays until you move the caret or type). While the mark is there, **Backspace** takes the
expansion back: `be right back·` turns into `brb·` exactly as you typed it (the space or punctuation
included), and the restored trigger does not expand again. Backspace is a normal Backspace as soon as
you move the caret, click, type or paste anything, so it never eats a character you meant to delete. Undo is not offered when Enter ends the trigger and
Obsidian continues a list or indentation on the new line. A snippet with fields (two or more of
`$1`..`$9`) gets no underline and no Backspace-undo: the caret moves into its first field at once,
which would clear the mark. Undo (Cmd/Ctrl+Z) still takes it back.

## Your own snippets

**Settings → Snipsy → Snippets → Add snippet.** Trigger `sig`, replacement:

```
Best,
Dmitriy
```

Save, and `sig` followed by a space is your signature in every note.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Dimagious/snipsidian/HEAD/site/img/add-snippet-dark.png">
  <img alt="The Add snippet dialog: trigger :sig with the hint Will expand when you type: sig, and a two-line replacement" src="../site/img/add-snippet-light.png" width="520">
</picture>

### Trigger characters

A trigger can hold letters, digits, `_`, a leading `:`, and the symbols `- < > = + ~ * ^ | &`, so
`->`, `<=` or `--` work as triggers. Spaces, the separators listed above, `/`, `\` and `$` are not
allowed. A trigger still has to stand on its own: `--` expands on `--·` but not inside `---`.
A single `-`, `+`, `*`, `>` or `|` is not allowed either, since it would rewrite Markdown lists, quotes
and tables.

### Placeholders

| Placeholder | Becomes |
|---|---|
| `$\|` | where the cursor lands after expanding; with fields, the last stop Tab reaches |
| `$1`..`$9` | fields, see [Fields](#fields-tab-stops). From the picker over a selection, the first `$1` receives the selected text. A snippet with a single `$1` (and no other field) puts the caret there: `[$1](url)` puts the caret between the brackets, no Tab needed. Not a field: `$1` followed by a letter, digit or `_` (`$10`, `$1x`, `$1é`), by `.` or `,` and a digit (`$1.50`, `$1,000`), or inside a code block or `inline code`. `$5 each` is still a tabstop, so write `\$5` for a literal dollar amount |
| `$date` | today, `YYYY-MM-DD` |
| `$time` | now, `HH:mm` |
| `{{date}}`, `{{time}}` | today / now in `YYYY-MM-DD` / `HH:mm`, the same tokens as core Templates |
| `{{date:FORMAT}}`, `{{time:FORMAT}}` | your own [Moment.js format](https://momentjs.com/docs/#/displaying/format/), e.g. `{{date:dddd, D MMMM}}` gives `Tuesday, 2 September`; wrap literal text in `[ ]`. An empty format (`{{date:}}`) uses the default |
| `$filename` | the current note's file name, **with** its extension (`Meeting.md`) |
| `{{title}}` | the current note's name **without** its extension (`Meeting`; `v1.2 notes.md` gives `v1.2 notes`). Empty when no note is open |
| `{{notedate}}`, `{{notedate:FORMAT}}` | the date in the note's **name**, written in `FORMAT` (a [Moment.js format](https://momentjs.com/docs/#/displaying/format/); `YYYY-MM-DD` when empty or missing): in the note `2026-12-31`, `{{notedate:GGGG-[W]WW}}` gives `2026-W53`. The name is read with the date format of the core Daily notes plugin (Settings, Daily notes, Date format; `YYYY-MM-DD` when none is saved), and the whole name has to match it. A format with folders (`YYYY/MM/DD`, `YYYY/MMMM/YYYY-MMM-DD`) is matched against its last part, the file name (`DD`, `YYYY-MMM-DD`). When the name is not a date in that format, the result is empty, like `{{title}}` with no note. The Daily notes plugin does not need to be switched on, but its format is only re-read when a note is opened, so open any note after changing it |
| `$clipboard` | what is on your clipboard at that moment |

### Fields (Tab stops)

Give a snippet two or more fields, `$1` to `$9`, and Tab walks through them: `[$1]($2)` expands
to `[]()` with the caret between the brackets; type the text, press Tab, type the address, press
Tab again and the caret leaves the snippet.

- **Order:** ascending number, and left to right for equal numbers. Each `$N` is its own stop: the
  same number twice is two stops, not one mirrored field.
- **Last stop:** the `$|` of the snippet. Without one, the caret ends up where it would be with no
  fields at all: right after the inserted text for **Expand trigger at cursor** and the picker, and
  after the separator you typed (the space, or the start of the next line after Enter) when the
  snippet expanded as you typed. Tab from the last field goes there and ends the session.
- **Keys:** Tab next, Shift+Tab previous (it stays on the first), Escape ends the session. These
  keys are taken only while a session is open, so a list item still indents on Tab and other plugins
  keep their Tab. Clicking or arrowing out of the fields ends the session too, and
  expanding a snippet with fields replaces it (a plain or one-field snippet expanded inside the
  current field keeps it); switching to the Command Palette or another app does not. Typing inside a field makes it longer; going back to a field you filled selects its
  text.
- **Look:** an empty field shows as a small underlined slot, a filled one with a soft background.
  Nothing is written into the note, and nothing is left behind when the session ends.
- **One field is not a session:** a snippet with a single `$1` behaves as before, the caret lands
  there and Tab is not involved. Combine it with `$|` and `$|` wins.
- **Picker:** inserting over a selection puts the selection into the first `$1`; the session starts
  at the next field.
- **No keyboard:** run **Snipsy: Next field** from the toolbar or a hotkey.

### Groups

Every snippet lives in a group. Packs and imports each get their own, so a whole pack comes
out the way it went in: delete its group. The toggle on a group's header mutes it without
deleting anything: its snippets stop expanding and leave the picker, and stay in the list,
dimmed, for when you want them back. Selection mode moves or deletes many at once; a delete
names the first five triggers before it asks.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Dimagious/snipsidian/HEAD/site/img/groups-dark.png">
  <img alt="The Snippets page: the Callouts group muted and dimmed, three Meetings snippets selected with Move to group, Delete and Clear" src="../site/img/groups-light.png" width="600">
</picture>

## Patterns

A trigger is a fixed word. A **pattern** is a regular expression that has to end at the caret, so
it can match a shape instead: `1/2`, `-->`, `:work:`, `mtg Bob`. Patterns live on their own page,
**Settings → Snipsy → Patterns**: add, edit, turn off, reorder (drag the handle, Alt+Up and
Alt+Down, or the menu) and delete rules. A literal trigger is still the right tool for a plain
word; a pattern is for what a trigger cannot say (`/` is not allowed in a trigger, for one).

| Pattern | Replacement | Fires |
|---|---|---|
| `/\b1\/2$/` | `½` | After a separator: `1/2` and a space |
| `/-->$/` | `→` | Instant: as the `>` is typed |
| `/:(\w+):$/` | `#{{1}}` | After a separator: `:work:` and a space gives `#work` |
| `/mtg (\w+)$/i` | `Meeting with {{1}} at $1 about $2` | After a separator: `mtg Bob` and a space |

### Writing a pattern

A rule is written `/body$/flags`, as in JavaScript.

- The body must end with an unescaped `$`. The match has to end exactly at the caret (or at the
  separator you typed, for a rule that fires After a separator); the body is checked as a whole,
  so `/cat|dog$/` anchors both words.
- The only flag is `i` (ignore case). Any other, `g` and `u` included, is refused.
- The body is at most 200 characters.
- Snipsy looks at the last 64 characters of the line before the caret, plus 16 characters of
  context so `\b` and a fixed lookbehind do not see a false line start. A rule that uses
  `^` is skipped when that window does not reach the start of the line.
- A pattern that can match empty text (`/a*$/`) is refused, because it would fire on every key.
- Prefix mode does not apply to patterns: a pattern is already written for exactly the shape it
  matches.

### The replacement

| Writes | Becomes |
|---|---|
| `{{0}}` | the whole match |
| `{{1}}` to `{{9}}` | what group 1 to 9 matched; empty when that group did not take part, or the pattern has no such group (the editor warns about the second case) |
| `{{name}}` | what the named group `(?<name>...)` matched. A name that is no group of the pattern stays as written |
| `$\|`, `$1` to `$9`, `$date`, `$time`, `$filename`, `$clipboard`, `{{date:FMT}}`, `{{title}}`, `{{notedate:FMT}}` | the same as in a snippet, see [Placeholders](#placeholders) |

`$1` is a Tab stop (a [field](#fields-tab-stops)), not a capture. Captures are written `{{1}}`, so
the two never mix. The editor says so under the replacement field.

Captured text is inserted last and literally. If the text you captured is `$1`, `$|` or
`{{date}}`, it stays text; it does not become a field, the caret or a date. Fields and the caret
land in the right place around what was captured.

The names `date`, `time`, `title` and `notedate` cannot be group names. The replacement is at most
10,000 characters. In a literal snippet `{{1}}` is plain text, as before.

### Two modes

Each rule has a **Fires** setting:

- **Instant** (the default for a new rule). Tried after every character you type. The match must
  end at the caret, so `/\b1\/2$/` fires at `1/2`. Needs **Expand while typing** to be on (the General
  settings); the editor says so when it is off. The typed character has to be one the
  rule can end with, or the rule is not even run.
- **After a separator**. Tried like a literal trigger: when you type a separator (a space, Enter
  or punctuation, see [How expansion works](#how-expansion-works)), or run **Expand trigger at
  cursor**. The rule reads the line before the separator, and the separator stays where you typed
  it. This is the mode for `1/2` when you also want to type `1/23`: an instant rule fires at `1/2`
  and leaves the `3` behind, and **Try it** shows that (`½3`).

An Instant rule has a stricter limit than the other mode (see [What a pattern cannot
be](#what-a-pattern-cannot-be)), because it runs after every key. When a rule hits it, the editor
tells you to switch it to After a separator.

### Order

On every keystroke Snipsy tries, in this order:

1. **Literal snippets.** A pattern never beats a literal trigger.
2. **Pattern rules, top to bottom** whatever their mode. The first match wins and the rest are not
   tried. Reorder the list to change who wins.

Patterns are also tried when the literal lookup found nothing. `:`, `.`, `(` and `)` are
separators, so a rule such as `/:(\w+):$/` leaves an empty literal candidate; it fires on the next
separator after the closing colon.

An expansion is not scanned again in the same keystroke. The inserted text is seen by the next
one, so `<<` into ≪ and then `≪<` into ⋘ both work.

### Tab and Expand trigger at cursor

**Expand trigger at cursor** and, with **Expand on Tab** on, the Tab key try a literal trigger
first and then the rules that fire After a separator. So does **Run snippet replacement**, the
command alias of the Text Snippets build. Instant rules do not run there, and with **Expand while
typing** off they stop running as you type as well, so a rule list meant for Tab should be set to
After a separator.

With Tab or Run snippet replacement and the caret inside a word, the rule reads the line up to the end of the word, and counts only
when its match starts at or before the caret. A match that lies wholly after the caret is left
alone, the rules below it are not tried either (the first matching rule owns the word), and Tab
passes through.

### Auto-pairing

If Obsidian's **Auto-pair brackets** or **Auto-pair Markdown syntax** is on, the editor inserts a
closing character when you type an opening one.

- An instant rule that ends in a paired character, such as `/\(c\)$/i` or `/\*x\*$/`, fires when
  you type the closing character. Only a closer the editor just inserted for you counts; arrowing
  or clicking onto another `)` does not. Literal snippets and After a separator rules are not
  tried on that step.
- A rule that ends in the opener, such as `/:\($/`, runs as the pair is inserted and takes the
  inserted closer with it, in the same undo step. The text is what the same typing gives with
  auto-pairing off.

### Undo

An expansion is its own undo step: Cmd/Ctrl+Z gives back exactly what you typed. With
[Highlight expansions](#highlight-expansions) on, Backspace restores the matched text for both
modes, and the restored text does not expand again.

### Where patterns stay quiet

The same places as a trigger: fenced code, inline code, math and frontmatter, and anything that
is not your own typing (paste, undo, drag and drop, another plugin's edit, IME composition).
Rules in a muted [group](#groups-and-the-typography-set) are skipped.

### What a pattern cannot be

Every rule goes through one check before it is compiled, whichever way it got in: the editor,
JSON import, Espanso import, sync or a hand-edited `data.json`. A rule that fails is switched off
alone, with its reason shown on the page; your other rules keep working. The reason is that a
JavaScript regular expression cannot be interrupted once it runs, so the shapes that can take
exponential time are refused up front. What is refused:

- **No trailing `$`**, or a pattern not written between slashes.
- **A flag other than `i`**, including `u`. Emoji still work as plain text outside `[ ]`.
- **Backreferences** (`\1`, `\k<name>`) and **lookahead** (`(?=...)`, `(?!...)`). Nothing follows
  the caret yet.
- **Lookbehind** that holds a repeat, or that holds more than 8 characters or groups in all of
  the pattern's lookbehinds together. A short fixed lookbehind such as `(?<= )--$` is fine.
- **Unicode property classes** such as `\p{L}`, in or out of a class. Use `\w` or a range like
  `[а-яё]`.
- **Emoji inside `[ ]`**, a repeat directly after an emoji (`😀+`), and a backslash before an
  emoji. Write the emoji as plain text, or in a group: `(?:😀)+`.
- **Escapes outside the allowed set.** Allowed: `\d \w \s` and `\b` with their negations
  `\D \W \S \B`, `\n \r \t \f \v`, `\0`, `\xHH`, `\uHHHH`, and a backslash before a symbol.
  Octal escapes, `\c` and every other escaped letter are refused.
- **Group syntax** other than `(...)`, `(?:...)`, `(?<name>...)` and lookbehind.
- **A repeated group that holds a repeat or a choice**: `(a+)+`, `(a|aa)*`, `(\w+\s?)+`.
- **Too many open-ended repeats** (`*`, `+`, `{n,}`): at most 2, and at most 1 for an Instant
  rule.
- **Too many optional, ranged or alternating parts** next to them (`?`, `{n,m}`, `(a|b)`).
- **A pattern that can match empty text.**
- **A reserved group name**, or a group name written with an escape.
- **A body over 200 characters**, a **replacement over 10,000**, or more than **100 rules**.

### The runtime guard

The check above stops exponential cost, not slow patterns in general, so each match on the typing
path is also timed. A rule that is slow several times (not once: garbage collection pauses happen)
is switched off for the session and shows as **Paused** with its reason; so does a rule that
costs too much to compile when it first runs. Nothing is written to `data.json`, and
restarting Obsidian or changing the rules brings it back. One keystroke stops trying rules
after a few milliseconds. Literal snippets are not affected. There is no promise that a pattern
runs in under a millisecond: a slow rule can cost a few keystrokes before it is switched off.

### Try it

The editor has a **Try it** field. Type a line and it replays it through the real engine,
character by character, and tells you what fires, which rule or snippet wins when something sits
above it, and when an instant rule fires too early. It never reads your clipboard or touches the
note. While the pattern is refused, Try it keeps showing the last version that passed, or "Fix the errors above to try this rule." if none did.

### Groups and the typography set

A rule can be given a group. Snippet groups and pattern groups with the same name are muted
together, because they share one list of muted groups. On the Patterns page, the menu of a rule
turns its group off or on.

**Add typography set** on an empty Patterns page, or the **Typography set** row once you have
rules, adds 32 rules in the `typography` group: the fractions `1/2`, `1/3`, `1/4`, `1/5`, `1/6`,
`1/7`, `1/8`, `1/9`, `1/10`, `2/3`, `2/5`, `3/4`, `3/5`, `4/5`, `5/6`, `3/8`, `5/8`, `7/8` (After a
separator, and not right after a word character or a slash, so the `1/2` in `5/1/2` stays), and
Instant rules for `...` `…`, `<--` `←`, `-->` `→`, `<->` `↔`, `!=` `≠`, `<=` `≤`, `>=` `≥`,
`~=` `≅`, `+-` `±`, `-+` `∓`, `<<` `≪`, `≪<` `⋘`, `>>` `≫` and `≫>` `⋙`. The rules are ported
from the default rules of the Substitutions plugin. The button adds only the ones you do not have.

### Limits

At most 100 rules, a body of at most 200 characters and a replacement of at most 10,000. Patterns
are local: a community package cannot carry them. Snipsy 1.2.0 and later keep the `patterns` field in
`data.json` when they save, even though they do not use it. Older versions drop it.

## Packages

### Community catalog

**Settings → Snipsy → Packages.** Thirteen packs, one click each:

| | |
|---|---|
| Markdown Essentials | Obsidian Power-User |
| Daily Journal | GTD & Productivity |
| Meetings | Developer Boilerplate |
| Code Review | Research & Academic |
| Symbols & Math | Date & Time |
| Obsidian Callouts | Basic Emojis |
| Typography | |

Reinstalling a pack whose snippets you have edited opens a preview before anything is written:
keep your version or take the pack's, snippet by snippet. A pack that wants a trigger already
used by a different snippet in another group is not installed, and the notice names the
trigger. The catalog lives in
[Dimagious/snipsidian-community](https://github.com/Dimagious/snipsidian-community). Made a pack
worth sharing? The Packages page opens a GitHub issue with it already filled in.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Dimagious/snipsidian/HEAD/site/img/packages-dark.png">
  <img alt="The Packages page: community packs with Verified and Installed flairs and Install, Reinstall and Uninstall buttons" src="../site/img/packages-light.png" width="600">
</picture>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Dimagious/snipsidian/HEAD/site/img/conflict-dark.png">
  <img alt="Reinstalling Daily Journal after editing one of its snippets: the preview shows current and incoming text and asks Keep current or Overwrite" src="../site/img/conflict-light.png" width="520">
</picture>

### Package format

A pack is one YAML file. This is what **Share a package** on the Packages page checks before it
opens the GitHub issue:

```yaml
name: "Typography"            # 3 to 50 characters
version: "1.0.0"              # semantic version
author: "your-name"           # 3 to 50 characters
description: "Arrows and dashes from the characters you already type."  # 10 to 200
category: "symbols"           # optional, see below
tags: ["symbols", "arrows"]   # optional
snippets:                     # a list, not a map
  - trigger: "->"
    replace: "→"
  - trigger: "mtg"
    replace: "Meeting with $1 at $2$|"
    description: "Meeting line"   # optional
```

- `name` takes letters, digits, spaces, `-`, `_` and `&`; `author` the same without `&`.
- `category` is one of `markdown`, `programming`, `academic`, `business`, `creative`, `productivity`,
  `language`, `other`, `development`, `emojis`, `journaling`, `obsidian`, `research`, `symbols`,
  `utility`, `work`.
- Triggers follow the [trigger rules](#trigger-characters) and are 1 to 50 characters; a
  replacement is up to 10,000 characters and can use every [placeholder](#placeholders). For a
  line break, write the text on several lines with `|-`, as in the
  [approved packs](https://github.com/Dimagious/snipsidian-community/tree/main/community-packages/approved).
- An install takes at most 500 snippets and 2 MiB of text.

### Espanso import

Paste the YAML of any package from [hub.espanso.org](https://hub.espanso.org/), name a group,
press **Import snippets**. Espanso's cursor marker, clipboard variable and plain date variable
become `$|`, `$clipboard` and `$date`. Forms, scripts, shell commands and images have no
equivalent here. Those are skipped and named, "12 imported, 3 skipped: …", instead of
landing in your notes as broken `{{text}}`.

**`regex:` matches become pattern rules.** The preview lists them in their own **Pattern rules**
section, each with its pattern, replacement and mode, or the reason it was left out. **Apply**
writes snippets and rules together with one save; the rules go to the end of your list, switched
on, in the group you named. Every rule goes through the same check as the Patterns page (see
[What a pattern cannot be](#what-a-pattern-cannot-be)), and the 100 rule limit counts the rules
you already have. A file is read for at most 1000 `regex:` matches, and the preview shows at most
50 rows per list.

What the conversion does:

- `(?P<name>` becomes `(?<name>`, and `{{name}}` in the replacement is the capture of the group of
  that name. A `{{1}}`, `{{ name }}` with spaces, `{{name.sub}}` or a name that is no group of the
  regex is left out, because here it would mean a numbered capture or stay literal text.
- The closing `$` is added when the regex does not end with an unescaped one. A leading `(?i)`
  becomes the flag `i`.
- The rule is **Instant**, as Espanso fires it. When only the instant limit of one open-ended
  repeat stops it (`(\d+)/(\d+)`), it becomes **After a separator** and the preview says so.
- `$1` to `$9` in a replacement (`costs $5`) are stored escaped (`\$5`) so they insert as written;
  this holds for plain triggers too. A replacement with `$|`, `$date`, `$time`, `$filename`,
  `$clipboard`, `{{date}}`, `{{time}}`, `{{title}}` or `{{notedate}}` written as plain text cannot be escaped, so that match is
  left out.
- A rule with the same pattern and replacement as one you already have is left out as "already
  there".

Left out, each with a reason: any other inline flag; Rust class syntax that JavaScript reads
differently (`[[:alpha:]]`, nested classes, `&&`, `--`, `~~`); `\p{...}`; backreferences,
lookahead and everything else the Patterns page refuses; a replacement with `vars:`, a form, a
shell, script or choice variable; case propagation; an image; and `word`, `left_word` or
`right_word`, which a pattern cannot honour exactly.

Three differences to keep in mind. `\w`, `\d`, `\b` and their negations are Unicode-aware in
Espanso and ASCII-based in a pattern, so an imported rule can match differently on text with
non-ASCII letters. A leading `(?i)` folds case the simple way here and the Unicode way in
Espanso (rare letters such as `ſ` and the Kelvin sign differ). And `^` means the start of the
line here, the start of Espanso's buffer there.

What an import inserts is what Espanso inserts (one exception: an undeclared `{{clipboard}}`
becomes `$clipboard`), or the match is left out with a reason, for plain
triggers and regex matches alike.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Dimagious/snipsidian/HEAD/site/img/espanso-dark.png">
  <img alt="Espanso import with a pasted YAML file and the result line: 3 imported, 1 skipped: ask" src="../site/img/espanso-light.png" width="600">
</picture>

### Text Snippets import

Coming from the Text Snippets plugin (`text-snippets-obsidian`)? Press **Import** under
**Text Snippets import** on the Packages page. Snipsy reads that plugin's saved snippets, shows
what it cannot take, shows a preview, and installs the rest into a `text-snippets` group once you
press **Apply**. Nothing in the other plugin is changed. `$end$` becomes `$|`, `$pst$` becomes
`$clipboard`, `$nl$` becomes a line break, and `$tb$` tab stops become fields `$1`, `$2`... in the order they appear (Tab walks
them, see [Fields](#fields-tab-stops); up to nine, the rest are removed and named). Your custom marker symbols are honored. If a trigger
appears twice, the later one wins, like it does there, and the plugin's default sample snippet is
skipped. A few small deviations are deliberate: a second `$end$` is removed (the original left it as
text), every `$pst$` is replaced, triggers are trimmed and a leading or trailing `:` is stripped, text after
a second ` : ` is kept, and a snippet with `$end$` and tab stops ends at `$end$` after the last field.
A tab stop glued to a letter, digit or backslash (`a$tb$b`) cannot be a field in Snipsy. With no
`$end$` the first such stop becomes the cursor, as before fields existed (`a$tb$b` becomes `a$|b`);
any other one is removed with a warning, so a snippet that relies on several glued stops loses all
but the first. A single tab stop next to `$end$` is ignored because one field is only the caret.
A literal `$1`..`$9` in a snippet that also has tab stops is escaped (`\$5`) and reported, so it
stays text. Tab stops inside fenced code or inline code are literal in Snipsy, so they are treated
like glued ones (the first becomes the cursor, any other is removed with a warning).
Triggers in any language are kept (`прив`, `δ`, `café`, `日付`), normalised so an accent typed in the
editor matches whichever way the keyboard composes it. Triggers with spaces, `/`, `$`, emoji, other
symbols (besides `< > = + ~ * ^ | &`) or other characters Snipsy does not allow are skipped and named. That includes triggers with
an invisible character (a joiner such as ZWNJ U+200C or ZWJ U+200D, as in Persian `می‌خواهم` or Indic
conjuncts, a soft hyphen, a zero-width space); the reason names the character.
Snipsy ends a word at its own fixed separators (space, Tab, Enter, `. , ! ? ; : ( ) [ ] { } " '`; the
ideographic space U+3000 does not count), so a trigger expands only after one of them, and it must start at the line start or right after a
separator. CJK or Arabic punctuation such as `。` or `،` does not end a trigger, same as for
hand-added triggers, and a trigger inside unspaced CJK text does not fire (`今日の 日付` works,
`今日の日付` does not). The "Expand trigger at cursor" command expands a trigger with no separator
typed after it, when the caret is at the end of the line or before one of Snipsy's separators; it
follows the same start rule. If you changed the word delimiters in Text Snippets, the import says so.
Snipsy expands these automatically as you type (Text Snippets waited for Tab), so disable the group
or turn on prefix mode if a trigger fires too often.

### Backup

**Settings → Snipsy → Export snippets** (the **Export JSON** button) saves every snippet and every
pattern rule to a JSON file, **Import snippets** brings them back. On
a phone, where browsers cannot download, the export lands in the vault root as
`snipsidian-snippets.json`.

The import preview has a **Pattern rules** section: the rules that will be stored, and the ones
left out, each with the sentence the Patterns page shows. **Merge** appends the rules you do not
have yet (same pattern and replacement) after yours and leaves yours untouched. **Replace all**
swaps the whole rule list too, and its hint says how many rules it deletes. A file without rules
never touches your rules. Every rule goes through the same pattern check and the 100 rule limit
again when you press **Apply**, with one save for snippets and rules together; a rule without an
id is stored switched off.

**Older Snipsy versions.** They read the backup as a flat object of strings and refuse a file with
an array in it, so the rules travel as one more string entry named `snipsy patterns` (the rule
list as JSON text). Snipsy 1.7.0 and later list it as a skipped key and import everything else; an
older one stores it as a snippet that can never fire. A hand-written top-level `patterns` array is
read too, and when a file has both, `snipsy patterns` wins.

## Privacy

Snipsy reads and writes one file: `.obsidian/plugins/snipsidian/data.json`. It goes online
only when you open the Packages page: `api.github.com` for the list and
`raw.githubusercontent.com` for the pack files, all of them, kept for 24 hours. No analytics, no
telemetry, no account.

`$clipboard` reads your clipboard when a snippet with it expands. None of the defaults use it;
the install preview shows it when a third-party pack does.

## Questions

<details>
<summary>Will it fire inside my code blocks?</summary>

No. Fenced code, inline code and YAML frontmatter are left alone, and so is a trigger that
is part of a longer word.

</details>

<details>
<summary>It keeps expanding <code>now</code> in my sentences</summary>

Delete that snippet, switch off the Defaults group, or turn on prefix mode so only `:now`
expands. See [Prefix mode](#prefix-mode).

</details>

<details>
<summary>My emoji snippets with colons (<code>:smile:</code>) don't expand</summary>

`:` is a separator, so a stored trigger like `:smile:` can never be typed as one word. Settings →
Snipsy → Snippets shows a warning with a **Fix triggers** button that renames them to `smile` (same group,
same replacement) after a preview. Triggers that would clash with an existing one are skipped and
listed. With [prefix mode](#prefix-mode) set to `:`, you then type `:smile `.

</details>

<details>
<summary>Triggers don't expand on Linux (Wayland)</summary>

Start Obsidian with `--ozone-platform=x11`. If that fixes it, please report it in an issue
with your desktop and input method.

</details>

<details>
<summary>Can I use regular expressions?</summary>

Yes, on the Patterns page: **Settings → Snipsy → Patterns**. `/\b1\/2$/` with the replacement `½`
turns `1/2` and a space into ½. See [Patterns](#patterns).

</details>

<details>
<summary>Does it work on my phone?</summary>

Yes. The plugin is not desktop-only, and the picker fits a phone screen.

</details>

<details>
<summary>Are <code>$1</code> and <code>$2</code> Tab-stops?</summary>

Yes, when a snippet has two or more of them: Tab jumps from one to the next, then to `$|` or the
end of the snippet. A snippet with a single `$1` just puts the caret there. `$1` also takes the
selected text when you insert from the picker over a selection. See
[Fields](#fields-tab-stops).

</details>

<details>
<summary>Where are my snippets, and do they sync?</summary>

In `.obsidian/plugins/snipsidian/data.json` inside the vault. iCloud, Syncthing or git carry it with
the rest of the vault; Obsidian Sync carries it when syncing of community plugin settings is on.
**Export snippets** saves a copy you can keep elsewhere.

</details>

<details>
<summary>How do I start over?</summary>

Export your snippets first. Then **Settings → Snipsy → Restore default snippets** brings back the
sixteen defaults you deleted, without touching your own. For a full reset, close Obsidian, delete
`data.json` and import the export again where you need it.

</details>

<details>
<summary>Does it send my notes anywhere?</summary>

No. See [Privacy](#privacy).

</details>

## Development

```bash
npm install
npm test           # vitest, with coverage gates
npm run lint       # eslint + eslint-plugin-obsidianmd
npm run typecheck  # src and the e2e specs
npm run build      # main.js + styles.css
```

| | |
|---|---|
| `npm run e2e` | the suite against a real Obsidian |
| `npm run capture` | retakes the site pictures (`site/img/*-light.png`, `*-dark.png`) and the directory listing pictures (`docs/listing/`) from the real Obsidian on a fixed day (`e2e/capture.spec.ts`), then `opdk demo` copies them. The listing itself is updated by hand. The spec is skipped by `npm run e2e` |
| `npm run scorecard:check` | `opdk scan`: mirrors the community-plugin review scanner |
| `npm run release:check` | `opdk release check` (versions, `versions.json`, manifest, CHANGELOG, a reproducible build), the scan, lint, typecheck, tests and the site check |

`VAULT_PLUGIN="/path/to/vault/.obsidian/plugins/snipsidian" npm run dev:vault` builds straight
into a test vault and watches for changes.

The matching engine lives in `src/engine/`, which imports neither Obsidian nor the DOM and is
tested without mocks.
