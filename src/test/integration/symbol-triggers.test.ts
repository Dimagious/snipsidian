import { describe, it, expect } from "vitest";
import * as YAML from "yaml";
import { tryExpandAtSeparator } from "../../adapters/obsidian-editor";
import type { Editor } from "obsidian";
import type { Dict } from "../../engine/types";
import { makeMockEditor } from "../factories/editor";
import { espansoYamlToSnippets } from "../../packages/espanso";
import { convertSnippetsToObject } from "../../services/community-api";
import { validatePackageForInstall } from "../../services/package-validator";

/**
 * B-167 (math guard) + B-171 (symbol triggers), end to end through the
 * adapter -> engine path. Matching stays word-bound: the candidate is the
 * run of non-separator chars before the separator, so `->`, `--`, `<=` work
 * without any change to the separators.
 */

const NOW = new Date("2026-10-06T10:00:00Z");

async function run(
    text: string,
    dict: Dict,
    opts: { prefix?: string; cursor?: { line: number; ch: number } } = {},
): Promise<string> {
    const lines = text.split("\n");
    const last = lines.length - 1;
    const cursor = opts.cursor ?? { line: last, ch: (lines[last] ?? "").length };
    const editor = makeMockEditor({ text, cursor });
    await tryExpandAtSeparator(editor as unknown as Editor, dict, { now: NOW, prefix: opts.prefix });
    return editor.value();
}

describe("symbol triggers (B-171)", () => {
    const dict: Dict = { "->": "→", "--": "—", "<=": "≤", "<->": "↔", ">=": "≥", "+-": "±", "~=": "≈" };

    it("expands `a -> b`", async () => {
        expect(await run("a -> ", dict)).toBe("a → ");
    });
    it("expands other symbol triggers (<=, >=, <->, +-, ~=)", async () => {
        expect(await run("x <= ", dict)).toBe("x ≤ ");
        expect(await run("x >= ", dict)).toBe("x ≥ ");
        expect(await run("x <-> ", dict)).toBe("x ↔ ");
        expect(await run("x +- ", dict)).toBe("x ± ");
        expect(await run("x ~= ", dict)).toBe("x ≈ ");
    });
    it("`--` defined and `---` typed: no expansion", async () => {
        expect(await run("a --- ", dict)).toBe("a --- ");
        expect(await run("a -- ", dict)).toBe("a — ");
    });
    it("a `---` frontmatter delimiter line is unaffected", async () => {
        const text = "---\ntitle: x\n--- ";
        expect(await run(text, dict)).toBe(text);
    });
    it("`--` inside YAML frontmatter is not expanded", async () => {
        expect(await run("---\ntitle: a -- ", dict)).toBe("---\ntitle: a -- ");
    });
    it("does not expand `->` inside inline code", async () => {
        expect(await run("see `a -> ", dict)).toBe("see `a -> ");
    });
    it("does not expand `->` inside a fenced code block", async () => {
        const text = "```\na -> ";
        expect(await run(text, dict)).toBe(text);
    });
    it("a symbol trigger glued to a word does not match (word-bound)", async () => {
        expect(await run("a-> ", dict)).toBe("a-> ");
    });
    it("prefix mode (B-137): `:->` expands, bare `->` does not", async () => {
        expect(await run("a :-> ", dict, { prefix: ":" })).toBe("a → ");
        expect(await run("a -> ", dict, { prefix: ":" })).toBe("a -> ");
    });
    it("inherited Object.prototype keys still never match (S-008)", async () => {
        expect(await run("a constructor ", dict)).toBe("a constructor ");
        expect(await run("a __proto__ ", dict)).toBe("a __proto__ ");
    });
});

describe("math guard (B-167)", () => {
    const dict: Dict = { "<=": "≤", today: "2026-10-06" };

    it("does not expand `<=` inside inline math `$a <= b$`", async () => {
        const text = "$a <= b$";
        // cursor right after the space typed after `<=`
        expect(await run(text, dict, { cursor: { line: 0, ch: 6 } })).toBe(text);
    });
    it("does not expand a dict trigger inside inline math `$a today, b$`", async () => {
        const text = "$a today, b$";
        // cursor right after the `,` typed after `today`, closing `$` still ahead
        expect(await run(text, dict, { cursor: { line: 0, ch: 9 } })).toBe(text);
    });
    it("does not expand while the closing $ has not been typed yet", async () => {
        expect(await run("$a <= ", dict)).toBe("$a <= ");
    });
    it("expands right after the closing $", async () => {
        expect(await run("$a$ today ", dict)).toBe("$a$ 2026-10-06 ");
    });
    it("does not expand inside a multi-line $$ block", async () => {
        const text = "$$\nx <= ";
        expect(await run(text, dict)).toBe(text);
    });
    it("expands after a closed multi-line $$ block", async () => {
        expect(await run("$$\nx\n$$\ntoday ", dict)).toBe("$$\nx\n$$\n2026-10-06 ");
    });
    it("does not expand inside single-line $$x today $$", async () => {
        const text = "$$x today $$";
        // cursor right after the space typed after `today`
        expect(await run(text, dict, { cursor: { line: 0, ch: 10 } })).toBe(text);
    });
    it("escaped \\$ does not open math", async () => {
        expect(await run("\\$a today ", dict)).toBe("\\$a 2026-10-06 ");
    });
    it("prices are not math: `costs $5 and $10 today ` still expands", async () => {
        expect(await run("costs $5 and $10 today ", dict)).toBe("costs $5 and $10 2026-10-06 ");
    });
    it("a $$ inside a fenced code block does not make later text math", async () => {
        expect(await run("```\n$$\n```\ntoday ", dict)).toBe("```\n$$\n```\n2026-10-06 ");
    });
});

describe("symbol triggers survive YAML / install gate (B-171)", () => {
    // YAML indicator characters at the start of a plain scalar: & (anchor),
    // * (alias), | and > (block scalars), - (sequence entry), plus the rest.
    const triggers = ["&x", "*x", "||", ">=", "-x", "->", "--", "<->", "~=", "+-", "^2", "=>", "<<", ">>"];

    it("round-trips through YAML.stringify -> Espanso importer -> validatePackageForInstall", () => {
        const yaml = YAML.stringify({
            matches: triggers.map((t, i) => ({ trigger: t, replace: `r${i}` })),
        });
        const { snippets, skipped } = espansoYamlToSnippets(yaml);
        expect(skipped).toEqual([]);
        expect(Object.keys(snippets).sort()).toEqual([...triggers].sort());
        triggers.forEach((t, i) => expect(snippets[t]).toBe(`r${i}`));
        expect(validatePackageForInstall({ label: "Espanso", snippets }).isValid).toBe(true);
    });

    it("round-trips through the community-package path (convertSnippetsToObject)", () => {
        const yaml = YAML.stringify({
            snippets: triggers.map((t, i) => ({ trigger: t, replace: `r${i}` })),
        });
        const parsed = YAML.parse(yaml) as { snippets: { trigger: string; replace: string }[] };
        const obj = convertSnippetsToObject(parsed.snippets);
        expect(Object.keys(obj).sort()).toEqual([...triggers].sort());
        expect(validatePackageForInstall({ label: "Typography", snippets: obj }).isValid).toBe(true);
    });

    it("a pack with a bad-charset trigger is still rejected as a whole (S-009 gate)", () => {
        const r = validatePackageForInstall({ label: "Mixed", snippets: { "->": "→", "a/b": "x" } });
        expect(r.isValid).toBe(false);
    });
});
