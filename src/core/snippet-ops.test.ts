import { describe, it, expect } from "vitest";
import { applyAddSnippet, planAddSnippet, planEditSnippet } from "./snippet-ops";
import { makeDefaultSettings } from "../test/factories/plugin";
import type { SnipSidianSettings } from "../types";

function withSnippets(snippets: Record<string, string>): SnipSidianSettings {
    return { ...makeDefaultSettings(), snippets };
}

describe("snippet-ops.planAddSnippet", () => {
    it("happy path: builds the composite <group>/<trigger> key + carries the value through", () => {
        const settings = withSnippets({});
        const plan = planAddSnippet(
            { trigger: "todo", replacement: "- [ ]", group: "Markdown" },
            settings,
        );
        if (!plan.ok) throw new Error(`expected ok, got: ${plan.reason}`);
        expect(plan.data).toEqual({ key: "markdown/todo", value: "- [ ]" });
        // Input untouched (purity check)
        expect(settings.snippets).toEqual({});
    });

    it("ungrouped: empty group string produces a bare-trigger key", () => {
        const plan = planAddSnippet(
            { trigger: "todo", replacement: "- [ ]", group: "" },
            withSnippets({}),
        );
        if (!plan.ok) throw new Error(`expected ok, got: ${plan.reason}`);
        expect(plan.data).toEqual({ key: "todo", value: "- [ ]" });
    });

    it("rejects empty/whitespace-only trigger", () => {
        const plan = planAddSnippet(
            { trigger: "   ", replacement: "x", group: "" },
            withSnippets({}),
        );
        expect(plan).toEqual({
            ok: false,
            reason: "Invalid trigger: empty, or contains spaces, separators, / \\ or $",
        });
    });

    it("rejects trigger with embedded separator (space/dot/slash/colon-in-middle)", () => {
        for (const bad of ["a b", "a.b", "a/b", "a:b"]) {
            const plan = planAddSnippet(
                { trigger: bad, replacement: "x", group: "" },
                withSnippets({}),
            );
            expect(plan.ok).toBe(false);
        }
    });

    it("rejects empty replacement", () => {
        const plan = planAddSnippet(
            { trigger: "todo", replacement: "", group: "" },
            withSnippets({}),
        );
        expect(plan).toEqual({ ok: false, reason: "Replacement cannot be empty" });
    });

    it("rejects when the exact <group>/<trigger> key already exists", () => {
        const plan = planAddSnippet(
            { trigger: "todo", replacement: "new", group: "Markdown" },
            withSnippets({ "markdown/todo": "old" }),
        );
        expect(plan).toEqual({
            ok: false,
            reason: 'Snippet "todo" already exists',
        });
    });

    it("rejects when the trigger name collides in another group (hasTriggerCollision)", () => {
        const plan = planAddSnippet(
            { trigger: "todo", replacement: "new", group: "Daily" },
            withSnippets({ "markdown/todo": "anything" }),
        );
        expect(plan).toEqual({
            ok: false,
            reason: 'Trigger "todo" already exists in another group',
        });
    });

    it("normalises Espanso-style :trigger: keys (closes B-117 at this layer too)", () => {
        const plan = planAddSnippet(
            { trigger: ":smile:", replacement: "😄", group: "Emojis" },
            withSnippets({}),
        );
        if (!plan.ok) throw new Error(`expected ok, got: ${plan.reason}`);
        // Leading + trailing colons stripped — the engine treats `:`
        // as a separator, so the stored key needs to be the bare word.
        expect(plan.data.key).toBe("emojis/smile");
    });
});

