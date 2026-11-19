import type { PatternMode } from "../engine/types";

/**
 * ADR-0008, Patterns page: the typography starter set. The 32 rules are the defaults of the Substitutions plugin
 * (fractions, arrows, comparisons, plus-minus, ellipsis, double arrows), ported as patterns.
 *
 * Fractions fire "After a separator", so `1/23` can still be typed (an instant `1/2` rule fires at `1/2` and leaves
 * the `3` behind). They cannot start right after a word character or a slash: `11/2` is not `1` + `½`, and the `1/2`
 * in `5/1/2` is part of a date. Arrows, comparisons and the rest are two or three characters nobody types by
 * accident, so they stay `Instant`.
 */
/** The group is stored as a slug, like a snippet group (so the two mute together), and shown as "Typography". */
export const STARTER_GROUP = "typography";

export type StarterRule = { source: string; replacement: string; mode: PatternMode; group: string };

const FRACTIONS: ReadonlyArray<readonly [string, string]> = [
    ["1/2", "½"],
    ["1/3", "⅓"],
    ["1/4", "¼"],
    ["1/5", "⅕"],
    ["1/6", "⅙"],
    ["1/7", "⅐"],
    ["1/9", "⅑"],
    ["1/10", "⅒"],
    ["1/8", "⅛"],
    ["2/3", "⅔"],
    ["2/5", "⅖"],
    ["3/4", "¾"],
    ["3/5", "⅗"],
    ["4/5", "⅘"],
    ["5/6", "⅚"],
    ["3/8", "⅜"],
    ["5/8", "⅝"],
    ["7/8", "⅞"],
];

/** Pattern body (the literal text, escaped), replacement. */
const SYMBOLS: ReadonlyArray<readonly [string, string]> = [
    ["\\.\\.\\.", "…"],
    ["<--", "←"],
    ["-->", "→"],
    ["<->", "↔"],
    ["!=", "≠"],
    ["<=", "≤"],
    [">=", "≥"],
    ["~=", "≅"],
    ["\\+-", "±"],
    ["-\\+", "∓"],
    ["<<", "≪"],
    ["≪<", "⋘"],
    [">>", "≫"],
    ["≫>", "⋙"],
];

export const STARTER_RULES: readonly StarterRule[] = [
    ...FRACTIONS.map(([typed, glyph]): StarterRule => ({
        source: `/(?<![\\w\\/])${typed.replace("/", "\\/")}$/`,
        replacement: glyph,
        mode: "separator",
        group: STARTER_GROUP,
    })),
    ...SYMBOLS.map(([body, glyph]): StarterRule => ({
        source: `/${body}$/`,
        replacement: glyph,
        mode: "instant",
        group: STARTER_GROUP,
    })),
];
