import { describe, it, expect } from "vitest";
import {
    applyDeadTriggerRenames,
    isDeadTriggerKey,
    planDeadTriggerFix,
    validateDeadTriggerRenames,
} from "./fix-dead-triggers";
import { findTrigger } from "../engine/match";
import { getDict } from "../store/snippets";

/** Type `text` char by char; returns the match at the last char, if any. */
function typeAndMatch(text: string, dict: Record<string, string>, prefix?: string) {
    const textBefore = text.slice(0, -1);
    return findTrigger(
        { textBefore, textAfter: "", lastTyped: text.slice(-1), sepCh: textBefore.length, prefix },
        dict,
    );
}

describe("isDeadTriggerKey (B-183)", () => {
    it("flags a colon in the trigger name only", () => {
        expect(isDeadTriggerKey(":smile:")).toBe(true);
        expect(isDeadTriggerKey("emoji/:smile:")).toBe(true);
        expect(isDeadTriggerKey("a:b")).toBe(true);
        expect(isDeadTriggerKey("smile")).toBe(false);
        expect(isDeadTriggerKey("emoji/smile")).toBe(false);
    });
});

describe("planDeadTriggerFix (B-183)", () => {
    it("renames :smile: to smile", () => {
        const plan = planDeadTriggerFix({ ":smile:": "x" });
        expect(plan.renames).toEqual([{ from: ":smile:", to: "smile" }]);
        expect(plan.skipped).toEqual([]);
        expect(plan.dead).toEqual([":smile:"]);
    });

    it("keeps the group", () => {
        const plan = planDeadTriggerFix({ "emoji/:smile:": "x", "emoji/:wink": "y" });
        expect(plan.renames).toEqual([
            { from: "emoji/:smile:", to: "emoji/smile" },
            { from: "emoji/:wink", to: "emoji/wink" },
        ]);
    });

    it("leaves live keys alone and reports no dead keys", () => {
        const plan = planDeadTriggerFix({ "a/brb": "1", todo: "2" });
        expect(plan).toEqual({ dead: [], renames: [], skipped: [] });
    });

    it("skips when the normalized trigger already exists in the same group", () => {
        const plan = planDeadTriggerFix({ "emoji/smile": "keep", "emoji/:smile:": "dead" });
        expect(plan.renames).toEqual([]);
        expect(plan.skipped).toEqual([
            { key: "emoji/:smile:", reason: '"smile" is already used in group "emoji"' },
        ]);
    });

    it("skips when the normalized trigger exists in another group or ungrouped", () => {
        expect(planDeadTriggerFix({ "work/smile": "a", "emoji/:smile:": "b" }).skipped).toHaveLength(1);
        const ungrouped = planDeadTriggerFix({ smile: "a", "emoji/:smile:": "b" });
        expect(ungrouped.renames).toEqual([]);
        expect(ungrouped.skipped[0]?.reason).toBe('"smile" is already used');
    });

    it("a muted group still blocks the name (stricter than getDict)", () => {
        // getDict would let a dead->live rename shadow nothing here, the planner stays conservative.
        const plan = planDeadTriggerFix({ "off/smile": "a", "emoji/:smile:": "b" });
        expect(plan.renames).toEqual([]);
    });

    it("two dead keys with the same target: first full key wins, the other is skipped", () => {
        const plan = planDeadTriggerFix({ "b/:smile:": "2", "a/:smile:": "1", ":smile": "3" });
        // sorted: ":smile" < "a/:smile:" < "b/:smile:" under localeCompare
        expect(plan.renames).toEqual([{ from: ":smile", to: "smile" }]);
        expect(plan.skipped.map((s) => s.key).sort()).toEqual(["a/:smile:", "b/:smile:"]);
        expect(plan.skipped[0]?.reason).toContain("also the target of :smile");
    });

    it("skips an empty normalized trigger (::)", () => {
        const plan = planDeadTriggerFix({ "::": "x", "g/:": "y" });
        expect(plan.renames).toEqual([]);
        expect(plan.skipped.map((s) => s.key)).toEqual(["::", "g/:"]);
        expect(plan.skipped[0]?.reason).toBe("trigger is empty after removing colons");
    });

    it("skips a middle colon that stays invalid after normalizing", () => {
        const plan = planDeadTriggerFix({ ":a:b:": "x" });
        expect(plan.renames).toEqual([]);
        expect(plan.skipped).toEqual([{ key: ":a:b:", reason: '"a:b" is not a valid trigger' }]);
        expect(plan.dead).toEqual([":a:b:"]);
    });

    it("skips a single structural char (:-:)", () => {
        const plan = planDeadTriggerFix({ ":-:": "x" });
        expect(plan.renames).toEqual([]);
        expect(plan.skipped).toHaveLength(1);
    });

    it("skips targets the install gate rejects (charset, length)", () => {
        const plan = planDeadTriggerFix({ ":café:": "x", [`:${"a".repeat(51)}:`]: "y" });
        expect(plan.renames).toEqual([]);
        expect(plan.skipped).toHaveLength(2);
    });

    it("skips an oversized replacement instead of renaming it", () => {
        const plan = planDeadTriggerFix({ ":big:": "x".repeat(10001) });
        expect(plan.renames).toEqual([]);
        expect(plan.skipped[0]?.reason).toContain("exceeds limit");
    });

    // S-004/S-008: prototype-ish names are plain triggers, not phantom collisions.
    it("handles :constructor: and :__proto__: without prototype lookups", () => {
        const plan = planDeadTriggerFix({ ":constructor:": "x", ":__proto__:": "y", ":toString:": "z" });
        expect(plan.skipped).toEqual([]);
        expect(plan.renames.map((r) => r.to).sort()).toEqual(["__proto__", "constructor", "toString"]);
        const next = applyDeadTriggerRenames({ ":__proto__:": "y" }, [{ from: ":__proto__:", to: "__proto__" }]);
        expect(Object.getPrototypeOf(next)).toBe(Object.prototype);
        expect(Object.prototype.hasOwnProperty.call(next, "__proto__")).toBe(true);
        expect(next["__proto__"]).toBe("y");
    });

    it("a live key named constructor blocks the rename (own-key collision)", () => {
        const plan = planDeadTriggerFix({ constructor: "live", ":constructor:": "dead" });
        expect(plan.renames).toEqual([]);
        expect(plan.skipped).toHaveLength(1);
    });
});

