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
 * B-139: the importer now returns `{ snippets, skipped }` instead of
 * a bare map — matches using constructs Snipsy can't represent
 * (forms, shell/script/choice vars, regex triggers, case
 * propagation, image matches, markdown/html-only content) are
 * reported in `skipped` with a reason instead of silently landing as
 * corrupted literal `{{var}}` text. Three trivial free-win mappings
 * apply before anything is judged unsupported.
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
        expect(espansoYamlToSnippets(yaml)).toEqual({
            snippets: { brb: "be right back" },
            skipped: [],
        });
    });

    it("expands a `triggers: []` list to one snippet per trigger sharing the replacement", () => {
        const yaml = `
matches:
  - triggers: [":brb", ":omw"]
    replace: "shared replacement"
`;
        expect(espansoYamlToSnippets(yaml).snippets).toEqual({
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
        expect(a.snippets).toEqual({ a: "via-replace" });
        expect(b.snippets).toEqual({ b: "via-replace-text" });
        expect(c.snippets).toEqual({ c: "via-output" });
    });
});

describe("espansoYamlToSnippets — trigger normalisation", () => {
    it("strips a single leading colon", () => {
        expect(espansoYamlToSnippets(`
matches:
  - trigger: ":brb"
    replace: "hello"
`).snippets).toEqual({ brb: "hello" });
    });

    it("strips multiple leading colons", () => {
        // Defensive: some Espanso packs use `::` for word-internal
        // triggers. We strip all leading colons because `:` is a
        // separator in Snipsy and would never reach the engine anyway.
        expect(espansoYamlToSnippets(`
matches:
  - trigger: "::nested"
    replace: "hello"
`).snippets).toEqual({ nested: "hello" });
    });

    it("trims surrounding whitespace from triggers", () => {
        expect(espansoYamlToSnippets(`
matches:
  - trigger: "  :spaced  "
    replace: "hello"
`).snippets).toEqual({ spaced: "hello" });
    });

    it("skips a match whose trigger normalises to empty (not reported as `skipped` — not an unsupported construct)", () => {
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
        expect(result.snippets).toEqual({ valid: "should-land" });
        expect(result.skipped).toEqual([]);
    });
});

describe("espansoYamlToSnippets — malformed inputs (importer must not crash)", () => {
    it("returns empty for empty string", () => {
        expect(espansoYamlToSnippets("")).toEqual({ snippets: {}, skipped: [] });
    });

    it("returns empty for non-object YAML (null, scalar, array root)", () => {
        // YAML.parse returns null for empty doc, a number/string for
        // scalar root, an array for sequence root. None of these
        // match the shape we expect. The importer should treat them
        // as "no matches" rather than throw.
        expect(espansoYamlToSnippets("null")).toEqual({ snippets: {}, skipped: [] });
        expect(espansoYamlToSnippets("42")).toEqual({ snippets: {}, skipped: [] });
        expect(espansoYamlToSnippets("[1, 2, 3]")).toEqual({ snippets: {}, skipped: [] });
    });

    it("returns empty when `matches` is missing or wrong type", () => {
        expect(espansoYamlToSnippets("name: just a package").snippets).toEqual({});
        expect(espansoYamlToSnippets("matches: 42").snippets).toEqual({});
        expect(espansoYamlToSnippets("matches: \"not an array\"").snippets).toEqual({});
    });

    it("skips matches with non-string replace fields (and reports why)", () => {
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
        expect(result.snippets).toEqual({ ok: "valid" });
        expect(result.skipped).toEqual([
            { trigger: "num", reason: "has no replacement text Snipsy can read" },
            { trigger: "nul", reason: "has no replacement text Snipsy can read" },
        ]);
    });

    it("skips non-string entries inside a triggers array", () => {
        const result = espansoYamlToSnippets(`
matches:
  - triggers: [":valid", 42, null, ":also-valid"]
    replace: "shared"
`);
        expect(result.snippets).toEqual({ valid: "shared", "also-valid": "shared" });
        expect(result.skipped).toEqual([]);
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
        expect(result.snippets).toEqual({ ok: "valid" });
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
        expect(result.snippets).toEqual({ __proto__: "attacker" });
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
        expect(result.snippets.multi).toBe("line one\nline two\n");
        expect(result.snippets.multi).not.toContain("\\n");
    });
});

