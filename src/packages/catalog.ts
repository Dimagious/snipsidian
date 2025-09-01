export type PackageItem = {
  id: string;
  label: string;
  kind: "builtin" | "url";
  yaml?: string;  // for builtin
  url?: string;   // for url (user can edit)
};

// Two tiny builtins just to demo the UX (you can expand later)
const BUILTIN_MARKDOWN_YAML = `matches:
  - trigger: ":code"
    replace: "'''$|\\n'''"
  - trigger: ":todo"
    replace: "- [ ] $|"
  - trigger: ":quote"
    replace: "> $|"
`;

const BUILTIN_UNICODE_ARROWS_YAML = `matches:
  - triggers: [":rarrow", ":->"]
    replace: "→"
  - triggers: [":larrow", ":<-"]
    replace: "←"
  - trigger: ":uparrow"
    replace: "↑"
  - trigger: ":downarrow"
    replace: "↓"
`;

export const PACKAGE_CATALOG: PackageItem[] = [
  { id: "builtin-markdown", label: "Markdown basics (builtin)", kind: "builtin", yaml: BUILTIN_MARKDOWN_YAML },
  { id: "builtin-unicode-arrows", label: "Unicode arrows (builtin)", kind: "builtin", yaml: BUILTIN_UNICODE_ARROWS_YAML },

  // You can prefill a URL (user may replace it in UI). Leave blank if unsure.
  { id: "from-url", label: "Install from URL…", kind: "url", url: "" },
];