describe("applyDeadTriggerRenames / validateDeadTriggerRenames (B-183)", () => {
    it("renames keys, preserves values and unrelated entries", () => {
        const src = { "emoji/:smile:": "😀", keep: "k", "g/:x:": "$|" };
        const plan = planDeadTriggerFix(src);
        const next = applyDeadTriggerRenames(src, plan.renames);
        expect(next).toEqual({ "emoji/smile": "😀", keep: "k", "g/x": "$|" });
        expect(src["emoji/:smile:"]).toBe("😀"); // input not mutated
    });

    it("gate accepts 500, 501 and 600 renames (count cap is a library invariant)", () => {
        for (const n of [500, 501, 600]) {
            const src: Record<string, string> = {};
            for (let i = 0; i < n; i++) src[`emoji/:e${i}:`] = "x";
            const plan = planDeadTriggerFix(src);
            expect(plan.renames).toHaveLength(n);
            expect(validateDeadTriggerRenames(src, plan.renames)).toEqual({ ok: true });
        }
    });

    it("gate accepts a rename set over 2 MiB in total", () => {
        const src: Record<string, string> = {};
        for (let i = 0; i < 300; i++) src[`:b${i}:`] = "y".repeat(9000);
        const plan = planDeadTriggerFix(src);
        expect(plan.renames).toHaveLength(300);
        expect(validateDeadTriggerRenames(src, plan.renames)).toEqual({ ok: true });
    });

    it("gate still blocks one invalid entry among valid ones", () => {
        const src = { ":a:": "x", ":b:": "y".repeat(10001) };
        const res = validateDeadTriggerRenames(src, [
            { from: ":a:", to: "a" },
            { from: ":b:", to: "b" },
        ]);
        expect(res.ok).toBe(false);
    });

    it("gate passes a clean plan and fails an oversized replacement", () => {
        const ok = { ":a:": "x" };
        expect(validateDeadTriggerRenames(ok, [{ from: ":a:", to: "a" }])).toEqual({ ok: true });
        const bad = { ":a:": "x".repeat(10001) };
        const res = validateDeadTriggerRenames(bad, [{ from: ":a:", to: "a" }]);
        expect(res.ok).toBe(false);
    });
});

describe("through the real matcher (B-183 regression)", () => {
    const stored = { "emoji/:smile:": "😀", "emoji/:wave": "👋" };

    it("dead keys never fire from typing, with or without prefix mode", () => {
        const dict = getDict({ snippets: stored });
        for (const typed of [":smile: ", ":smile ", "smile ", ":smile:.", ":wave "]) {
            expect(typeAndMatch(typed, dict)).toBeNull();
            expect(typeAndMatch(typed, dict, ":")).toBeNull();
        }
    });

    it("after the fix the bare trigger fires (plain and `:` prefix mode)", () => {
        const plan = planDeadTriggerFix(stored);
        const dict = getDict({ snippets: applyDeadTriggerRenames(stored, plan.renames) });
        expect(typeAndMatch("smile ", dict)?.trigger).toBe("smile");
        // prefix mode with ":" as the prefix: typing `:smile ` fires and consumes the colon
        const m = typeAndMatch(":smile ", dict, ":");
        expect(m?.trigger).toBe("smile");
        expect(m?.fromCh).toBe(0);
        // still not reachable as `:smile:`
        expect(typeAndMatch(":smile: ", dict)).toBeNull();
    });
});
