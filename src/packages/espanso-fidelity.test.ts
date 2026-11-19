import { describe, it, expect } from "vitest";
import { espansoYamlToSnippets, MAX_REGEX_MATCHES } from "./espanso";
import { planGroupedImport } from "../core/install-plan";
import { planPatternImport } from "../core/espanso-pattern-plan";
import { applyPlaceholders } from "../engine/placeholders";
import { applyPatternReplacement, compileRule, matchPatterns } from "../engine/patterns";
import type { AppliedReplacement, ExpandContext } from "../engine/types";
import { makeMockPlugin } from "../test/factories/plugin";
import { fastestOf } from "../test/helpers";

/**
 * B-266: an Espanso replacement must insert in Snipsy exactly what Espanso inserts, or be skipped with a visible
 * reason. Everything below is literal text in Espanso that is live syntax in Snipsy (`$1`, `$|`, `$date`,
 * `{{date:FMT}}`, a placeholder glued to a word), on the literal path and on the regex path. The "inserted" checks
 * run the real pipeline: parse, plan, then the engine's own expansion.
 */

const CTX: ExpandContext = {
    isInCode: false,
    isInMath: false,
    isInFrontmatter: false,
    filename: "note.md",
    now: new Date("2025-09-02T10:11:12"),
    readClipboard: () => Promise.resolve("CLIP"),
};

/** One literal match, YAML single-quoted so `$` and `\` need no escaping (a quote is doubled by the caller). */
const literal = (replace: string, extra = ""): string => `matches:\n  - trigger: ':t'\n    replace: '${replace}'\n${extra}`;

/** One regex match, same quoting. */
const regexMatch = (regex: string, replace: string): string => `matches:\n  - regex: '${regex}'\n    replace: '${replace}'\n`;

/** What Snipsy inserts for the literal trigger `:t` of `yaml`, after the real plan. */
async function insertedLiteral(yaml: string): Promise<AppliedReplacement> {
    const parsed = espansoYamlToSnippets(yaml);
    expect(parsed.skipped).toEqual([]);
    const plan = planGroupedImport(parsed.snippets, "g", makeMockPlugin().settings);
    expect(plan.validation.isValid).toBe(true);
    const stored = plan.importable["t"];
    if (stored === undefined) throw new Error("the match was not imported");
    return applyPlaceholders(stored, CTX);
}

/** What Snipsy inserts when `typed` is typed with the one rule of the regex import `yaml`. */
async function insertedPattern(yaml: string, typed: string): Promise<string> {
    const parsed = espansoYamlToSnippets(yaml);
    expect(parsed.skipped).toEqual([]);
    const plan = planPatternImport(parsed.patterns, "g", makeMockPlugin().settings);
    expect(plan.skipped).toEqual([]);
    const compiled = compileRule(plan.add[0]);
    if (!compiled.ok) throw new Error(compiled.reason);
    const hit = matchPatterns(typed, [compiled.rule], plan.add[0]?.mode ?? "instant");
    if (!hit) throw new Error(`the rule did not match "${typed}"`);
    return (await applyPatternReplacement(hit, CTX)).text;
}

function skipOf(yaml: string): { trigger: string; reason: string; kind: string } {
    const parsed = espansoYamlToSnippets(yaml);
    expect(parsed.snippets).toEqual({});
    expect(parsed.patterns).toEqual([]);
    expect(parsed.skipped).toHaveLength(1);
    return parsed.skipped[0] as { trigger: string; reason: string; kind: string };
}

describe("B-266 literal path: a dollar amount stays text", () => {
    it("`costs $5` is stored with the engine's escape and inserts `costs $5`", async () => {
        const parsed = espansoYamlToSnippets(literal("costs $5"));
        expect(parsed.snippets).toEqual({ t: String.raw`costs \$5` });
        const applied = await insertedLiteral(literal("costs $5"));
        expect(applied.text).toBe("costs $5");
        expect(applied.cursorDelta).toBeUndefined();
    });

    it("`pay $1 on` keeps `$1` (it used to become `pay  on`)", async () => {
        expect((await insertedLiteral(literal("pay $1 on"))).text).toBe("pay $1 on");
    });

    it("two of them stay text and start no field session", async () => {
        const applied = await insertedLiteral(literal("$1 and $2"));
        expect(applied.text).toBe("$1 and $2");
        expect(applied.fields).toBeUndefined();
    });

    it("`$5` inside Markdown code is already literal and gets no backslash", async () => {
        expect(espansoYamlToSnippets(literal("run `$5` now")).snippets).toEqual({ t: "run `$5` now" });
        expect((await insertedLiteral(literal("run `$5` now"))).text).toBe("run `$5` now");
    });

    it("`$10`, `$1x` and `$1.50` are not tab stops and are left as written", async () => {
        for (const text of ["$10 off", "$1x", "$1.50"]) {
            expect(espansoYamlToSnippets(literal(text)).snippets).toEqual({ t: text });
            expect((await insertedLiteral(literal(text))).text).toBe(text);
        }
    });

    it("a backslash before `$5` would lose the backslash in the engine: skipped, not changed", () => {
        const skip = skipOf(literal(String.raw`a \$5 b`));
        expect(skip.reason).toContain("backslash");
        expect(skip.kind).toBe("literal");
    });
});