// ---- B-139: honesty — skip unsupported constructs with a reason ----

describe("espansoYamlToSnippets — skips unsupported constructs (B-139)", () => {
    it("skips a form match with reason \"uses a form\"", () => {
        const result = espansoYamlToSnippets(`
matches:
  - trigger: ":addr"
    form: "Address: [[address]]"
    form_fields:
      address:
        multiline: true
`);
        expect(result.snippets).toEqual({});
        expect(result.skipped).toEqual([{ trigger: "addr", reason: "uses a form" }]);
    });

    it("skips a match with a shell var, naming the var type in the reason", () => {
        const result = espansoYamlToSnippets(`
matches:
  - trigger: ":sh"
    replace: "{{output}}"
    vars:
      - name: output
        type: shell
        params:
          cmd: "echo hi"
`);
        expect(result.snippets).toEqual({});
        expect(result.skipped).toEqual([{ trigger: "sh", reason: 'uses a "shell" variable' }]);
    });

    it("skips a match with a script var", () => {
        const result = espansoYamlToSnippets(`
matches:
  - trigger: ":sc"
    replace: "{{out}}"
    vars:
      - name: out
        type: script
        params:
          args: ["python3", "script.py"]
`);
        expect(result.skipped).toEqual([{ trigger: "sc", reason: 'uses a "script" variable' }]);
    });

    it("skips a match with a choice var", () => {
        const result = espansoYamlToSnippets(`
matches:
  - trigger: ":ch"
    replace: "{{pick}}"
    vars:
      - name: pick
        type: choice
        params:
          values: ["a", "b"]
`);
        expect(result.skipped).toEqual([{ trigger: "ch", reason: 'uses a "choice" variable' }]);
    });

    it("skips a regex-trigger match, labeling it with the pattern", () => {
        const result = espansoYamlToSnippets(`
matches:
  - regex: "(?P<num>\\\\d+)-test"
    replace: "matched"
`);
        expect(result.snippets).toEqual({});
        expect(result.skipped).toEqual([
            { trigger: "regex:(?P<num>\\d+)-test", reason: "uses a regex trigger" },
        ]);
    });

    it("skips a match using propagate_case", () => {
        const result = espansoYamlToSnippets(`
matches:
  - trigger: ":cap"
    replace: "capitalized"
    propagate_case: true
`);
        expect(result.skipped).toEqual([{ trigger: "cap", reason: "uses case propagation" }]);
    });

    it("skips a match using uppercase_style", () => {
        const result = espansoYamlToSnippets(`
matches:
  - trigger: ":cap2"
    replace: "capitalized"
    uppercase_style: "capitalize_first"
`);
        expect(result.skipped).toEqual([{ trigger: "cap2", reason: "uses case propagation" }]);
    });

    it("skips an image match", () => {
        const result = espansoYamlToSnippets(`
matches:
  - trigger: ":img"
    image_path: "./images/logo.png"
`);
        expect(result.snippets).toEqual({});
        expect(result.skipped).toEqual([{ trigger: "img", reason: "is an image match" }]);
    });

    it("skips a markdown-only match", () => {
        const result = espansoYamlToSnippets(`
matches:
  - trigger: ":md"
    markdown: "**bold**"
`);
        expect(result.skipped).toEqual([
            { trigger: "md", reason: "uses markdown/html content Snipsy can't map" },
        ]);
    });

    it("skips an html-only match", () => {
        const result = espansoYamlToSnippets(`
matches:
  - trigger: ":ht"
    html: "<b>bold</b>"
`);
        expect(result.skipped).toEqual([
            { trigger: "ht", reason: "uses markdown/html content Snipsy can't map" },
        ]);
    });

    it("skips a match with an unrecognized var type not in the explicit forbidden list", () => {
        const result = espansoYamlToSnippets(`
matches:
  - trigger: ":rnd"
    replace: "{{n}}"
    vars:
      - name: n
        type: random
        params:
          choices: ["1", "2"]
`);
        expect(result.skipped).toEqual([
            { trigger: "rnd", reason: "uses variables Snipsy doesn't support" },
        ]);
    });

    it("skips a match with multiple vars even if all are the (otherwise mappable) date type", () => {
        const result = espansoYamlToSnippets(`
matches:
  - trigger: ":two"
    replace: "{{a}} {{b}}"
    vars:
      - name: a
        type: date
      - name: b
        type: date
        params:
          format: "%H:%M"
`);
        expect(result.skipped).toEqual([
            { trigger: "two", reason: "uses variables Snipsy doesn't support" },
        ]);
    });
});

