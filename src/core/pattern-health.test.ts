import { describe, it, expect, vi } from "vitest";
import { matchPatternsInOrder, patternHealth, compilePatternRules } from "../engine/patterns";
import { pausedLine } from "./pattern-health";

function rule(id: string): ReturnType<typeof compilePatternRules> {
    return compilePatternRules([{ id, source: "/a$/", replacement: "b", enabled: true, mode: "instant" }]);
}

/** A clock that advances `step` ms on every read, so each timed exec looks that slow. */
const clock = (step: number): (() => number) => {
    let now = 0;
    return () => (now += step);
};

describe("pausedLine", () => {
    it("words a rule the guard switched off for compile cost", () => {
        const compiled = rule("slow-compile");
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        matchPatternsInOrder({ atCaret: "a" }, compiled.rules, clock(100));
        const off = patternHealth(compiled).switchedOff;
        expect(off).toHaveLength(1);
        expect(pausedLine(off[0]?.reason ?? "")).toBe("Turned off for this session: it took too long to compile.");
    });

    it("words a rule the guard switched off for being slow on three keystrokes", () => {
        const compiled = rule("slow-runtime");
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        // Warm the rule first (the first runs count as compile cost), then three slow keystrokes on different lines.
        for (const text of ["a", "xa", "xxa"]) matchPatternsInOrder({ atCaret: text }, compiled.rules, () => 0);
        for (const text of ["yya", "zzza", "wwwwa"]) matchPatternsInOrder({ atCaret: text }, compiled.rules, clock(5));
        const off = patternHealth(compiled).switchedOff;
        expect(off).toHaveLength(1);
        expect(off[0]?.reason).toMatch(/^Switched off: slow/);
        expect(pausedLine(off[0]?.reason ?? "")).toBe("Turned off for this session: it was too slow.");
    });

    it("a compiled rule that was never slow is not listed", () => {
        const compiled = rule("fine");
        matchPatternsInOrder({ atCaret: "a" }, compiled.rules, () => 0);
        expect(patternHealth(compiled).switchedOff).toEqual([]);
    });
});
