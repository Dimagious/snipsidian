import { applyPlaceholders } from "./placeholders";
import type { AppliedReplacement, ExpandContext, PatternMode } from "./types";

/**
 * ADR-0008: regex triggers ("patterns"). Pure functions, no Obsidian imports.
 *
 * Three jobs live here:
 *   1. the S-015 static check (`checkPattern`): a small parser over the pattern,
 *      not a regex over the regex, that refuses what can make a JS `exec` slow
 *      or ambiguous (a JS regex cannot be interrupted, so the defence is to
 *      never run a dangerous one);
 *   2. the ONE place a rule becomes a `RegExp` (`compileRule`, via the private
 *      `compileSource`). It always runs the check, there is no bypass
 *      (S-009 lesson: a gate on some write paths only is no gate);
 *   3. matching and replacement (`matchPatterns`, `applyPatternReplacement`).
 */

/** The matcher sees at most this many characters before the caret/separator. */
export const PATTERN_TAIL_LIMIT = 64;
/** More rules than this are not compiled: the cost per separator is bounded. */
export const MAX_PATTERN_RULES = 100;
export const MAX_PATTERN_BODY = 200;
/** Same cap as a snippet replacement. */
export const MAX_PATTERN_REPLACEMENT = 10_000;
/** Three overlapping unbounded quantifiers take ~4 ms per test, two ~0.1 ms (ADR-0008, measured). */
const MAX_UNBOUNDED_QUANTIFIERS = 2;
/** Group names that placeholders already use (or will: B-204, B-218). */
const RESERVED_GROUP_NAMES: ReadonlySet<string> = new Set(["date", "time", "title", "notedate"]);
/**
 * Largest product of choices (`?` = 2, `{n,m}` = m-n+1) of the bounded variable quantifiers, by the number of
 * unbounded ones (0, 1, 2). The ADR only counts unbounded quantifiers, but overlapping bounded ones backtrack just
 * as badly (measured 2026-11-18, Node, 64-char input: `a?` x16 = 21 ms, `\w{0,10}` x5 = 308 ms, `a?a?a?a?\w+\w+` = 2 ms).
 * With these limits the worst case measured stays near 0.5 ms; `[+-]?\d+(?:\.\d+)?` (2 unbounded, product 4) passes.
 */
const MAX_BOUNDED_CHOICES: readonly number[] = [1024, 16, 4];
/** Compile cache bound: far above 100 rules, so only a stream of edits ever hits it. */
const MAX_CACHE_ENTRIES = 500;

/** A refusal with a reason a person can read (sentence case, shown by the editor later). */
class Refusal extends Error {}

// ---------------------------------------------------------------------------
// Pattern parser (just enough regex syntax to run the S-015 checks)
// ---------------------------------------------------------------------------

type Anchor = "bol" | "eol" | "word";
type Node =
    | { kind: "atom" }
    | { kind: "assert"; anchor: Anchor }
    | { kind: "group"; behind: boolean; alts: Term[][] };
/** `max` is `Infinity` for `*`, `+`, `{n,}`. */
type Term = { node: Node; min: number; max: number; quantified: boolean };

const REASON_BACKREF = "Backreferences like \\1 or \\k<name> are not supported.";
const REASON_LOOKAHEAD = "Lookahead, (?=...) and (?!...), is not supported.";

class Parser {
    pos = 0;
    readonly names: string[] = [];

    constructor(private readonly src: string) {}

    parseAlternatives(): Term[][] {
        let current: Term[] = [];
        const alts: Term[][] = [current];
        while (this.pos < this.src.length) {
            const c = this.src[this.pos];
            if (c === ")") break;
            if (c === "|") {
                this.pos++;
                current = [];
                alts.push(current);
                continue;
            }
            current.push(this.parseTerm());
        }
        return alts;
    }

