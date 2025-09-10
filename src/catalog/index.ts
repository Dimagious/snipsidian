import type { PackageItem } from "./types";
import {
    BUILTIN_MARKDOWN_YAML,
    BUILTIN_CALLOUTS_YAML,
    BUILTIN_UNICODE_ARROWS_YAML,
    BUILTIN_MATH_LITE_YAML,
    BUILTIN_EMOJI_LITE_YAML,
    BUILTIN_TASKS_YAML,
} from "./builtin-packages";

export const PACKAGE_CATALOG: PackageItem[] = [
    { id: "builtin-arrows", label: "Unicode arrows (builtin)", kind: "builtin", yaml: BUILTIN_UNICODE_ARROWS_YAML },
    { id: "builtin-callouts", label: "Obsidian Callouts (builtin)", kind: "builtin", yaml: BUILTIN_CALLOUTS_YAML },
    { id: "builtin-emoji-lite", label: "Emoji (lite, builtin)", kind: "builtin", yaml: BUILTIN_EMOJI_LITE_YAML },
    { id: "builtin-markdown", label: "Markdown basics (builtin)", kind: "builtin", yaml: BUILTIN_MARKDOWN_YAML },
    { id: "builtin-math-lite", label: "Math symbols (lite, builtin)", kind: "builtin", yaml: BUILTIN_MATH_LITE_YAML },
    { id: "builtin-tasks", label: "Task states (builtin)", kind: "builtin", yaml: BUILTIN_TASKS_YAML },
];

export * from "./types";