describe("B-266 literal path: placeholders written as plain text are skipped", () => {
    it.each(["$date", "$time", "$filename", "$clipboard"])("plain %s", (token) => {
        const skip = skipOf(literal(`due ${token} ok`));
        expect(skip.trigger).toBe("t");
        expect(skip.reason).toContain(`"${token}"`);
    });

    it("`pay $1 on $date` is skipped for the `$date` (the `$1` alone would have been escaped)", () => {
        expect(skipOf(literal("pay $1 on $date")).reason).toContain('"$date"');
    });

    it("`$dates` and `$date_x` are no placeholder for the engine and stay text", async () => {
        expect((await insertedLiteral(literal("$dates $date_x"))).text).toBe("$dates $date_x");
    });

    it("plain `$|` is skipped, but Espanso's own cursor `$|$` still works", async () => {
        expect(skipOf(literal("a $| b")).reason).toContain("cursor");
        const applied = await insertedLiteral(literal("a$|$b"));
        expect(applied.text).toBe("ab");
        expect(applied.cursorDelta).toBe(1);
    });

    it("`$|$|$` is the cursor and a `|`: no plain `$|` is left", async () => {
        const applied = await insertedLiteral(literal("x$|$|$"));
        expect(applied.text).toBe("x|$");
        expect(applied.cursorDelta).toBe(1);
    });

    it.each(["{{date:YYYY}}", "{{time:HH}}", "{{date:}}", "{{date}}", "{{time}}"])("%s is literal in Espanso and would expand here", (token) => {
        expect(skipOf(literal(`at ${token}`)).reason).toContain(token);
    });

    it("`{{ date }}` with spaces is a variable reference to Espanso, never text: skipped", () => {
        expect(skipOf(literal("{{ date }}")).reason).toContain("{{ date }}");
    });

    it("a `{{date:...}}` made by joining text and a mapped variable is caught on the final text", () => {
        expect(skipOf(literal("{{date:{{clipboard}}}}")).reason).toContain("{{date:{{clipboard}}}}");
    });

    it("a declared date variable does not excuse a literal `{{date:YYYY}}` next to it", () => {
        const yaml = literal("{{d}} {{date:YYYY}}", "    vars:\n      - name: d\n        type: date\n        params:\n          format: '%Y-%m-%d'\n");
        expect(skipOf(yaml).reason).toContain("{{date:YYYY}}");
    });

    it("a long `{{date:...}}` is cut in the reason", () => {
        expect(skipOf(literal(`{{date:${"x".repeat(100)}}}`)).reason).toContain("...");
    });
});

describe("B-266 literal path: `{{clipboard}}` next to a word character", () => {
    it("`{{clipboard}}_x` and `a{{ clipboard }}b` are skipped (`$clipboard_x` would be dead text)", () => {
        expect(skipOf(literal("{{clipboard}}_x")).reason).toContain("clipboard variable");
        expect(skipOf(literal("a{{ clipboard }}b")).reason).toContain("clipboard variable");
    });

    it("a space, punctuation or the end of the text after it is fine", async () => {
        expect((await insertedLiteral(literal("{{clipboard}} x"))).text).toBe("CLIP x");
        expect((await insertedLiteral(literal("({{ clipboard }}),{{clipboard}}"))).text).toBe("(CLIP),CLIP");
    });

    it("the engine's `\\b` is ASCII: a letter like `é` after it is fine and is kept", async () => {
        expect((await insertedLiteral(literal("{{clipboard}}é"))).text).toBe("CLIPé");
    });

    it("U+0085 inside the braces is whitespace to Espanso, so the variable still maps", async () => {
        const yaml = `matches:\n  - trigger: ':t'\n    replace: "[{{\\u0085clipboard\\u0085}}]"\n`;
        expect((await insertedLiteral(yaml)).text).toBe("[CLIP]");
    });

    it("a declared date variable glued to a word is skipped (`{{date}}` renders locale digits in some locales)", () => {
        expect(skipOf(literal("{{d}}x", DATE_VAR)).reason).toContain('"x" right after the date variable');
    });

    it("a declared time variable glued to a word is skipped", () => {
        expect(skipOf(literal("{{d}}h", TIME_VAR)).reason).toContain('"h" right after the time variable');
    });

    it("a declared date variable followed by a space keeps the `$date` form", () => {
        const yaml = literal("{{d}} x", "    vars:\n      - name: d\n        type: date\n        params:\n          format: '%Y-%m-%d'\n");
        expect(espansoYamlToSnippets(yaml).snippets).toEqual({ t: "$date x" });
    });
});