    private parseTerm(): Term {
        const node = this.parseAtom();
        let min = 1;
        let max = 1;
        let quantified = false;
        const c = this.src[this.pos];
        if (c === "*") {
            min = 0;
            max = Infinity;
            quantified = true;
            this.pos++;
        } else if (c === "+") {
            max = Infinity;
            quantified = true;
            this.pos++;
        } else if (c === "?") {
            min = 0;
            quantified = true;
            this.pos++;
        } else if (c === "{") {
            const m = /^\{(\d+)(?:(,)(\d*))?\}/.exec(this.src.slice(this.pos));
            if (m) {
                min = Number(m[1]);
                max = m[2] === undefined ? min : m[3] === "" ? Infinity : Number(m[3]);
                quantified = true;
                this.pos += m[0].length;
            }
        }
        // Lazy marker: `a+?`. It changes nothing for the checks.
        if (quantified && this.src[this.pos] === "?") this.pos++;
        return { node, min, max, quantified };
    }

    private parseAtom(): Node {
        const c = this.src[this.pos++];
        switch (c) {
            case "\\":
                return this.parseEscape();
            case "[":
                this.skipClass();
                return { kind: "atom" };
            case "(":
                return this.parseGroup();
            case "^":
                return { kind: "assert", anchor: "bol" };
            case "$":
                return { kind: "assert", anchor: "eol" };
            case "*":
            case "+":
            case "?":
                throw new Refusal("A quantifier has nothing to repeat.");
            default:
                // Literal, `.`, or a `{` that is not a quantifier.
                return { kind: "atom" };
        }
    }

    private parseEscape(): Node {
        const e = this.src[this.pos++];
        if (e === undefined) throw new Refusal("The pattern ends with a lone backslash.");
        if (e >= "1" && e <= "9") throw new Refusal(REASON_BACKREF);
        if (e === "k" && this.src[this.pos] === "<") throw new Refusal(REASON_BACKREF);
        if (e === "b" || e === "B") return { kind: "assert", anchor: "word" };
        if ((e === "p" || e === "P" || e === "u") && this.src[this.pos] === "{") {
            const end = this.src.indexOf("}", this.pos);
            if (end < 0) throw new Refusal("An escape is missing its closing brace.");
            this.pos = end + 1;
        } else if (e === "u") {
            this.skipHex(4);
        } else if (e === "x") {
            this.skipHex(2);
        } else if (e === "c") {
            this.pos++;
        }
        return { kind: "atom" };
    }

    private skipHex(count: number): void {
        for (let i = 0; i < count && /[0-9a-fA-F]/.test(this.src[this.pos] ?? ""); i++) this.pos++;
    }

    /** `this.pos` is just after the `[`. */
    private skipClass(): void {
        while (this.pos < this.src.length) {
            const c = this.src[this.pos++];
            if (c === "\\") this.pos++;
            else if (c === "]") return;
        }
        throw new Refusal("A character class is not closed.");
    }

    /** `this.pos` is just after the `(`. */
    private parseGroup(): Node {
        let behind = false;
        if (this.src[this.pos] === "?") {
            const next = this.src[this.pos + 1];
            if (next === ":") {
                this.pos += 2;
            } else if (next === "=" || next === "!") {
                throw new Refusal(REASON_LOOKAHEAD);
            } else if (next === "<") {
                const kind = this.src[this.pos + 2];
                if (kind === "=" || kind === "!") {
                    behind = true;
                    this.pos += 3;
                } else {
                    const end = this.src.indexOf(">", this.pos + 2);
                    if (end < 0) throw new Refusal("A group name is not closed.");
                    this.names.push(this.src.slice(this.pos + 2, end));
                    this.pos = end + 1;
                }
            } else {
                throw new Refusal("This group syntax is not supported.");
            }
        }
        const alts = this.parseAlternatives();
        if (this.src[this.pos] !== ")") throw new Refusal("A group is not closed.");
        this.pos++;
        return { kind: "group", behind, alts };
    }
}

/** True when `pred` holds for any term of the alternatives, or of any group inside them. */
function someTerm(alts: readonly Term[][], pred: (term: Term) => boolean): boolean {
    return alts.some((alt) =>
        alt.some((term) => pred(term) || (term.node.kind === "group" && someTerm(term.node.alts, pred))),
    );
}

function nodeMinLength(node: Node): number {
    if (node.kind === "atom") return 1;
    if (node.kind === "assert" || node.behind) return 0;
    return minLength(node.alts);
}

/** Shortest text the alternatives can match (backreferences are refused, so this is exact). */
function minLength(alts: readonly Term[][]): number {
    let best = Infinity;
    for (const alt of alts) {
        let sum = 0;
        for (const term of alt) sum += term.min * nodeMinLength(term.node);
        best = Math.min(best, sum);
    }
    return best;
}

