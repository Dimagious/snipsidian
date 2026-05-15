// Lightweight converter from Espanso YAML to { trigger: replacement }
import * as YAML from "yaml";
import type { EspansoDocument } from "../services/package-types";

/**
 * Supported Espanso fields:
 *   matches:
 *     - trigger: ":brb"        // or 'triggers: [":brb", ":omw"]'
 *       replace: "be right back"
 *
 * We ignore complex placeholders/conditions. Leading ":" in triggers is removed.
 */
export function espansoYamlToSnippets(text: string): Record<string, string> {
    const doc = YAML.parse(text) as EspansoDocument;
    const out: Record<string, string> = {};
    if (!doc || typeof doc !== "object") return out;

    const arr = Array.isArray(doc.matches) ? doc.matches : [];
    for (const m of arr) {
        if (!m) continue;
        const replace: unknown = (m.replace ?? m.replace_text ?? m.output);
        if (typeof replace !== "string") continue;

        // YAML.parse already converts string escapes ("foo\nbar") to real
        // characters; nothing further to normalise here. (The previous
        // CURSOR_PLACEHOLDER and \\n→\n substitutions were no-ops — removed
        // in 1.0.9.)

        // Single trigger
        if (typeof m.trigger === "string") {
            const t = normalizeTrigger(m.trigger);
            if (t) out[t] = replace;
        }
        // Multiple triggers
        if (Array.isArray(m.triggers)) {
            for (const tt of m.triggers) {
                if (typeof tt !== "string") continue;
                const t = normalizeTrigger(tt);
                if (t) out[t] = replace;
            }
        }
    }
    return out;
}

function normalizeTrigger(t: string): string {
    // Espanso often uses ":" prefix; our expander thinks ":" is a separator.
    // Trim whitespace first so leading-space-then-colon (`"  :brb "`) still
    // strips the colon — otherwise the colon would leak through and the
    // trigger would be unreachable (":" is a separator, no engine path
    // would ever match it).
    return t.trim().replace(/^:+/, "");
}