describe("snippet-ops: symbol triggers (B-171)", () => {
    it("add accepts `--`, `->`, `<->`", () => {
        for (const t of ["--", "->", "<->"]) {
            const plan = planAddSnippet({ trigger: t, replacement: "x", group: "Typo" }, withSnippets({}));
            if (!plan.ok) throw new Error(`${t}: ${plan.reason}`);
            expect(plan.data.key).toBe(`typo/${t}`);
        }
    });

    it("an installed `--` snippet can be edited (hyphen no longer forbidden)", () => {
        const plan = planEditSnippet(
            "typo/--",
            { triggerName: "--", replacement: "\u2014" },
            withSnippets({ "typo/--": "-" }),
        );
        if (!plan.ok) throw new Error(plan.reason);
        expect(plan.data.newKey).toBe("typo/--");
    });

    it("add and edit reject single structural chars (- + * > |) with a clear reason; `--` and `->` stay valid", () => {
        for (const t of ["-", "+", "*", ">", "|"]) {
            const add = planAddSnippet({ trigger: t, replacement: "x", group: "Typo" }, withSnippets({}));
            expect(add.ok, t).toBe(false);
            if (!add.ok) expect(add.reason).toMatch(/single -, \+, \*, > or \|/);
            const edit = planEditSnippet(`typo/${t}`, { triggerName: t, replacement: "x" }, withSnippets({ [`typo/${t}`]: "y" }));
            expect(edit.ok, t).toBe(false);
            if (!edit.ok) expect(edit.reason).toMatch(/single -, \+, \*, > or \|/);
        }
        for (const t of ["--", "->"]) {
            expect(planAddSnippet({ trigger: t, replacement: "x", group: "Typo" }, withSnippets({})).ok, t).toBe(true);
        }
    });

    it("add still rejects `$x` and backslash", () => {
        for (const t of ["$x", "a\\b"]) {
            expect(planAddSnippet({ trigger: t, replacement: "x", group: "" }, withSnippets({})).ok).toBe(false);
        }
    });
});

describe("snippet-ops.planEditSnippet", () => {
    it("replacement-only edit (no rename): key stays, no renamedFrom in plan", () => {
        const plan = planEditSnippet(
            "markdown/todo",
            { triggerName: "todo", replacement: "- [ ] $|" },
            withSnippets({ "markdown/todo": "- [ ]" }),
        );
        if (!plan.ok) throw new Error(`expected ok, got: ${plan.reason}`);
        expect(plan.data.newKey).toBe("markdown/todo");
        expect(plan.data.value).toBe("- [ ] $|");
        expect(plan.data.renamedFrom).toBeUndefined();
    });

    it("rename within the same group: plan carries renamedFrom", () => {
        const plan = planEditSnippet(
            "markdown/todo",
            { triggerName: "task", replacement: "- [ ]" },
            withSnippets({ "markdown/todo": "- [ ]" }),
        );
        if (!plan.ok) throw new Error(`expected ok, got: ${plan.reason}`);
        expect(plan.data.newKey).toBe("markdown/task");
        expect(plan.data.renamedFrom).toBe("markdown/todo");
    });

    it("ungrouped rename: bare-trigger keys handled", () => {
        const plan = planEditSnippet(
            "todo",
            { triggerName: "task", replacement: "- [ ]" },
            withSnippets({ todo: "- [ ]" }),
        );
        if (!plan.ok) throw new Error(`expected ok, got: ${plan.reason}`);
        expect(plan.data.newKey).toBe("task");
        expect(plan.data.renamedFrom).toBe("todo");
    });

    it("rejects rename to a name already used in the SAME group", () => {
        const plan = planEditSnippet(
            "markdown/todo",
            { triggerName: "done", replacement: "anything" },
            withSnippets({ "markdown/todo": "old", "markdown/done": "existing" }),
        );
        expect(plan).toEqual({
            ok: false,
            reason: 'Trigger "done" already exists',
        });
    });

    it("rejects rename to a name that collides in ANOTHER group", () => {
        const plan = planEditSnippet(
            "markdown/todo",
            { triggerName: "task", replacement: "x" },
            withSnippets({ "markdown/todo": "old", "daily/task": "elsewhere" }),
        );
        expect(plan).toEqual({
            ok: false,
            reason: 'Trigger "task" already exists in another group',
        });
    });

    it("rejects when the original key doesn't exist (defensive)", () => {
        const plan = planEditSnippet(
            "markdown/todo",
            { triggerName: "todo", replacement: "x" },
            withSnippets({}),
        );
        expect(plan).toEqual({ ok: false, reason: "Original snippet missing" });
    });

    it("rejects empty replacement on edit (same rule as add)", () => {
        const plan = planEditSnippet(
            "markdown/todo",
            { triggerName: "todo", replacement: "" },
            withSnippets({ "markdown/todo": "- [ ]" }),
        );
        expect(plan).toEqual({ ok: false, reason: "Replacement cannot be empty" });
    });

    it("rejects invalid trigger (contains separator) on edit", () => {
        const plan = planEditSnippet(
            "markdown/todo",
            { triggerName: "a b", replacement: "x" },
            withSnippets({ "markdown/todo": "- [ ]" }),
        );
        expect(plan.ok).toBe(false);
    });

    it("prototype-key defence: rejects rename to '__proto__' if already present as own property", () => {
        // Direct assignment to literal `__proto__` triggers the
        // setter, not own-property creation, so we construct the
        // collision via JSON.parse (the realistic attack surface).
        const settings = withSnippets(
            JSON.parse('{"markdown/todo":"-","markdown/__proto__":"evil"}') as Record<
                string,
                string
            >,
        );
        const plan = planEditSnippet(
            "markdown/todo",
            { triggerName: "__proto__", replacement: "x" },
            settings,
        );
        // `hasOwnProperty.call` should catch this regardless of
        // prototype-chain shenanigans (S-004 defence in safeRenameKey,
        // lifted into the plan).
        expect(plan.ok).toBe(false);
    });

    it("normalises Espanso-style :trigger: keys on edit too", () => {
        const plan = planEditSnippet(
            "emojis/smile",
            { triggerName: ":heart:", replacement: "❤️" },
            withSnippets({ "emojis/smile": "😄" }),
        );
        if (!plan.ok) throw new Error(`expected ok, got: ${plan.reason}`);
        expect(plan.data.newKey).toBe("emojis/heart");
        expect(plan.data.renamedFrom).toBe("emojis/smile");
    });
});