describe("B-266 literal path: a declared clipboard variable", () => {
    const decl = "    vars:\n      - name: clip\n        type: clipboard\n";

    it("`{{clip}}` maps to the clipboard like the undeclared `{{clipboard}}`", async () => {
        const yaml = literal(">{{clip}}< >{{ clip }}<", decl);
        expect(espansoYamlToSnippets(yaml).snippets).toEqual({ t: ">$clipboard< >$clipboard<" });
        expect((await insertedLiteral(yaml)).text).toBe(">CLIP< >CLIP<");
    });

    it("a variable named `clipboard` of type clipboard maps too", async () => {
        const yaml = literal("{{clipboard}}!", "    vars:\n      - name: clipboard\n        type: clipboard\n");
        expect((await insertedLiteral(yaml)).text).toBe("CLIP!");
    });

    it("the built-in `{{clipboard}}` still maps next to a declared variable", async () => {
        expect((await insertedLiteral(literal("{{clip}}/{{clipboard}}", decl))).text).toBe("CLIP/CLIP");
    });

    it("glued to a word it is skipped", () => {
        expect(skipOf(literal("{{clip}}x", decl)).reason).toContain("clipboard variable");
    });

    it("declared but never used is skipped, as an unused date variable is", () => {
        expect(skipOf(literal("plain", decl)).reason).toBe("uses a clipboard variable Snipsy can't map");
    });

    it("with a second variable it is skipped (only a lone variable is mapped)", () => {
        const two = `${decl}      - name: d\n        type: date\n        params:\n          format: '%Y-%m-%d'\n`;
        expect(skipOf(literal("{{clip}}", two)).reason).toBe("uses variables Snipsy doesn't support");
    });

    it("a different variable type is still skipped", () => {
        expect(skipOf(literal("{{x}}", "    vars:\n      - name: x\n        type: random\n")).reason).toBe("uses variables Snipsy doesn't support");
    });
});

describe("B-266 regex path: the replacement is read the same way", () => {
    it("`costs $5` is stored escaped and inserts `costs $5` after the capture", async () => {
        const yaml = regexMatch(String.raw`pay(?P<n>\d)`, "{{n}} costs $5");
        expect(espansoYamlToSnippets(yaml).patterns[0]?.replacement).toBe(String.raw`{{n}} costs \$5`);
        expect(await insertedPattern(yaml, "pay7")).toBe("7 costs $5");
    });

    it("`pay $1 on` keeps `$1`", async () => {
        expect(await insertedPattern(regexMatch(String.raw`pay(?P<n>\d)`, "pay $1 on {{n}}"), "pay7")).toBe("pay $1 on 7");
    });

    it("a captured `$5` is still inserted literally next to the escaped one", async () => {
        expect(await insertedPattern(regexMatch(String.raw`x(?P<n>\S+)`, "$2 {{n}}"), "x$1")).toBe("$2 $1");
    });

    it.each(["$date", "$time", "$filename", "$clipboard", "{{date:YYYY}}", "{{time:}}"])("plain %s is skipped as a regex match", (token) => {
        const skip = skipOf(regexMatch(String.raw`pay(?P<n>\d)`, `{{n}} ${token}`));
        expect(skip.kind).toBe("regex");
        expect(skip.trigger).toBe(String.raw`regex:pay(?P<n>\d)`);
        expect(skip.reason).toContain(token);
    });

    it("plain `$|` is skipped, `$|$` is the cursor", () => {
        expect(skipOf(regexMatch("abc", "a $| b")).reason).toContain("cursor");
        expect(espansoYamlToSnippets(regexMatch("abc", "a$|$b")).patterns[0]?.replacement).toBe("a$|b");
    });

    it("`{{clipboard}}` maps, glued to a word it is skipped", async () => {
        expect(await insertedPattern(regexMatch("abc", "{{clipboard}} x"), "abc")).toBe("CLIP x");
        expect(skipOf(regexMatch("abc", "{{clipboard}}_x")).reason).toContain("clipboard variable");
    });

    it("a regex match with a declared variable is still skipped (a name could be a capture group)", () => {
        const yaml = `matches:\n  - regex: 'abc'\n    replace: '{{clip}}'\n    vars:\n      - name: clip\n        type: clipboard\n`;
        expect(skipOf(yaml).reason).toBe("uses variables Snipsy doesn't support");
    });

    it("a backslash before `$5` is skipped here too", () => {
        expect(skipOf(regexMatch("abc", String.raw`a \$5`)).reason).toContain("backslash");
    });

    it("the match past the 1000 limit names itself as a regex skip", () => {
        const many = Array.from({ length: MAX_REGEX_MATCHES + 1 }, (_, i) => `  - regex: 'x${i}'\n    replace: 'r${i}'\n`).join("");
        const last = espansoYamlToSnippets(`matches:\n${many}`).skipped[0];
        expect(last?.kind).toBe("regex");
        expect(last?.trigger).toBe(`regex:x${MAX_REGEX_MATCHES}`);
    });
});