function hasAlternation(alts: readonly Term[][]): boolean {
    return alts.length > 1 || someTerm(alts, (t) => t.node.kind === "group" && t.node.alts.length > 1);
}

function hasQuantifier(alts: readonly Term[][]): boolean {
    return someTerm(alts, (t) => t.quantified);
}

/** What the static check learned about an accepted pattern. */
type Analysis = { usesBol: boolean };

function analyze(alts: readonly Term[][], names: readonly string[]): Analysis {
    // The pattern must end in an unescaped `$` (the match has to end at the caret).
    const lastAlt = alts[alts.length - 1];
    const last = lastAlt?.[lastAlt.length - 1];
    if (!last || last.node.kind !== "assert" || last.node.anchor !== "eol" || last.quantified) {
        throw new Refusal("The pattern must end with $ (not escaped), so it matches right before the caret.");
    }

    for (const name of names) {
        if (RESERVED_GROUP_NAMES.has(name)) throw new Refusal(`The group name "${name}" is reserved.`);
    }

    let unbounded = 0;
    let boundedChoices = 1;
    const checkTerm = (t: Term): boolean => {
        // A bounded count of 64 or more covers the whole window: it is as unbounded as `*`.
        if (t.quantified && (t.max === Infinity || t.max >= PATTERN_TAIL_LIMIT)) unbounded++;
        else if (t.quantified && t.min !== t.max) boundedChoices = Math.min(boundedChoices * (t.max - t.min + 1), 1e9);
        if (t.node.kind !== "group") return false;
        if (t.node.behind && hasQuantifier(t.node.alts)) {
            throw new Refusal("A lookbehind can't contain a quantifier (*, +, ?, {n,m}). Keep it a fixed length.");
        }
        if (!t.node.behind && t.max > 1 && (hasQuantifier(t.node.alts) || hasAlternation(t.node.alts))) {
            throw new Refusal(
                "A repeated group can't contain a quantifier or an alternation, because matching can become very slow. " +
                    "Use a character class like [ab] or take the inner quantifier out.",
            );
        }
        return false;
    };
    // Visits every term (the predicate never says yes, so `someTerm` walks the whole tree).
    someTerm(alts, checkTerm);
    if (unbounded > MAX_UNBOUNDED_QUANTIFIERS) {
        throw new Refusal(
            `At most ${MAX_UNBOUNDED_QUANTIFIERS} unbounded quantifiers (*, +, {n,}) are allowed; this pattern has ${unbounded}.`,
        );
    }
    if (boundedChoices > (MAX_BOUNDED_CHOICES[unbounded] ?? 1)) {
        throw new Refusal(
            "The pattern has too many optional or ranged parts (?, {n,m}) next to its other quantifiers, so matching could become slow. " +
                "Remove some of them.",
        );
    }
    if (minLength(alts) === 0) {
        throw new Refusal("The pattern can match an empty string, so it would fire on every keystroke.");
    }
    return { usesBol: someTerm(alts, (t) => t.node.kind === "assert" && t.node.anchor === "bol") };
}

// ---------------------------------------------------------------------------
// The one gate: source -> RegExp
// ---------------------------------------------------------------------------

type CompiledCore = { re: RegExp; usesBol: boolean };
type CacheEntry = { core: CompiledCore } | { reason: string };

const cache = new Map<string, CacheEntry>();

/** `/body$/flags` -> `{ body, flags }`. Only `i` and `u` are allowed, as written (`u` is never added: `\:` throws under it). */
function parseSource(source: string): { body: string; flags: string } {
    if (source.length > MAX_PATTERN_BODY + 8) {
        throw new Refusal(`The pattern is longer than ${MAX_PATTERN_BODY} characters.`);
    }
    const m = /^\/([\s\S]+)\/([a-z]*)$/.exec(source);
    if (!m) throw new Refusal("Write the pattern as /pattern$/, with the flags i or u after the last slash if you need them.");
    const body = m[1] ?? "";
    const flags = m[2] ?? "";
    if (body.length > MAX_PATTERN_BODY) throw new Refusal(`The pattern is longer than ${MAX_PATTERN_BODY} characters.`);
    const seen = new Set<string>();
    for (const flag of flags) {
        if (flag !== "i" && flag !== "u") throw new Refusal(`The flag "${flag}" is not supported. Only i and u are.`);
        if (seen.has(flag)) throw new Refusal(`The flag "${flag}" is written twice.`);
        seen.add(flag);
    }
    return { body, flags };
}