// ---- B-139: free-win mappings ----

describe("espansoYamlToSnippets — free-win mappings (B-139)", () => {
    it("maps Espanso's `$|$` cursor placeholder to Snipsy's `$|`", () => {
        const result = espansoYamlToSnippets(`
matches:
  - trigger: ":cur"
    replace: "before$|$after"
`);
        expect(result.snippets.cur).toBe("before$|after");
        expect(result.skipped).toEqual([]);
    });

    it("maps `{{clipboard}}` to `$clipboard`", () => {
        const result = espansoYamlToSnippets(`
matches:
  - trigger: ":cb"
    replace: "Copied: {{clipboard}}"
`);
        expect(result.snippets.cb).toBe("Copied: $clipboard");
        expect(result.skipped).toEqual([]);
    });

    it("maps both `$|$` and `{{clipboard}}` together in the same replacement", () => {
        const result = espansoYamlToSnippets(`
matches:
  - trigger: ":both"
    replace: "{{clipboard}}$|$"
`);
        expect(result.snippets.both).toBe("$clipboard$|");
    });

    // B-139 (checker follow-up): an absent `format` param used to be
    // treated as "just a plain date" and mapped to `$date`. Espanso's
    // actual default for a bare `{type: date}` var is RFC 2822 output
    // (`now.to_rfc2822()` — see `espanso.ts`'s `classifyDateFormat`
    // doc comment), which does NOT render like Snipsy's `$date`
    // (`%Y-%m-%d`). Guessing here would silently change the output,
    // so this now skips instead of guessing (flipped from "maps a
    // trivial default-format date var to `$date`").
    it("skips a date var with no format param, rather than guessing at Espanso's default", () => {
        const result = espansoYamlToSnippets(`
matches:
  - trigger: ":today"
    replace: "Today: {{d}}"
    vars:
      - name: d
        type: date
`);
        expect(result.snippets).toEqual({});
        expect(result.skipped).toEqual([
            { trigger: "today", reason: "uses variables Snipsy doesn't support" },
        ]);
    });

    it("maps an explicit `%Y-%m-%d`-style date format to `$date`", () => {
        const result = espansoYamlToSnippets(`
matches:
  - trigger: ":today2"
    replace: "{{d}}"
    vars:
      - name: d
        type: date
        params:
          format: "%Y-%m-%d"
`);
        expect(result.snippets.today2).toBe("$date");
    });

    it("maps a time-only format to `$time`", () => {
        const result = espansoYamlToSnippets(`
matches:
  - trigger: ":now"
    replace: "{{t}}"
    vars:
      - name: t
        type: date
        params:
          format: "%H:%M"
`);
        expect(result.snippets.now).toBe("$time");
        expect(result.skipped).toEqual([]);
    });

    // B-139 (checker follow-up): boundary case — a pure-date format
    // that isn't the exact `%Y-%m-%d` order previously guessed its
    // way to `$date` (both are "just a date", classified identically
    // by the old token-presence heuristic). Reordering silently
    // changes the rendered output, so this must skip.
    it("skips a reordered pure-date format (`%d/%m/%Y`) rather than guessing at `$date`", () => {
        const result = espansoYamlToSnippets(`
matches:
  - trigger: ":eu"
    replace: "{{d}}"
    vars:
      - name: d
        type: date
        params:
          format: "%d/%m/%Y"
`);
        expect(result.snippets).toEqual({});
        expect(result.skipped).toEqual([
            { trigger: "eu", reason: "uses variables Snipsy doesn't support" },
        ]);
    });

    // Boundary case — a pure-time format with seconds would silently
    // drop the seconds if mapped to `$time` (`%H:%M`).
    it("skips a time format with seconds (`%H:%M:%S`) rather than guessing at `$time`", () => {
        const result = espansoYamlToSnippets(`
matches:
  - trigger: ":precise"
    replace: "{{t}}"
    vars:
      - name: t
        type: date
        params:
          format: "%H:%M:%S"
`);
        expect(result.snippets).toEqual({});
        expect(result.skipped).toEqual([
            { trigger: "precise", reason: "uses variables Snipsy doesn't support" },
        ]);
    });

    it("skips a fancy date format (mixed date+time) with a reason, rather than guessing", () => {
        const result = espansoYamlToSnippets(`
matches:
  - trigger: ":fancy"
    replace: "{{dt}}"
    vars:
      - name: dt
        type: date
        params:
          format: "%Y-%m-%d %H:%M"
`);
        expect(result.snippets).toEqual({});
        expect(result.skipped).toEqual([
            { trigger: "fancy", reason: "uses variables Snipsy doesn't support" },
        ]);
    });

    it("skips a date format using locale-specific tokens (weekday/month names)", () => {
        const result = espansoYamlToSnippets(`
matches:
  - trigger: ":verbose"
    replace: "{{d}}"
    vars:
      - name: d
        type: date
        params:
          format: "%A, %B %d"
`);
        expect(result.skipped).toEqual([
            { trigger: "verbose", reason: "uses variables Snipsy doesn't support" },
        ]);
    });

    // Uses an explicit `%Y-%m-%d` format (one of the two exact formats
    // that DOES map) so this still exercises the
    // placeholder-not-found branch, not the "format can't map" branch
    // covered by the test above.
    it("skips a date var whose name doesn't appear anywhere in the replacement text", () => {
        const result = espansoYamlToSnippets(`
matches:
  - trigger: ":unused"
    replace: "no placeholder here"
    vars:
      - name: d
        type: date
        params:
          format: "%Y-%m-%d"
`);
        expect(result.snippets).toEqual({});
        expect(result.skipped).toEqual([
            { trigger: "unused", reason: "uses a date variable Snipsy can't map" },
        ]);
    });
});