const DATE_VAR = "    vars:\n      - name: d\n        type: date\n        params:\n          format: '%Y-%m-%d'\n";
const TIME_VAR = "    vars:\n      - name: d\n        type: date\n        params:\n          format: '%H:%M'\n";
const varsOf = (name: string, type = "clipboard", params = ""): string =>
    `    vars:\n      - name: '${name}'\n        type: ${type}\n${params}`;

describe("B-266 declared names: only Espanso's reference shape maps, and never through a regex built from the name", () => {
    it.each(["", "  ", "my-var", "a.b", "a b", "x}}"])("name %j is skipped, the text stays out of the import", (name) => {
        const skip = skipOf(literal("{{ }} {{my-var}} {{a.b}}", varsOf(name)));
        expect(skip.reason).toBe("uses variables Snipsy doesn't support");
    });

    it("`my-var` is literal text in Espanso, so it is not turned into the clipboard", () => {
        expect(skipOf(literal("a {{my-var}} b", varsOf("my-var"))).reason).toBe("uses variables Snipsy doesn't support");
    });

    it("a Unicode name maps (`\\w` in Espanso is Unicode)", async () => {
        expect((await insertedLiteral(literal("{{ключ}}", varsOf("ключ")))).text).toBe("CLIP");
    });

    it("`{{` followed by 50k spaces is scanned in well under 200 ms with a declared name; a quadratic scan takes seconds", () => {
        const yaml = literal(`{{ ${" ".repeat(50_000)}`, varsOf("x"));
        espansoYamlToSnippets(literal(`{{ ${" ".repeat(5_000)}`, varsOf("x"))); // warm-up
        const took = fastestOf(() => {
            const started = performance.now();
            const result = espansoYamlToSnippets(yaml);
            const elapsed = performance.now() - started;
            expect(result.skipped).toHaveLength(1);
            return elapsed;
        }, 200, 1_000);
        expect(took).toBeLessThan(200);
    }, 30_000);

    it("the same input with an empty declared name does not even build a pattern from it", () => {
        const big = " ".repeat(200_000);
        const result = espansoYamlToSnippets(`matches:\n  - trigger: ':t'\n    replace: '{{${big}'\n    vars:\n      - name: ''\n        type: clipboard\n`);
        expect(result.skipped[0]?.reason).toBe("uses variables Snipsy doesn't support");
    }, 20_000);
});