/**
 * The ONLY function in the plugin that calls `new RegExp` for a pattern.
 * Everything that reaches the hot path went through every check below.
 */
function buildCore(source: string): CompiledCore {
    const { body, flags } = parseSource(source);
    try {
        new RegExp(body, flags);
    } catch (err) {
        throw new Refusal(err instanceof Error ? err.message : "The pattern does not compile.");
    }
    const parser = new Parser(body);
    const alts = parser.parseAlternatives();
    if (parser.pos < body.length) throw new Refusal("The pattern has an unbalanced parenthesis.");
    const { usesBol } = analyze(alts, parser.names);
    // `$` only binds the last alternative of `cat|dog$`: wrap the body so every alternative ends at the caret.
    const re = new RegExp(`(?:${body.slice(0, -1)})$`, flags);
    return { re, usesBol };
}

function compileSource(source: string): CacheEntry {
    const hit = cache.get(source);
    if (hit) return hit;
    let entry: CacheEntry;
    try {
        entry = { core: buildCore(source) };
    } catch (err) {
        if (!(err instanceof Refusal)) throw err;
        entry = { reason: err.message };
    }
    if (cache.size >= MAX_CACHE_ENTRIES) cache.clear();
    cache.set(source, entry);
    return entry;
}

export type PatternCheck = { ok: true } | { ok: false; reason: string };

/** Runs the full S-015 check on a `/body$/flags` source (for editors and import paths that show errors early). */
export function checkPattern(source: string): PatternCheck {
    const entry = compileSource(source);
    return "core" in entry ? { ok: true } : { ok: false, reason: entry.reason };
}

/** A rule that passed the gate. The only way to get one is `compileRule`. */
export type CompiledRule = {
    readonly id: string;
    readonly mode: PatternMode;
    readonly replacement: string;
    readonly group?: string;
    readonly re: RegExp;
    /** The pattern uses `^`: skipped when the window does not start at the line start. */
    readonly usesBol: boolean;
};

export type CompileResult = { ok: true; rule: CompiledRule } | { ok: false; reason: string };

function field(value: object, key: string): unknown {
    return Object.prototype.hasOwnProperty.call(value, key) ? Reflect.get(value, key) : undefined;
}

/**
 * Turns a stored rule into a compiled one, or says why not. Takes `unknown`:
 * `data.json` can hold anything (sync, hand edits). Does not look at `enabled`.
 */
export function compileRule(raw: unknown): CompileResult {
    if (typeof raw !== "object" || raw === null) return { ok: false, reason: "The rule is not an object." };
    const id = field(raw, "id");
    const source = field(raw, "source");
    const replacement = field(raw, "replacement");
    const mode = field(raw, "mode") ?? "instant";
    const group = field(raw, "group");
    if (typeof id !== "string" || id === "") return { ok: false, reason: "The rule has no id." };
    if (typeof source !== "string") return { ok: false, reason: "The rule has no pattern." };
    if (typeof replacement !== "string") return { ok: false, reason: "The rule has no replacement." };
    if (mode !== "instant" && mode !== "separator") return { ok: false, reason: `The mode "${typeof mode === "string" ? mode : typeof mode}" is not supported.` };
    if (group !== undefined && typeof group !== "string") return { ok: false, reason: "The group is not a text." };
    if (replacement.length > MAX_PATTERN_REPLACEMENT) {
        return { ok: false, reason: `The replacement is longer than ${MAX_PATTERN_REPLACEMENT} characters.` };
    }
    const entry = compileSource(source);
    if (!("core" in entry)) return { ok: false, reason: entry.reason };
    return {
        ok: true,
        rule: { id, mode, replacement, group, re: entry.core.re, usesBol: entry.core.usesBol },
    };
}

export type PatternRuleError = { id: string; reason: string };

