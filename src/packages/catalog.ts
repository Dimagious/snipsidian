export type PackageItem = {
    id: string;
    label: string;
    kind: "builtin";
    yaml: string;
};

/* ---------- Builtins curated for Obsidian ---------- */

// Markdown basics (kept from earlier, moved into catalog)
const BUILTIN_MARKDOWN_YAML = `matches:
  - trigger: ":code"
    replace: "\\\`\\\`\\\`$|\\n\\\`\\\`\\\`"
  - trigger: ":todo"
    replace: "- [ ] $|"
  - trigger: ":quote"
    replace: "> $|"
`;

// Obsidian callouts
const BUILTIN_CALLOUTS_YAML = `matches:
  - trigger: ":note"
    replace: "> [!note] $|\\n> "
  - trigger: ":tip"
    replace: "> [!tip] $|\\n> "
  - trigger: ":info"
    replace: "> [!info] $|\\n> "
  - trigger: ":warn"
    replace: "> [!warning] $|\\n> "
  - trigger: ":danger"
    replace: "> [!danger] $|\\n> "
  - trigger: ":quote-callout"
    replace: "> [!quote]\\n> $|"
`;

// Markdown tables (3×3 scaffold)
const BUILTIN_TABLES_YAML = `matches:
  - trigger: ":tbl3"
    replace: "| Header | Header | Header |\\n| --- | --- | --- |\\n| $| | | |"
  - trigger: ":tbl2"
    replace: "| H1 | H2 |\\n| --- | --- |\\n| $| | |"
`;

// Unicode arrows
const BUILTIN_UNICODE_ARROWS_YAML = `matches:
  - triggers: [":rarrow", ":->"]
    replace: "→"
  - triggers: [":larrow", ":<-"]
    replace: "←"
  - trigger: ":uparrow"
    replace: "↑"
  - trigger: ":downarrow"
    replace: "↓"
  - trigger: ":dblarrow"
    replace: "↔"
`;

// Math symbols (lite)
const BUILTIN_MATH_LITE_YAML = `matches:
  - trigger: ":pm"
    replace: "±"
  - trigger: ":times"
    replace: "×"
  - trigger: ":div"
    replace: "÷"
  - trigger: ":le"
    replace: "≤"
  - trigger: ":ge"
    replace: "≥"
  - trigger: ":neq"
    replace: "≠"
  - trigger: ":approx"
    replace: "≈"
  - trigger: ":deg"
    replace: "°"
  - trigger: ":mu"
    replace: "µ"
  - trigger: ":inf"
    replace: "∞"
`;

// Kaomoji (lite)
const BUILTIN_KAOMOJI_YAML = `matches:
  - trigger: ":shrug"
    replace: "¯\\\\_(ツ)_/¯"
  - trigger: ":tableflip"
    replace: "(╯°□°）╯︵ ┻━┻"
  - trigger: ":unflip"
    replace: "┬─┬ ノ( ゜-゜ノ )"
`;

export const PACKAGE_CATALOG: PackageItem[] = [
    { id: "builtin-callouts", label: "Obsidian Callouts (builtin)", kind: "builtin", yaml: BUILTIN_CALLOUTS_YAML },
    { id: "builtin-markdown", label: "Markdown basics (builtin)", kind: "builtin", yaml: BUILTIN_MARKDOWN_YAML },
    { id: "builtin-tables", label: "Markdown tables (builtin)", kind: "builtin", yaml: BUILTIN_TABLES_YAML },
    { id: "builtin-arrows", label: "Unicode arrows (builtin)", kind: "builtin", yaml: BUILTIN_UNICODE_ARROWS_YAML },
    { id: "builtin-math-lite", label: "Math symbols (lite, builtin)", kind: "builtin", yaml: BUILTIN_MATH_LITE_YAML },
    { id: "builtin-kaomoji-lite", label: "Kaomoji (lite, builtin)", kind: "builtin", yaml: BUILTIN_KAOMOJI_YAML },
];
