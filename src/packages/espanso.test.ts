import { describe, it, expect } from "vitest";
import { espansoYamlToSnippets } from "./espanso";

/**
 * Boundary tests for the Espanso YAML importer.
 *
 * Backlog B-079 — `src/packages/**` was excluded from coverage and
 * had zero tests before this file. It's a parser with security
 * implications (S-002): attacker-controlled YAML can ship arbitrary
 * keys into `settings.snippets`. The contract worth pinning:
 *
 *   - Only string triggers and string replacements are accepted
 *   - Leading colons are stripped (Espanso convention vs Snipsy
 *     model where `:` is a separator)
 *   - Arbitrary YAML keys (like `__proto__`) are not interpreted
 *     specially — `YAML.parse` defends against prototype pollution
 *   - Malformed input is silently skipped, not thrown — the
 *     importer never crashes the install flow
 *
 * Per ADR-0005, every assertion below is at the contract boundary.
 * Coverage on this file matters less than the contract being
 * documented in tests.
 */

describe("espansoYamlToSnippets — happy paths", () => {
    it("extracts a single trigger + replace pair", () => {
        const yaml = `
matches:
  - trigger: ":brb"
    replace: "be right back"
`;
        expect(espansoYamlToSnippets(yaml)).toEqual({ brb: "be right back" });
    });

    it("expands a `triggers: []` list to one snippet per trigger sharing the replacement", () => {
        const yaml = `
matches:
  - triggers: [":brb", ":omw"]
    replace: "shared replacement"
`;
        expect(espansoYamlToSnippets(yaml)).toEqual({
            brb: "shared replacement",
            omw: "shared replacement",
        });
    });

    it("supports both `replace` and `replace_text` and `output` (Espanso alternatives)", () => {
        // Espanso accepts three aliases for the replacement field in
        // different package generations. All three should work.
        const a = espansoYamlToSnippets(`
matches:
  - trigger: ":a"
    replace: "via-replace"
`);
        const b = espansoYamlToSnippets(`
matches:
  - trigger: ":b"
    replace_text: "via-replace-text"
`);
        const c = espansoYamlToSnippets(`
matches:
  - trigger: ":c"
    output: "via-output"
`);
        expect(a).toEqual({ a: "via-replace" });
        expect(b).toEqual({ b: "via-replace-text" });
        expect(c).toEqual({ c: "via-output" });
    });
});

describe("espansoYamlToSnippets — trigger normalisation", () => {
    it("strips a single leading colon", () => {
        expect(espansoYamlToSnippets(`
matches:
  - trigger: ":brb"
    replace: "hello"
`)).toEqual({ brb: "hello" });
    });

    it("strips multiple leading colons", () => {
        // Defensive: some Espanso packs use `::` for word-internal
        // triggers. We strip all leading colons because `:` is a
        // separator in Snipsy and would never reach the engine anyway.
        expect(espansoYamlToSnippets(`
matches:
  - trigger: "::nested"
    replace: "hello"
`)).toEqual({ nested: "hello" });
    });

    it("trims surrounding whitespace from triggers", () => {
        expect(espansoYamlToSnippets(`
matches:
  - trigger: "  :spaced  "
    replace: "hello"
`)).toEqual({ spaced: "hello" });
    });

    it("skips a match whose trigger normalises to empty", () => {
        // Trigger `":"` strips to `""` after colon removal. An empty
        // key would silently overwrite the empty-string entry on
        // every import — skip the match instead.
        const result = espansoYamlToSnippets(`
matches:
  - trigger: ":"
    replace: "should-not-land"
  - trigger: ":valid"
    replace: "should-land"
`);
        expect(result).toEqual({ valid: "should-land" });
    });
});

describe("espansoYamlToSnippets — malformed inputs (importer must not crash)", () => {
    it("returns empty for empty string", () => {
        expect(espansoYamlToSnippets("")).toEqual({});
    });

    it("returns empty for non-object YAML (null, scalar, array root)", () => {
        // YAML.parse returns null for empty doc, a number/string for
        // scalar root, an array for sequence root. None of these
        // match the shape we expect. The importer should treat them
        // as "no matches" rather than throw.
        expect(espansoYamlToSnippets("null")).toEqual({});
        expect(espansoYamlToSnippets("42")).toEqual({});
        expect(espansoYamlToSnippets("[1, 2, 3]")).toEqual({});
    });

    it("returns empty when `matches` is missing or wrong type", () => {
        expect(espansoYamlToSnippets("name: just a package")).toEqual({});
        expect(espansoYamlToSnippets("matches: 42")).toEqual({});
        expect(espansoYamlToSnippets("matches: \"not an array\"")).toEqual({});
    });

    it("skips matches with non-string replace fields", () => {
        // A YAML payload with a numeric `replace` value would coerce
        // dangerously if we trusted the type. The importer's
        // `typeof replace !== "string"` guard rejects it.
        const result = espansoYamlToSnippets(`
matches:
  - trigger: ":num"
    replace: 42
  - trigger: ":nul"
    replace: null
  - trigger: ":ok"
    replace: "valid"
`);
        expect(result).toEqual({ ok: "valid" });
    });

    it("skips non-string entries inside a triggers array", () => {
        const result = espansoYamlToSnippets(`
matches:
  - triggers: [":valid", 42, null, ":also-valid"]
    replace: "shared"
`);
        expect(result).toEqual({ valid: "shared", "also-valid": "shared" });
    });

    it("skips null entries in the matches array", () => {
        // YAML lists can contain a literal null entry (`- ~`); the
        // importer's `if (!m) continue;` guard handles it.
        const result = espansoYamlToSnippets(`
matches:
  - ~
  - trigger: ":ok"
    replace: "valid"
`);
        expect(result).toEqual({ ok: "valid" });
    });

    it("throws on truly malformed YAML (caller decides what to do with the error)", () => {
        // Genuine syntax errors should propagate so the UI can show a
        // proper notice ("Failed to parse Espanso package"). The
        // importer does NOT swallow these — it's the caller's job.
        expect(() => espansoYamlToSnippets(`
matches:
  - trigger: ":x
    replace: "broken
`)).toThrow();
    });
});

describe("espansoYamlToSnippets — security / prototype pollution", () => {
    it("does not pollute Object.prototype via `__proto__` keys (S-002 defence)", () => {
        // Attacker-controlled YAML could try to set `__proto__.polluted = true`
        // on the returned dict, which would taint every plain object in the
        // process. `yaml`'s default safe-load behaviour treats `__proto__`
        // as a regular own property, but pin the assertion so we catch any
        // regression if the YAML library changes its policy.
        const yaml = `
matches:
  - trigger: ":__proto__"
    replace: "attacker"
`;
        const result = espansoYamlToSnippets(yaml);
        expect(result).toEqual({ __proto__: "attacker" });
        // Object.prototype must not have been polluted.
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
        expect(Object.prototype.hasOwnProperty.call(Object.prototype, "polluted")).toBe(false);
    });

    it("preserves multi-line replacements (real newlines, not `\\\\n`)", () => {
        // YAML's block scalars produce real newline characters. The
        // engine relies on `\n` to compute `lineDelta` for cursor
        // placement (B-010). If the importer ever re-escaped them,
        // multi-line snippets would land as one-liners with literal
        // backslash-n.
        const yaml = `
matches:
  - trigger: ":multi"
    replace: |
      line one
      line two
`;
        const result = espansoYamlToSnippets(yaml);
        expect(result.multi).toBe("line one\nline two\n");
        expect(result.multi).not.toContain("\\n");
    });
});