// B-175: shared by the Settings modal and "Add snippet from selection".
describe("snippet-ops.applyAddSnippet", () => {
    it("happy path: writes the planned key/value into settings.snippets", () => {
        const settings = withSnippets({});
        const plan = applyAddSnippet({ trigger: "sig", replacement: "Best,\nDima", group: "" }, settings);
        expect(plan.ok).toBe(true);
        expect(settings.snippets).toEqual({ sig: "Best,\nDima" });
    });

    it("keeps a multi-line selection byte-for-byte (newlines, tabs, trailing newline)", () => {
        const settings = withSnippets({});
        const text = "line1\n\tline2\r\nline3\n";
        applyAddSnippet({ trigger: "ml", replacement: text, group: "" }, settings);
        expect(settings.snippets["ml"]).toBe(text);
    });

    it("keeps placeholder-looking text as is (no escaping)", () => {
        const settings = withSnippets({});
        const text = "$| $date $clipboard $1";
        applyAddSnippet({ trigger: "ph", replacement: text, group: "" }, settings);
        expect(settings.snippets["ph"]).toBe(text);
    });

    it("rejects an existing trigger and leaves settings untouched", () => {
        const settings = withSnippets({ brb: "be right back" });
        const plan = applyAddSnippet({ trigger: "brb", replacement: "x", group: "" }, settings);
        expect(plan.ok).toBe(false);
        expect(settings.snippets).toEqual({ brb: "be right back" });
    });

    it("rejects a trigger that exists in another group", () => {
        const settings = withSnippets({ "a/brb": "x" });
        const plan = applyAddSnippet({ trigger: "brb", replacement: "y", group: "b" }, settings);
        expect(plan.ok).toBe(false);
        expect(Object.keys(settings.snippets)).toEqual(["a/brb"]);
    });

    it("rejects a lone structural trigger (-) and an empty replacement without writing", () => {
        const settings = withSnippets({});
        expect(applyAddSnippet({ trigger: "-", replacement: "x", group: "" }, settings).ok).toBe(false);
        expect(applyAddSnippet({ trigger: "ok", replacement: "", group: "" }, settings).ok).toBe(false);
        expect(settings.snippets).toEqual({});
    });

    // B-179 will flip this: replacement-length cap for Settings add/edit
    it("does not cap replacement length (parity with Settings add: no limit check there)", () => {
        const settings = withSnippets({});
        const big = "x".repeat(10001);
        const plan = applyAddSnippet({ trigger: "big", replacement: big, group: "" }, settings);
        expect(plan.ok).toBe(true);
        expect(settings.snippets["big"]).toHaveLength(10001);
    });
});