describe("B-266 a mapped token followed directly by a date, time or word character", () => {
    it("`{{clipboard}}{{d}}` is skipped (`$clipboard2025-...` would be dead text)", () => {
        expect(skipOf(literal("{{clipboard}}{{d}}", DATE_VAR)).reason).toContain("clipboard variable");
    });

    it("`{{clipboard}} {{d}}` with text in between imports", async () => {
        const yaml = literal("{{clipboard}} {{d}}", DATE_VAR);
        expect(espansoYamlToSnippets(yaml).snippets).toEqual({ t: "$clipboard $date" });
        expect((await insertedLiteral(yaml)).text).toBe("CLIP 2025-09-02");
    });

    it("`{{d}}{{d}}a` is skipped (the second token would be glued to the letter)", () => {
        expect(skipOf(literal("{{d}}{{d}}a", DATE_VAR)).reason).toContain("right after the date variable");
    });

    it("`{{d}}{{d}}` with nothing or a non-word character after imports and inserts what Espanso inserts", async () => {
        const bare = literal("{{d}}{{d}}", DATE_VAR);
        expect(espansoYamlToSnippets(bare).snippets).toEqual({ t: "$date$date" });
        expect((await insertedLiteral(bare)).text).toBe("2025-09-022025-09-02");
        expect((await insertedLiteral(literal("{{d}}{{d}}!", DATE_VAR))).text).toBe("2025-09-022025-09-02!");
    });

    it("`{{t}}{{t}}` with a `%H:%M` variable imports as `$time$time`", async () => {
        const yaml = literal("{{d}}{{d}}", TIME_VAR);
        expect(espansoYamlToSnippets(yaml).snippets).toEqual({ t: "$time$time" });
        expect((await insertedLiteral(yaml)).text).toBe("10:1110:11");
    });

    it("a date followed directly by the clipboard needs no braces", async () => {
        const yaml = literal("{{d}}{{clipboard}}", DATE_VAR);
        expect(espansoYamlToSnippets(yaml).snippets).toEqual({ t: "$date$clipboard" });
        expect((await insertedLiteral(yaml)).text).toBe("2025-09-02CLIP");
    });

    it("`{{t}}{{t}}a` with a `%H:%M` variable is skipped as well", () => {
        expect(skipOf(literal("{{d}}{{d}}a", TIME_VAR)).reason).toContain("right after the time variable");
    });

    it("a cursor between them keeps the short forms", () => {
        expect(espansoYamlToSnippets(literal("{{d}}$|${{d}}", DATE_VAR)).snippets).toEqual({ t: "$date$|$date" });
    });

    it("the regex path does the same", async () => {
        const yaml = regexMatch("abc", "{{clipboard}}{{clipboard}} z");
        expect(await insertedPattern(yaml, "abc")).toBe("CLIPCLIP z");
        expect(skipOf(regexMatch("abc", "{{clipboard}}{{date}}")).reason).toContain("{{date}}");
    });
});

describe("B-266 a reference the match does not declare is a variable to Espanso, never text", () => {
    it.each(["{{foo}}", "{{ foo }}", "{{foo.bar}}", "{{ключ}}", "{{date}}"])("%s is skipped with its own text in the reason", (token) => {
        const skip = skipOf(literal(`a ${token} b`));
        expect(skip.reason).toContain(`uses ${token}, a variable this match does not declare`);
        expect(skip.reason).toContain("global_vars");
    });

    it("`{{clipboard}}` without a declaration still maps (a Snipsy convenience)", async () => {
        expect((await insertedLiteral(literal("[{{clipboard}}]"))).text).toBe("[CLIP]");
    });

    it("`{{clipboard.x}}` is a reference with a sub-name, not the convenience", () => {
        expect(skipOf(literal("{{clipboard.x}}")).reason).toContain("{{clipboard.x}}");
    });

    it("a declared variable does not excuse another reference", () => {
        expect(skipOf(literal("{{d}} {{other}}", DATE_VAR)).reason).toContain("{{other}}");
    });

    it("braces that are not a reference stay text", async () => {
        expect((await insertedLiteral(literal("{{ }} {{a-b}} {{}} { {x} }"))).text).toBe("{{ }} {{a-b}} {{}} { {x} }");
    });

    it("a long reference is cut in the reason", () => {
        expect(skipOf(literal(`{{${"x".repeat(100)}}}`)).reason).toContain("...");
    });

    it("on a regex match `{{name}}` is a capture group and still imports", async () => {
        expect(await insertedPattern(regexMatch(String.raw`pay(?P<n>\d)`, "got {{n}}"), "pay7")).toBe("got 7");
    });

    it("on a regex match a name that is no group is refused by the pattern conversion", () => {
        expect(skipOf(regexMatch(String.raw`pay(?P<n>\d)`, "got {{foo}}")).kind).toBe("regex");
    });
});