// ---- B-139: mixed packs — correct partition ----

describe("espansoYamlToSnippets — mixed packs (B-139)", () => {
    it("partitions a pack with both importable and unsupported matches correctly", () => {
        const result = espansoYamlToSnippets(`
matches:
  - trigger: ":brb"
    replace: "be right back"
  - trigger: ":addr"
    form: "Address: [[a]]"
    form_fields:
      a: {}
  - trigger: ":sh"
    replace: "{{o}}"
    vars:
      - name: o
        type: shell
        params:
          cmd: "date"
  - trigger: ":omw"
    replace: "on my way"
`);
        expect(result.snippets).toEqual({ brb: "be right back", omw: "on my way" });
        expect(result.skipped).toEqual([
            { trigger: "addr", reason: "uses a form" },
            { trigger: "sh", reason: 'uses a "shell" variable' },
        ]);
    });

    it("an all-importable pack produces an empty skipped list", () => {
        const result = espansoYamlToSnippets(`
matches:
  - trigger: ":a"
    replace: "1"
  - trigger: ":b"
    replace: "2"
`);
        expect(result.skipped).toEqual([]);
        expect(Object.keys(result.snippets)).toHaveLength(2);
    });

    it("an all-unsupported pack produces an empty snippets map with every match reported", () => {
        const result = espansoYamlToSnippets(`
matches:
  - trigger: ":a"
    form: "x"
    form_fields: {}
  - trigger: ":b"
    image_path: "./x.png"
`);
        expect(result.snippets).toEqual({});
        expect(result.skipped).toHaveLength(2);
    });
});
