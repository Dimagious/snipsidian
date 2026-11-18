import { applyPlaceholders } from "./placeholders";
import type { AppliedReplacement, ExpandContext, PatternMode } from "./types";

/**
 * ADR-0008: regex triggers ("patterns"). Pure functions, no Obsidian imports.
 *
 * Three jobs live here:
 *   1. the S-015 static check (`checkPattern`): a small parser over the pattern,
 *      not a regex over the regex, that refuses what can backtrack exponentially
 *      and what the parser could read differently from the engine (a JS regex
 *      cannot be interrupted, so a dangerous one is not run). Polynomial cost
 *      cannot be bounded by syntax: the runtime guard in `matchPatternsInOrder`
 *      times each `exec` and switches off a rule that is slow on several keystrokes;
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
/**
 * Instant rules run after every typed character, so they get one less (owner, 2026-11-18): a rule that needs
 * two unbounded quantifiers belongs to "After a separator", which is tried once per separator.
 */
const MAX_INSTANT_UNBOUNDED_QUANTIFIERS = 1;
/**
 * Most terms (atoms, groups, anchors) all lookbehinds of a pattern may hold together. A lookbehind runs at every
 * backtrack step of the part before it, so its size is a multiplier; 8 covers what people write (`(?<= )`,
 * a short fixed word) and bounds the reach: a lookbehind never looks back more than
 * 8 code points, which is `LOOKBEHIND_CONTEXT` code units at most (2 each for an astral character).
 */
export const LOOKBEHIND_ATOM_LIMIT = 8;
/** Characters kept before the window as context for lookbehind, `\b` and `^` inside it (see `tryRule`). */
const LOOKBEHIND_CONTEXT = LOOKBEHIND_ATOM_LIMIT * 2;
/**
 * Runtime guard (S-015, round 2): an `exec` over this many ms is slow. An accepted pattern takes microseconds; the
 * slowest polynomial cases measured (`\p{L}*\p{L}*\p{L}{0,3}x$` under `iu`) take about 4 ms, so 5 would never fire on them.
 */
export const RULE_SLOW_MS = 2;
/**
 * A slow sample is not yet a strike: V8 compiles a regex lazily (on its 1st `exec`, again on tier-up and again on the
 * first non-Latin-1 input), and a `\p{...}` rule under `iu` takes a few ms for each of those and microseconds after.
 * So a slow `exec` is re-run on the same text up to this many more times; only if the FASTEST run is still over
 * `RULE_SLOW_MS` is the keystroke slow.
 */
export const RULE_SLOW_RETRIES = 2;
/** ...and a rule that was slow on this many separate keystrokes within its last `RULE_STRIKE_WINDOW` runs is switched off. */
export const RULE_SLOW_STRIKES = 3;
/** Strikes decay: only slow keystrokes among a rule's last this-many runs count, not those of the whole session. */
export const RULE_STRIKE_WINDOW = 50;
/** One call (one keystroke) stops trying further rules once its rules have spent this long. */
export const KEYSTROKE_BUDGET_MS = 8;
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
class Refusal extends Error {
    /** Set when the refusal is the unbounded-quantifier cap: an instant rule words it differently. */
    constructor(
        message: string,
        readonly unbounded?: number,
    ) {
        super(message);
    }
}

// ---------------------------------------------------------------------------
// Pattern parser (just enough regex syntax to run the S-015 checks)
// ---------------------------------------------------------------------------

type Anchor = "bol" | "eol" | "word";
type Node =
    /** `text` is the atom as written (`a`, `\w`, `[a-z]`): the end-character test is built from it. */
    | { kind: "atom"; text: string }
    | { kind: "assert"; anchor: Anchor }
    | { kind: "group"; behind: boolean; alts: Term[][] };
/** `max` is `Infinity` for `*`, `+`, `{n,}`. */
type Term = { node: Node; min: number; max: number; quantified: boolean };

const REASON_BACKREF = "Backreferences like \\1 or \\k<name> are not supported.";
const REASON_LOOKAHEAD = "Lookahead, (?=...) and (?!...), is not supported.";

/** "This escape isn't supported in patterns: \041": the escape as written, with the digits of an octal one. */
function unsupportedEscape(src: string, backslashAt: number, length?: number): Refusal {
    const e = src[backslashAt + 1] ?? "";
    let end = backslashAt + 2;
    if (length !== undefined) end = backslashAt + length;
    else if (e >= "0" && e <= "9") while (/[0-9]/.test(src[end] ?? "")) end++;
    return new Refusal(`This escape isn't supported in patterns: ${src.slice(backslashAt, end)}`);
}

