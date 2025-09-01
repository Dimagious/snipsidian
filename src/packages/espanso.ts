// Lightweight converter from Espanso YAML to { trigger: replacement }
import yaml from "js-yaml";

/**
 * Supported Espanso fields:
 *   matches:
 *     - trigger: ":brb"        // or 'triggers: [":brb", ":omw"]'
 *       replace: "be right back"
 *
 * We ignore complex placeholders/conditions. Leading ":" in triggers is removed.
 */
export function espansoYamlToSnippets(text: string): Record<string, string> {
    const doc = yaml.load(text) as any;
    const out: Record<string, string> = {};
    if (!doc || typeof doc !== "object") return out;

    const arr = Array.isArray(doc.matches) ? doc.matches : [];
    for (const m of arr) {
        if (!m) continue;
        const replace: unknown = (m.replace ?? m.replace_text ?? m.output);
        if (typeof replace !== "string") continue;

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
    // Remove leading colons and whitespace.
    return t.replace(/^:+/, "").trim();
}