export type CompiledPatterns = {
    /** Enabled, valid rules in list order. */
    readonly rules: readonly CompiledRule[];
    /** Rules that were refused, each disabled alone. */
    readonly errors: readonly PatternRuleError[];
    readonly hasInstant: boolean;
    readonly hasSeparator: boolean;
};

export const NO_PATTERNS: CompiledPatterns = { rules: [], errors: [], hasInstant: false, hasSeparator: false };

/**
 * Compiles a stored rule list (settings, import, load). A rule that fails is
 * left out with its reason; the others keep working. Rules switched off, or in
 * a disabled group, are not compiled. Only the first 100 rules count.
 */
export function compilePatternRules(rules: unknown, disabledGroups?: readonly string[]): CompiledPatterns {
    if (!Array.isArray(rules) || rules.length === 0) return NO_PATTERNS;
    const list: unknown[] = rules;
    const disabled = disabledGroups && disabledGroups.length > 0 ? new Set(disabledGroups) : undefined;
    const compiled: CompiledRule[] = [];
    const errors: PatternRuleError[] = [];
    for (let i = 0; i < list.length; i++) {
        const raw = list[i];
        const rawId = typeof raw === "object" && raw !== null ? field(raw, "id") : undefined;
        const id = typeof rawId === "string" && rawId !== "" ? rawId : `#${i + 1}`;
        if (i >= MAX_PATTERN_RULES) {
            // One entry for all the rest: a data.json with thousands of rules must not cost thousands of errors.
            errors.push({ id, reason: `Only the first ${MAX_PATTERN_RULES} rules are used; ${list.length - i} more are ignored.` });
            break;
        }
        if (typeof raw !== "object" || raw === null) {
            errors.push({ id, reason: "The rule is not an object." });
            continue;
        }
        if (field(raw, "enabled") !== true) continue;
        const group = field(raw, "group");
        if (disabled && typeof group === "string" && disabled.has(group)) continue;
        const result = compileRule(raw);
        if (result.ok) compiled.push(result.rule);
        else errors.push({ id, reason: result.reason });
    }
    return {
        rules: compiled,
        errors,
        hasInstant: compiled.some((r) => r.mode === "instant"),
        hasSeparator: compiled.some((r) => r.mode === "separator"),
    };
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

export type PatternMatch = {
    readonly rule: CompiledRule;
    /** Where the match starts, in the text passed to `matchPatterns`. */
    readonly index: number;
    /** `captures[0]` is the whole match; a group that did not take part is `undefined`. */
    readonly captures: ReadonlyArray<string | undefined>;
    readonly named: ReadonlyMap<string, string | undefined>;
};

/**
 * Tries the rules of `mode`, in list order, on the end of `text` (the line
 * before the caret/separator): the first that matches wins. Only the last 64
 * characters are looked at. The match must END at the end of the text: that is
 * checked here, not trusted from the `$` in the source.
 */
export function matchPatterns(text: string, rules: readonly CompiledRule[], mode: PatternMode): PatternMatch | null {
    const dropped = Math.max(0, text.length - PATTERN_TAIL_LIMIT);
    const tail = dropped > 0 ? text.slice(dropped) : text;
    for (const rule of rules) {
        if (rule.mode !== mode) continue;
        // `^` means "line start": a window that cut the line cannot say.
        if (rule.usesBol && dropped > 0) continue;
        const m = rule.re.exec(tail);
        if (!m || m[0].length === 0 || m.index + m[0].length !== tail.length) continue;
        const named = new Map<string, string | undefined>();
        if (m.groups) for (const [name, value] of Object.entries(m.groups)) named.set(name, value);
        return { rule, index: dropped + m.index, captures: Array.from(m), named };
    }
    return null;
}

// ---------------------------------------------------------------------------
// Replacement: {{0}} {{1}}..{{9}} {{name}}
// ---------------------------------------------------------------------------

const CAPTURE_REF_RE = /\{\{(\d|[A-Za-z_][A-Za-z0-9_]*)\}\}/g;
/** Private-use range used for sentinels (the placeholder markers live at U+E000-U+E004). */
const SENTINEL_FIRST = 0xe100;
const SENTINEL_LAST = 0xf8ff;

function resolveCapture(key: string, match: PatternMatch): string | undefined {
    if (key.length === 1 && key >= "0" && key <= "9") return match.captures[Number(key)] ?? "";
    // A name that is no group of this pattern stays literal text.
    return match.named.has(key) ? (match.named.get(key) ?? "") : undefined;
}

/** First start of `count` consecutive private-use characters that the replacement does not use. */
function pickSentinelBase(text: string, count: number): number | undefined {
    for (let base = SENTINEL_FIRST; base + count - 1 <= SENTINEL_LAST; base += count) {
        let clash = false;
        for (let i = 0; i < text.length && !clash; i++) {
            const code = text.charCodeAt(i);
            clash = code >= base && code < base + count;
        }
        if (!clash) return base;
    }
    return undefined;
}

function scrubContext(ctx: ExpandContext, base: number, count: number): ExpandContext {
    const re = new RegExp(`[\\u${base.toString(16)}-\\u${(base + count - 1).toString(16)}]`, "g");
    const scrub = (value: string): string => value.replace(re, "");
    const { formatDate, readClipboard } = ctx;
    return {
        ...ctx,
        filename: ctx.filename === undefined ? undefined : scrub(ctx.filename),
        formatDate: formatDate ? (date, format) => scrub(formatDate(date, format)) : undefined,
        readClipboard: readClipboard ? async () => scrub(await readClipboard()) : undefined,
    };
}

/**
 * Builds the replacement text of a match. Order (ADR-0008): each `{{n}}` /
 * `{{name}}` becomes a one-character sentinel, the usual pipeline runs
 * (tab stops, `$date`, `$clipboard`, `$|`), then the sentinels are swapped for
 * the captured text and every field/caret offset is shifted by what was added
 * before it. So a captured `$1`, `$clipboard`, `{{date}}` or `$|` stays text.
 */
export async function applyPatternReplacement(match: PatternMatch, ctx: ExpandContext): Promise<AppliedReplacement> {
    const replacement = match.rule.replacement;
    const values: string[] = [];
    const slot = new Map<string, number>();
    for (const found of replacement.matchAll(CAPTURE_REF_RE)) {
        const key = found[1] ?? "";
        if (slot.has(key)) continue;
        const value = resolveCapture(key, match);
        if (value === undefined) continue;
        slot.set(key, values.length);
        values.push(value);
    }
    const base = values.length > 0 ? pickSentinelBase(replacement, values.length) : undefined;
    if (base === undefined) return applyPlaceholders(replacement, ctx);

    const template = replacement.replace(CAPTURE_REF_RE, (whole: string, key: string) => {
        const i = slot.get(key);
        return i === undefined ? whole : String.fromCharCode(base + i);
    });
    const applied = await applyPlaceholders(template, scrubContext(ctx, base, values.length));
    return swapSentinels(applied, base, values);
}

function swapSentinels(applied: AppliedReplacement, base: number, values: readonly string[]): AppliedReplacement {
    const { text } = applied;
    // Sentinel positions in the template-resolved text, and the length added up to and including each.
    const positions: number[] = [];
    const added: number[] = [];
    let out = "";
    let last = 0;
    let total = 0;
    for (let i = 0; i < text.length; i++) {
        const k = text.charCodeAt(i) - base;
        if (k < 0 || k >= values.length) continue;
        const value = values[k] ?? "";
        out += text.slice(last, i) + value;
        last = i + 1;
        total += value.length - 1;
        positions.push(i);
        added.push(total);
    }
    if (positions.length === 0) return applied;
    out += text.slice(last);

    // Offset `o` moves by what the sentinels BEFORE it added (a sentinel at `o` itself is still ahead of it).
    const shift = (o: number): number => {
        let lo = 0;
        let hi = positions.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if ((positions[mid] ?? 0) < o) lo = mid + 1;
            else hi = mid;
        }
        return lo === 0 ? o : o + (added[lo - 1] ?? 0);
    };

    const result: AppliedReplacement = { text: out };
    if (applied.cursorDelta !== undefined) result.cursorDelta = shift(applied.cursorDelta);
    if (applied.fields) result.fields = applied.fields.map(shift);
    if (applied.docOrder) result.docOrder = applied.docOrder;
    if (applied.finalDelta !== undefined) result.finalDelta = shift(applied.finalDelta);
    return result;
}