describe("B-266 the cursor: Espanso removes every `$|$` and puts the cursor at the first", () => {
    it("`a$|$b$|$c` is stored with one `$|` and puts the caret after `a`", async () => {
        expect(espansoYamlToSnippets(literal("a$|$b$|$c")).snippets).toEqual({ t: "a$|bc" });
        const applied = await insertedLiteral(literal("a$|$b$|$c"));
        expect(applied.text).toBe("abc");
        expect(applied.cursorDelta).toBe(1);
    });

    it("three of them leave one", () => {
        expect(espansoYamlToSnippets(literal("$|$$|$$|$")).snippets).toEqual({ t: "$|" });
    });

    it("dropping one must not join `$` and `|` into a cursor Espanso never made", () => {
        expect(skipOf(literal("$|$a$$|$|b")).reason).toContain("cursor");
    });

    it("dropping one must not join `$da` and `te` into a placeholder", () => {
        expect(skipOf(literal("$|$ $da$|$te")).reason).toContain('"$date"');
    });

    it("the regex path keeps one too", async () => {
        const yaml = regexMatch("abc", "a$|$b$|$c");
        expect(espansoYamlToSnippets(yaml).patterns[0]?.replacement).toBe("a$|bc");
        expect(await insertedPattern(yaml, "abc")).toBe("abc");
    });
});

describe("B-266 date variables: only `format` is mapped", () => {
    it.each(["offset: 3600", "tz: 'UTC'", "locale: 'de'"])("%s is skipped", (param) => {
        const yaml = literal("{{d}}", `    vars:\n      - name: d\n        type: date\n        params:\n          format: '%Y-%m-%d'\n          ${param}\n`);
        const skip = skipOf(yaml);
        expect(skip.reason).toContain("can't map");
        expect(skip.reason).toContain(param.split(":")[0]);
    });

    it("a stray `word: true` is ignored, as Espanso ignores it", () => {
        const yaml = literal("{{d}}", `${DATE_VAR}          word: true\n`);
        expect(espansoYamlToSnippets(yaml).snippets).toEqual({ t: "$date" });
    });

    it("a date variable with `format` alone still maps", () => {
        expect(espansoYamlToSnippets(literal("{{d}}", DATE_VAR)).snippets).toEqual({ t: "$date" });
    });
});

describe("B-266 escaped braces", () => {
    it.each([String.raw`\{\{x\}\}`, String.raw`a \}\} b`, String.raw`\{\{`])("%s is skipped on both paths", (text) => {
        expect(skipOf(literal(text)).reason).toContain("plain braces");
        expect(skipOf(regexMatch("abc", text)).reason).toContain("plain braces");
    });

    it("a lone `\\{` or braces without the backslash pair are not escapes", async () => {
        expect((await insertedLiteral(literal(String.raw`\{ x \}`))).text).toBe(String.raw`\{ x \}`);
    });
});

describe("B-266 the reason quotes what the user wrote", () => {
    it("`{{date:{{clipboard}}}}` is quoted as written", () => {
        const reason = skipOf(literal("x {{date:{{clipboard}}}} y")).reason;
        expect(reason).toContain('"{{date:{{clipboard}}}}"');
        expect(reason).not.toContain("$clipboard");
    });
});

describe("B-266 Espanso's word: Alphabetic, marks, Nd, Pc, Join_Control; whitespace is White_Space", () => {
    it("`a²` is no name (`²` is not a digit there): `{{a²}}` is literal text, so the match imports", () => {
        expect(espansoYamlToSnippets(literal("{{a²}}")).snippets).toEqual({ t: "{{a²}}" });
        expect(skipOf(literal("{{d}}", `${DATE_VAR.replace("name: d", "name: 'a²'")}`)).reason).toBe("uses variables Snipsy doesn't support");
    });

    it("U+FEFF inside the braces is not whitespace there: `{{\uFEFFx}}` is literal text", () => {
        expect(espansoYamlToSnippets(`matches:\n  - trigger: ':t'\n    replace: "{{\\uFEFFx}}"\n`).skipped).toEqual([]);
    });

    it("`{{Ⓐ}}` (Alphabetic) is a reference, so an undeclared one is skipped", () => {
        expect(skipOf(literal("{{Ⓐ}}")).reason).toContain("a variable this match does not declare");
    });

    it("U+200D (Join_Control) is part of a word", () => {
        expect(skipOf(`matches:\n  - trigger: ':t'\n    replace: "{{a\\u200Db}}"\n`).reason).toContain("a variable this match does not declare");
    });

    it("U+2003 (EM SPACE) around a name is whitespace", () => {
        expect(skipOf(`matches:\n  - trigger: ':t'\n    replace: "{{\\u2003foo\\u2003}}"\n`).reason).toContain("a variable this match does not declare");
    });
});
