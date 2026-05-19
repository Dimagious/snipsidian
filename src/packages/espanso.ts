// Lightweight converter from Espanso YAML to { trigger: replacement }
import * as YAML from "yaml";
import type { EspansoDocument } from "../services/package-types";
import { normalizeTrigger } from "../services/utils";

/**
 * Supported Espanso fields:
 *   matches:
 *     - trigger: ":brb"        // or 'triggers: [":brb", ":omw"]'
 *       replace: "be right back"
 *
 * We ignore complex placeholders/conditions. Trigger normalisation
 * (leading/trailing colon strip + whitespace trim) lives in the
 * shared `services/utils.ts:normalizeTrigger` so both this importer
 * and the community-packages install path apply the same rules.
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

