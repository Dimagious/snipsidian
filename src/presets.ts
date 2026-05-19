// Default snippets shipped with Snipsy. These land in
// `settings.snippets` on first install (and on any reload where the
// user's data.json doesn't already have the key — user values win
// the merge in `loadSettings`).
//
// Trigger keys avoid the leading `:` prefix on purpose: `:` is a
// delimiter in Snipsy's engine (`src/shared/delimiters.ts`), so a
// stored `:todo` would never be the trigger-candidate the engine
// finds between separators — typing `:todo<space>` already gives the
// engine `todo` as the candidate. Espanso-style invocation (`:todo `)
// works identically to bare invocation (`todo `).
//
// Keys are also chosen to avoid the most common English-word
// collisions while still matching the README's marketing copy.
export const DEFAULT_SNIPPETS: Record<string, string> = {
  // Text abbreviations
  brb: "be right back",
  omw: "on my way",
  ty: "thank you",
  imo: "in my opinion",

  // Headings — cursor inside ready to type the heading text
  h1: "# $|",
  h2: "## $|",
  h3: "### $|",

  // Task states
  todo: "- [ ] $|",
  done: "- [x] $|",

  // Markdown inline emphasis — wrap-style with cursor inside
  bold: "**$|**",
  italic: "_$|_",
  code: "`$|`",

  // Obsidian callout — cursor lands on the second line, ready to
  // type the callout body (regression covered by E2E B-010).
  note: "> [!note]\n> $|",

  // Tables — 3×3 scaffold; cursor in first body cell
  table: "| H1 | H2 | H3 |\n| --- | --- | --- |\n| $| | | |",

  // Dynamic — $date / $time get substituted at expansion time
  // (see `src/engine/placeholders.ts`).
  today: "$date",
  now: "$time",
};
