import { describe, it, expect } from "vitest";
import { expand, expandInstant } from "../../engine/expand";
import { MAX_PATTERN_RULES, matchPatterns } from "../../engine/patterns";
import type { ExpandContext } from "../../engine/types";
import { commitSnippetsAndPatterns } from "../../core/commit-snippets";
import { planPatternImport } from "../../core/espanso-pattern-plan";
import { planGroupedImport } from "../../core/install-plan";
import { readPatterns } from "../../core/pattern-list";
import { espansoYamlToSnippets, MAX_REGEX_MATCHES } from "../../packages/espanso";
import { getDict } from "../../store/snippets";
import { getCompiledPatterns } from "../../store/patterns";
import type { SnipSidianSettings } from "../../types";

/**
 * ADR-0008, Espanso regex import, end to end below the UI: a realistic Espanso file is parsed, planned, committed
 * the way the Apply button does it, and the stored rules are then compiled by the engine and fired through
 * `expand()` / `expandInstant()`. The second half is the S-009 / S-015 check: a hostile file cannot get past the
 * gate or the cap.
 */

const ctx: ExpandContext = { isInCode: false, isInMath: false, isInFrontmatter: false, now: new Date("2026-11-19T10:00:00Z") };

const ESPANSO_FILE = String.raw`
name: my-pack
matches:
  - trigger: ":brb"
    replace: "be right back"
  - triggers: [":omw", ":otw"]
    replace: "on my way"
  - regex: ':(?P<word>\w+):'
    replace: "[{{word}}]"
  - regex: '(?i)dd(?P<n>\d)'
    replace: "day {{n}}"
  - regex: '(?P<a>\d+)/(?P<b>\d+)'
    replace: "{{a}}⁄{{b}}"
  - regex: '\p{L}+x'
    replace: "refused"
  - trigger: ":addr"
    form: "Address [[street]]"
    form_fields: { street: {} }
  - regex: '(?P<d>\d+)d'
    replace: "{{d}}"
    vars:
      - name: x
        type: shell
        params: { cmd: "date" }
`;

/** What the Apply button does: plan the snippets, plan the rules, commit both with one save. */
async function importFile(yaml: string, settings: SnipSidianSettings, group = "my-pack"): Promise<{ saves: number }> {
    const parsed = espansoYamlToSnippets(yaml);
    const snippetPlan = planGroupedImport(parsed.snippets, group, settings);
    expect(snippetPlan.validation.errors).toEqual([]);
    const patternPlan = planPatternImport(parsed.patterns, group, settings);
    let saves = 0;
    const resolved = { ...settings.snippets };
    for (const a of snippetPlan.diff.added) resolved[a.key] = a.value;
    await commitSnippetsAndPatterns(settings, resolved, [...readPatterns(settings), ...patternPlan.add], async () => {
        saves++;
    });
    return { saves };
}

describe("Espanso regex import, end to end", () => {
    it("a mixed file stores literal snippets and rules together, and the rules fire through the engine", async () => {
        const settings: SnipSidianSettings = { snippets: {} };
        const { saves } = await importFile(ESPANSO_FILE, settings);

        expect(saves).toBe(1);
        expect(Object.keys(settings.snippets).sort()).toEqual(["my-pack/brb", "my-pack/omw", "my-pack/otw"]);
        expect(settings.patterns?.map((r) => [r.source, r.mode, r.group])).toEqual([
            [String.raw`/:(?<word>\w+):$/`, "instant", "my-pack"],
            [String.raw`/dd(?<n>\d)$/i`, "instant", "my-pack"],
            [String.raw`/(?<a>\d+)/(?<b>\d+)$/`, "separator", "my-pack"],
        ]);

        // The engine takes every stored rule: nothing is switched off at compile time.
        const compiled = getCompiledPatterns(settings);
        expect(compiled.errors).toEqual([]);
        expect(compiled.rules).toHaveLength(3);

        // A literal snippet still wins and expands as before.
        const dict = getDict(settings);
        const literal = await expand({ textBefore: "x :brb", textAfter: "", lastTyped: " ", sepCh: 6 }, dict, ctx, undefined, compiled.rules);
        expect(literal?.insert).toBe("be right back");

        // Instant rule with a named group: fires as soon as the closing colon is typed.
        const smile = matchPatterns("hi :smile:", compiled.rules, "instant");
        expect(smile).not.toBeNull();
        expect((await expandInstant("hi :smile:", ctx, smile!))?.insert).toBe("[smile]");

        // `(?i)` became the flag i.
        const day = matchPatterns("on DD5", compiled.rules, "instant");
        expect((await expandInstant("on DD5", ctx, day!))?.insert).toBe("day 5");

        // Two open-ended repeats: imported as After a separator, fires on the space.
        const fraction = await expand({ textBefore: "see 3/4", textAfter: "", lastTyped: " ", sepCh: 7 }, dict, ctx, undefined, compiled.rules);
        expect(fraction).toMatchObject({ kind: "pattern", insert: "3⁄4" });
    });

    it("names what it could not import: the \\p{L} rule, the form, the shell var", async () => {
        const settings: SnipSidianSettings = { snippets: {} };
        const parsed = espansoYamlToSnippets(ESPANSO_FILE);
        expect(parsed.skipped.map((s) => s.trigger)).toEqual([String.raw`regex:\p{L}+x`, "addr", String.raw`regex:(?P<d>\d+)d`]);
        expect(parsed.skipped.map((s) => s.reason)).toEqual([
            "Unicode property classes like \\p{L} aren't supported yet. Use \\w or a range such as [а-яё].",
            "uses a form",
            'uses a "shell" variable',
        ]);
        await importFile(ESPANSO_FILE, settings);
        expect(settings.patterns).toHaveLength(3);
    });

    it("importing the same file again adds nothing: every rule is 'already there'", async () => {
        const settings: SnipSidianSettings = { snippets: {} };
        await importFile(ESPANSO_FILE, settings);
        const parsed = espansoYamlToSnippets(ESPANSO_FILE);
        const second = planPatternImport(parsed.patterns, "my-pack", settings);
        expect(second.add).toEqual([]);
        expect(second.skipped.map((s) => s.reason)).toEqual(["already there.", "already there.", "already there."]);
    });
});