class Parser {
    pos = 0;
    readonly names: string[] = [];

    /** `unicode`: the `u` flag. Escapes mean different things with and without it (`\u{1,}`, `\p{1,}`). */
    constructor(
        private readonly src: string,
        private readonly unicode: boolean,
    ) {}

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
        const start = this.pos;
        const c = this.src[this.pos++];
        switch (c) {
            case "\\":
                return this.parseEscape();
            case "[":
                this.skipClass();
                return { kind: "atom", text: this.src.slice(start, this.pos) };
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
                // Literal, `.`, or a `{` that is not a quantifier. Under `u` an astral character is one atom (a
                // quantifier after it repeats both halves), as the engine reads it.
                if (this.unicode && isHighSurrogate(this.src.charCodeAt(start)) && isLowSurrogate(this.src.charCodeAt(this.pos))) this.pos++;
                return { kind: "atom", text: this.src.slice(start, this.pos) };
        }
    }

    /**
     * `this.pos` is just after the backslash. An allowlist (S-015, round 2): only the escapes the parser models
     * exactly are read, everything else is refused. Annex B (the rules for a pattern without `u`) reads legacy octal
     * (`\041`), `\c`, `\u{1,}` or `\p{1,}` as something other than they look, and a parser that disagrees with the
     * engine about where an atom ends can hide a quantifier from the checks or give the end-character test the wrong
     * atoms. Refusing them costs nothing a person would write on purpose.
     */
    private parseEscape(): Node {
        const start = this.pos - 1;
        const e = this.src[this.pos];
        this.skipEscape(false);
        if (e === "b" || e === "B") return { kind: "assert", anchor: "word" };
        return { kind: "atom", text: this.src.slice(start, this.pos) };
    }

    /**
     * Moves `this.pos` past one escape (it is just after the backslash) or throws. `inClass`: inside `[...]`, where
     * `\b` is a backspace and `\B` does not exist.
     */
    private skipEscape(inClass: boolean): void {
        const e = this.src[this.pos++];
        if (e === undefined) throw new Refusal("The pattern ends with a lone backslash.");
        if (!inClass && e >= "1" && e <= "9") throw new Refusal(REASON_BACKREF);
        if (!inClass && e === "k" && this.src[this.pos] === "<") throw new Refusal(REASON_BACKREF);
        if (e === "0") {
            // `\0` is NUL only when no digit follows; `\041` is legacy octal.
            if (/[0-9]/.test(this.src[this.pos] ?? "")) throw unsupportedEscape(this.src, this.pos - 2);
            return;
        }
        if (e >= "1" && e <= "9") throw unsupportedEscape(this.src, this.pos - 2);
        if ("dDwWsSnrtfv".includes(e) || (inClass ? e === "b" : e === "b" || e === "B")) return;
        if (e === "x") {
            this.skipHex(2);
        } else if (e === "u") {
            if (this.unicode && this.src[this.pos] === "{") this.skipBraces();
            else this.skipHex(4, true);
        } else if ((e === "p" || e === "P") && this.unicode && this.src[this.pos] === "{") {
            this.skipBraces();
        } else if (/[A-Za-z]/.test(e)) {
            // Every other letter: `\c`, `\a`, `\e`, `\k`, `\p` without `u` (a letter, not a property), `\B` in a class.
            throw unsupportedEscape(this.src, this.pos - 2);
        }
        // Anything else is an identity escape of a symbol (`\.`, `\:`, `\-`): one atom.
    }

    /** `this.pos` is at `{`. Skips to just after the closing brace. */
    private skipBraces(): void {
        const end = this.src.indexOf("}", this.pos);
        if (end < 0) throw new Refusal("An escape is missing its closing brace.");
        this.pos = end + 1;
    }

    /**
     * Skips `count` hex digits. Without all of them the escape is just its letter (Annex B), which the parser does
     * not model: refused. `\u` escapes of surrogates (D800-DFFF) are refused as well: under `u` a pair of them is one
     * character, and the end-character test could not tell.
     */
    private skipHex(count: number, unicodeEscape = false): void {
        const digits = this.src.slice(this.pos, this.pos + count);
        if (digits.length !== count || !/^[0-9a-fA-F]+$/.test(digits)) throw unsupportedEscape(this.src, this.pos - 2);
        if (unicodeEscape && /^[dD][89a-fA-F]/.test(digits)) throw unsupportedEscape(this.src, this.pos - 2, count + 2);
        this.pos += count;
    }

    /** `this.pos` is just after the `[`. */
    private skipClass(): void {
        while (this.pos < this.src.length) {
            const c = this.src[this.pos++];
            if (c === "\\") this.skipEscape(true);
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
                    const name = this.src.slice(this.pos + 2, end);
                    // An escape in a name (`\u0064ate`) would hide a reserved name from the check below.
                    if (name.includes("\\")) throw new Refusal("A group name can't contain a backslash.");
                    this.names.push(name);
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

/** Terms inside lookbehinds, all alternatives counted (an upper bound of how far back any of them can look). */
function lookbehindTerms(alts: readonly Term[][], inside: boolean): number {
    let count = 0;
    for (const alt of alts) {
        for (const term of alt) {
            if (inside) count++;
            if (term.node.kind === "group") count += lookbehindTerms(term.node.alts, inside || term.node.behind);
        }
    }
    return count;
}

/** What the static check learned about an accepted pattern. */
type Analysis = { usesBol: boolean; unbounded: number };

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
        // Alternation is a choice point as well: `(?:a|)` x30 hung `exec` (S-015, checker round 1).
        if (t.node.alts.length > 1) boundedChoices = Math.min(boundedChoices * t.node.alts.length, 1e9);
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
    if (lookbehindTerms(alts, false) > LOOKBEHIND_ATOM_LIMIT) {
        throw new Refusal(
            `A pattern can have at most ${LOOKBEHIND_ATOM_LIMIT} characters or groups inside its lookbehinds (all of them together), ` +
                "because a lookbehind is checked again at every step of the matching. Shorten it.",
        );
    }
    if (unbounded > MAX_UNBOUNDED_QUANTIFIERS) {
        throw new Refusal(
            `At most ${MAX_UNBOUNDED_QUANTIFIERS} unbounded quantifiers (*, +, {n,}) are allowed; this pattern has ${unbounded}.`,
            unbounded,
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
    return { usesBol: someTerm(alts, (t) => t.node.kind === "assert" && t.node.anchor === "bol"), unbounded };
}

// ---------------------------------------------------------------------------
// Which characters can end a match (instant rules skip the others)
// ---------------------------------------------------------------------------

type EndInfo = {
    /** The atoms (as written) that can be the last character consumed. */
    atoms: string[];
    /** The alternatives can match without consuming: whatever precedes them can end the match too. */
    nullable: boolean;
};

function endOfAlternatives(alts: readonly Term[][]): EndInfo {
    const atoms: string[] = [];
    let nullable = false;
    for (const alt of alts) {
        const end = endOfSequence(alt);
        atoms.push(...end.atoms);
        nullable ||= end.nullable;
    }
    return { atoms, nullable };
}

/** Walks the terms from the end: an optional term lets the one before it end the match as well. */
function endOfSequence(seq: readonly Term[]): EndInfo {
    const atoms: string[] = [];
    for (let i = seq.length - 1; i >= 0; i--) {
        const term = seq[i];
        if (!term) continue;
        const node = term.node;
        // Anchors and lookbehind consume nothing.
        if (node.kind === "assert" || (node.kind === "group" && node.behind)) continue;
        if (node.kind === "atom") {
            atoms.push(node.text);
            if (term.min > 0) return { atoms, nullable: false };
            continue;
        }
        const inner = endOfAlternatives(node.alts);
        atoms.push(...inner.atoms);
        if (term.min > 0 && !inner.nullable) return { atoms, nullable: false };
    }
    return { atoms, nullable: true };
}

/**
 * A test for the character a match can end with, or `null` when that is not known (anything goes). It is a
 * superset on purpose: the atoms are tested with the rule's own flags, so `i` folds case and `u` reads `\p{...}`.
 */
function buildEndTest(alts: readonly Term[][], flags: string): RegExp | null {
    const end = endOfAlternatives(alts);
    if (end.nullable || end.atoms.length === 0) return null;
    try {
        return new RegExp(`^(?:${[...new Set(end.atoms)].join("|")})$`, flags);
    } catch {
        // An atom that does not stand alone: "any character" is always a safe answer.
        return null;
    }
}

// ---------------------------------------------------------------------------
// The one gate: source -> RegExp
// ---------------------------------------------------------------------------

type CompiledCore = { re: RegExp; usesBol: boolean; unbounded: number; endTest: RegExp | null };
type CacheEntry = { core: CompiledCore } | { reason: string; unbounded?: number };

const cache = new Map<string, CacheEntry>();

/** One ASCII and one non-Latin-1 text for the compile-time warm-up (see `buildCore`). */
const WARMUP_TEXTS: readonly string[] = ["a", "\u044f1"];

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
    const parser = new Parser(body, flags.includes("u"));
    const alts = parser.parseAlternatives();
    if (parser.pos < body.length) throw new Refusal("The pattern has an unbalanced parenthesis.");
    const { usesBol, unbounded } = analyze(alts, parser.names);
    // `$` only binds the last alternative of `cat|dog$`: wrap the body so every alternative ends at the caret.
    // `g` is only there for `lastIndex`: the matcher starts at the second character of a cut window, so `\b` and
    // lookbehind can still see the character before it.
    const re = new RegExp(`(?:${body.slice(0, -1)})$`, `${flags}g`);
    // V8 compiles a regex lazily: on the first `exec`, again on tier-up and again on the first non-Latin-1 input, a few
    // ms each for a `\p{...}` rule under `iu` (measured). Pay it here, on two tiny texts, not on a keystroke. The gate
    // above leaves no exponential case and the inputs are 1-2 characters, so this cannot hang.
    for (const sample of WARMUP_TEXTS) {
        re.lastIndex = 0;
        re.exec(sample);
    }
    re.lastIndex = 0;
    return { re, usesBol, unbounded, endTest: buildEndTest(alts, flags) };
}

function compileSource(source: string): CacheEntry {
    const hit = cache.get(source);
    if (hit) return hit;
    let entry: CacheEntry;
    try {
        entry = { core: buildCore(source) };
    } catch (err) {
        if (!(err instanceof Refusal)) throw err;
        entry = { reason: err.message, unbounded: err.unbounded };
    }
    if (cache.size >= MAX_CACHE_ENTRIES) cache.clear();
    cache.set(source, entry);
    return entry;
}

function instantRefusal(unbounded: number): string {
    return (
        `An instant rule can have at most ${MAX_INSTANT_UNBOUNDED_QUANTIFIERS} unbounded quantifier (*, +, {n,}); ` +
        `this pattern has ${unbounded}. Switch the rule to "After a separator" to use up to ${MAX_UNBOUNDED_QUANTIFIERS}.`
    );
}

/** The cached source check plus the limit of the rule's mode (the cache is by source, so the mode is applied on top). */
function resolveSource(source: string, mode: PatternMode): CacheEntry {
    const entry = compileSource(source);
    if (mode !== "instant") return entry;
    if ("core" in entry) {
        return entry.core.unbounded > MAX_INSTANT_UNBOUNDED_QUANTIFIERS ? { reason: instantRefusal(entry.core.unbounded) } : entry;
    }
    // Too many for either mode: say what the instant limit is, not the separator one.
    return entry.unbounded === undefined ? entry : { reason: instantRefusal(entry.unbounded) };
}

export type PatternCheck = { ok: true } | { ok: false; reason: string };

/**
 * Runs the full S-015 check on a `/body$/flags` source for a rule of `mode` (for editors and import paths that
 * show errors early; `compileRule` runs the same check).
 */
export function checkPattern(source: string, mode: PatternMode): PatternCheck {
    const entry = resolveSource(source, mode);
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
    /** Tests the last character of a possible match; `null` = not known, any character. */
    readonly endTest: RegExp | null;
    /** Runtime guard state (S-015, round 2): lives and dies with this compiled rule, never saved. */
    readonly health: RuleHealth;
};

/** What the runtime guard learned about a rule on the hot path. Mutated by the matcher only. */
export type RuleHealth = {
    /** How many times the rule's `exec` has run (a re-run of a slow sample is not a new run). */
    runs: number;
    /** `runs` at each slow keystroke still inside the last `RULE_STRIKE_WINDOW` runs. */
    strikes: number[];
    /** The text of the last slow keystroke: the same line read twice is one keystroke. */
    lastSlowText?: string;
    /** Keystrokes on which the deadline cut the rule loop and this was the first rule left untried. */
    deadlineCuts: number;
    /** Set when the rule was switched off for the session: the reason a person can read. */
    switchedOff?: string;
};

/**
 * Whether a match of the rule can end with `ch` (the last character of the line, for an instant rule): the last code
 * point for a `u` rule, the last code unit for one without `u`, which is how the engine reads it.
 */
export function canEndWith(rule: CompiledRule, ch: string): boolean {
    return rule.endTest === null || rule.endTest.test(ch);
}

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
    const entry = resolveSource(source, mode);
    if (!("core" in entry)) return { ok: false, reason: entry.reason };
    return {
        ok: true,
        rule: {
            id,
            mode,
            replacement,
            group,
            re: entry.core.re,
            usesBol: entry.core.usesBol,
            endTest: entry.core.endTest,
            health: { runs: 0, strikes: [], deadlineCuts: 0 },
        },
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
    /** Where the match starts, in the text it was run on. */
    readonly index: number;
    /** Where it ends: always the end of that text (the match must end at the caret / the separator). */
    readonly end: number;
    /** `captures[0]` is the whole match; a group that did not take part is `undefined`. */
    readonly captures: ReadonlyArray<string | undefined>;
    readonly named: ReadonlyMap<string, string | undefined>;
};

/** Time spent by the rules of one call (one keystroke) and the clock that measures it. */
type Timing = { readonly clock: () => number; spent: number };

/** Milliseconds, from `performance.now()`; the engine takes a clock so the guard can be tested without waiting. */
const defaultClock = (): number => performance.now();

function isHighSurrogate(code: number): boolean {
    return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
    return code >= 0xdc00 && code <= 0xdfff;
}

/** The last character of `text` as the rule's regex reads it: a code point under `u`, else a code unit. */
function lastChar(rule: CompiledRule, text: string): string {
    const last = text.charCodeAt(text.length - 1);
    if (rule.endTest?.unicode && isLowSurrogate(last) && isHighSurrogate(text.charCodeAt(text.length - 2))) {
        return text.slice(-2);
    }
    return text.charAt(text.length - 1);
}

/**
 * Counts a slow keystroke against the rule: the third one within its last `RULE_STRIKE_WINDOW` runs switches it off
 * for the session. The same line seen twice is one keystroke.
 */
function strikeRule(rule: CompiledRule, text: string): void {
    const health = rule.health;
    if (health.switchedOff !== undefined || health.lastSlowText === text) return;
    health.lastSlowText = text;
    health.strikes.push(health.runs);
    // Decay: a strike `RULE_STRIKE_WINDOW` runs back or more is outside "the last N runs".
    while (health.strikes.length > 0 && health.runs - (health.strikes[0] ?? 0) >= RULE_STRIKE_WINDOW) health.strikes.shift();
    if (health.strikes.length < RULE_SLOW_STRIKES) return;
    health.switchedOff = `Switched off: slow on this note (${health.strikes.length} times over ${RULE_SLOW_MS} ms).`;
    console.warn("[snipsy] pattern rule switched off", { id: rule.id, reason: health.switchedOff });
}

/**
 * One rule on one text. Only the last 64 characters can be matched; a few more are kept before them for `\b` and
 * lookbehind (at most `LOOKBEHIND_ATOM_LIMIT` code points back).
 */
function tryRule(rule: CompiledRule, text: string, timing: Timing): PatternMatch | null {
    // An instant rule is tried after every keystroke: skip it unless the typed character can end it. (Instant rules
    // fire on a typed single code unit, so an astral character, typed as two, never reaches here; not a fix target.)
    if (rule.mode === "instant" && !canEndWith(rule, lastChar(rule, text))) return null;
    let windowStart = Math.max(0, text.length - PATTERN_TAIL_LIMIT);
    // The window never starts between the halves of a surrogate pair.
    if (windowStart > 0 && isLowSurrogate(text.charCodeAt(windowStart)) && isHighSurrogate(text.charCodeAt(windowStart - 1))) {
        windowStart++;
    }
    // `^` means "line start": a window that cut the line cannot say.
    if (rule.usesBol && windowStart > 0) return null;
    // Context before the window is for looking only (`\b`, lookbehind): without it the cut would look like a line
    // start. The match itself must start inside the window, which `lastIndex` makes the engine do. The context may
    // start between the halves of a surrogate pair, and that is harmless: a lookbehind holds at most
    // `LOOKBEHIND_ATOM_LIMIT` terms, each at most one code point (two code units), and starts at or after the window,
    // so it reads at most `LOOKBEHIND_CONTEXT` units back. To need the split pair it would have to read 17 units, and
    // the 8 code points before it cannot take an odd 15 (see the test "context split in a pair").
    const contextStart = Math.max(0, windowStart - LOOKBEHIND_CONTEXT);
    const context = contextStart > 0 ? text.slice(contextStart) : text;
    const from = windowStart - contextStart;
    rule.re.lastIndex = from;
    rule.health.runs++;
    let started = timing.clock();
    const m = rule.re.exec(context);
    let fastest = timing.clock() - started;
    timing.spent += fastest;
    // A slow sample may be V8 compiling the regex lazily: run the same exec again before calling it slow. The
    // extra time counts against the keystroke budget; the result is the same each time, the first one is used.
    for (let retry = 0; retry < RULE_SLOW_RETRIES && fastest > RULE_SLOW_MS; retry++) {
        rule.re.lastIndex = from;
        started = timing.clock();
        rule.re.exec(context);
        const took = timing.clock() - started;
        timing.spent += took;
        if (took < fastest) fastest = took;
    }
    if (fastest > RULE_SLOW_MS) strikeRule(rule, text);
    if (!m || m[0].length === 0 || m.index + m[0].length !== context.length) return null;
    const named = new Map<string, string | undefined>();
    if (m.groups) for (const [name, value] of Object.entries(m.groups)) named.set(name, value);
    return { rule, index: contextStart + m.index, end: text.length, captures: Array.from(m), named };
}

/** The line as each kind of rule reads it (a text that is `undefined` means that kind has nothing to run on). */
export type PatternTexts = {
    /** The line up to the caret, after a typed character: what instant rules read. */
    readonly atCaret?: string;
    /** The line up to a typed separator, without it: what separator rules read. */
    readonly beforeSeparator?: string;
};

/**
 * Tries the rules strictly top to bottom, whatever their mode (ADR-0008, one order for all rules): the first that
 * matches wins. The match must END at the end of its text: that is checked here, not trusted from the `$` in the
 * source.
 *
 * Runtime guard (S-015, round 2): every `exec` is timed. A rule slow on `RULE_SLOW_STRIKES` separate keystrokes is
 * switched off (see `switchedOffRules`), and the loop stops once the rules of this call have spent
 * `KEYSTROKE_BUDGET_MS`. Literal snippets never come through here.
 */
export function matchPatternsInOrder(
    texts: PatternTexts,
    rules: readonly CompiledRule[],
    clock: () => number = defaultClock,
): PatternMatch | null {
    const timing: Timing = { clock, spent: 0 };
    const textOf = (rule: CompiledRule): string | undefined => (rule.mode === "instant" ? texts.atCaret : texts.beforeSeparator);
    for (let i = 0; i < rules.length; i++) {
        const rule = rules[i];
        if (!rule) continue;
        if (timing.spent > KEYSTROKE_BUDGET_MS) {
            // Starved rules must not be silent: count the cut once, on the first rule that was left untried.
            const starved = rules.slice(i).find((r) => r.health.switchedOff === undefined && textOf(r) !== undefined);
            if (starved) starved.health.deadlineCuts++;
            return null;
        }
        if (rule.health.switchedOff !== undefined) continue;
        const text = textOf(rule);
        if (text === undefined) continue;
        const hit = tryRule(rule, text, timing);
        if (hit) return hit;
    }
    return null;
}

/** The rules the runtime guard switched off, with the reason (for the Patterns page; never saved to `data.json`). */
export function switchedOffRules(patterns: CompiledPatterns): PatternRuleError[] {
    const off: PatternRuleError[] = [];
    for (const rule of patterns.rules) {
        if (rule.health.switchedOff !== undefined) off.push({ id: rule.id, reason: rule.health.switchedOff });
    }
    return off;
}

/** What the runtime guard saw on this compiled set (for the Patterns page; session only, never saved). */
export type PatternHealth = {
    readonly switchedOff: PatternRuleError[];
    /** Keystrokes on which the 8 ms deadline cut the rule loop, so later rules did not get their turn. */
    readonly deadlineHits: number;
};

export function patternHealth(patterns: CompiledPatterns): PatternHealth {
    let deadlineHits = 0;
    for (const rule of patterns.rules) deadlineHits += rule.health.deadlineCuts;
    return { switchedOff: switchedOffRules(patterns), deadlineHits };
}

/** Rules of one `mode` on `text`, in list order. */
export function matchPatterns(
    text: string,
    rules: readonly CompiledRule[],
    mode: PatternMode,
    clock: () => number = defaultClock,
): PatternMatch | null {
    return matchPatternsInOrder(mode === "instant" ? { atCaret: text } : { beforeSeparator: text }, rules, clock);
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