describe("Espanso regex import, hostile files (S-009, S-015)", () => {
    const yamlOf = (entries: string[]): string => `matches:\n${entries.join("")}`;
    const entry = (regex: string, replace = "x"): string => `  - regex: '${regex.replace(/'/g, "''")}'\n    replace: "${replace}"\n`;

    it("500 regex entries cannot put more than 100 rules in the list, and every rule that lands compiles", async () => {
        const settings: SnipSidianSettings = { snippets: {} };
        const file = yamlOf(Array.from({ length: 500 }, (_, i) => entry(`k${i}x`, `r${i}`)));
        const parsed = espansoYamlToSnippets(file);
        expect(parsed.patterns).toHaveLength(500);
        const plan = planPatternImport(parsed.patterns, "pack", settings);
        expect(plan.add).toHaveLength(MAX_PATTERN_RULES);
        expect(plan.skipped).toHaveLength(400);
        expect(new Set(plan.skipped.map((s) => s.reason))).toEqual(new Set(["over the 100 rule limit."]));
        settings.patterns = plan.add;
        expect(getCompiledPatterns(settings).errors).toEqual([]);
    });

    it("the cap counts the rules the person already has", () => {
        const have = Array.from({ length: 60 }, (_, i) => ({ id: `o${i}`, source: `/old${i}$/`, replacement: "o", enabled: true, mode: "instant" as const }));
        const parsed = espansoYamlToSnippets(yamlOf(Array.from({ length: 500 }, (_, i) => entry(`k${i}x`))));
        const plan = planPatternImport(parsed.patterns, "pack", { patterns: have });
        expect(plan.add).toHaveLength(40);
    });

    it("ReDoS-shaped regexes never reach the plan, whatever their number", () => {
        const evil = [
            "(a+)+", "(a*)*", "(a|a)*", "(a|aa)+", String.raw`(\w+\s?)+`, "(?:a+)+", "(.*a){20}", "([a-z]+)*", "(a{1,10}){1,10}",
            String.raw`\w*\w*\w*\w*`, String.raw`\w{0,40}\w{0,40}\w{0,40}\w{0,40}\w{0,40}`, "(a)\\1", "(?<=x+)y", "x(?=y)",
        ];
        const file = yamlOf(Array.from({ length: 500 }, (_, i) => entry(`${evil[i % evil.length]}`, `r${i}`)));
        const parsed = espansoYamlToSnippets(file);
        expect(parsed.patterns).toEqual([]);
        expect(parsed.skipped).toHaveLength(500);
        const plan = planPatternImport(parsed.patterns, "pack", { patterns: [] });
        expect(plan.add).toEqual([]);
    });

    it("a ReDoS-shaped regex hidden among good ones is the only one left out", () => {
        const file = yamlOf([entry("good1x"), entry("(a+)+$"), entry("good2x")]);
        const parsed = espansoYamlToSnippets(file);
        expect(parsed.patterns.map((p) => p.label)).toEqual(["regex:good1x", "regex:good2x"]);
        expect(parsed.skipped.map((s) => s.trigger)).toEqual(["regex:(a+)+$"]);
    });

    it("thousands of regex entries are not all read: the importer stops converting at its own limit", () => {
        const file = yamlOf(Array.from({ length: 3000 }, (_, i) => entry(`k${i}x`)));
        const parsed = espansoYamlToSnippets(file);
        expect(parsed.patterns).toHaveLength(MAX_REGEX_MATCHES);
        expect(parsed.skipped).toHaveLength(3000 - MAX_REGEX_MATCHES);
    });
});
