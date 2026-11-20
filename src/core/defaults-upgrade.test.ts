import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SNIPPETS } from "../presets";
import { INSTALL_MAX_REPLACEMENT_LEN } from "../services/package-validator";
import { DEFAULTS_UPGRADES, allDefaultsUpgradeIds, planDefaultsUpgrade as plan, readAppliedUpgrades } from "./defaults-upgrade";

const OLD_TABLE = "| H1 | H2 | H3 |\n| --- | --- | --- |\n| $| | | |";
const NEW_TABLE = DEFAULT_SNIPPETS.table ?? "";

/** The rewrites only (the marker part has its own tests). */
const planDefaultsUpgrade = (snippets: Record<string, string>, applied: string[] = []): Record<string, string> =>
    plan(snippets, applied).updates;

afterEach(() => vi.restoreAllMocks());

describe("B-217 planDefaultsUpgrade", () => {
    it("the fixed table really differs from the shipped-before value (the list is not a no-op)", () => {
        expect(NEW_TABLE).not.toBe(OLD_TABLE);
        expect(DEFAULTS_UPGRADES.find((u) => u.trigger === "table")?.old).toEqual([OLD_TABLE]);
    });

    it("a grouped default with the old value is upgraded", () => {
        expect(planDefaultsUpgrade({ "defaults/table": OLD_TABLE, "defaults/todo": "- [ ] $|" })).toEqual({
            "defaults/table": NEW_TABLE,
        });
    });

    it("a legacy bare key with the old value is upgraded", () => {
        expect(planDefaultsUpgrade({ table: OLD_TABLE })).toEqual({ table: NEW_TABLE });
    });

    it("both the grouped and the bare copy are upgraded in one go", () => {
        expect(planDefaultsUpgrade({ table: OLD_TABLE, "defaults/table": OLD_TABLE })).toEqual({
            table: NEW_TABLE,
            "defaults/table": NEW_TABLE,
        });
    });

    it("a user-edited value is untouched, even by one character", () => {
        expect(planDefaultsUpgrade({ "defaults/table": OLD_TABLE + " " })).toEqual({});
        expect(planDefaultsUpgrade({ table: "| a | b |" })).toEqual({});
    });

    it("a deleted default is not resurrected (B-130)", () => {
        expect(planDefaultsUpgrade({ "defaults/todo": "- [ ] $|" })).toEqual({});
        expect(planDefaultsUpgrade({})).toEqual({});
    });

    it("a renamed default is ignored; so is the old value under another group", () => {
        expect(planDefaultsUpgrade({ "defaults/tbl": OLD_TABLE })).toEqual({});
        expect(planDefaultsUpgrade({ "mine/table": OLD_TABLE })).toEqual({});
    });

    it("idempotent: an already upgraded map plans nothing", () => {
        expect(planDefaultsUpgrade({ "defaults/table": NEW_TABLE, table: NEW_TABLE })).toEqual({});
    });

    it("inherited Object.prototype members are not stored keys (S-004 / S-008)", () => {
        const proto = Object.create({ table: OLD_TABLE, "defaults/table": OLD_TABLE }) as Record<string, string>;
        expect(planDefaultsUpgrade(proto)).toEqual({});
    });

    it("an own `__proto__` key does not break the plan", () => {
        const map = JSON.parse(`{"__proto__": "x", "table": ${JSON.stringify(OLD_TABLE)}}`) as Record<string, string>;
        expect(planDefaultsUpgrade(map)).toEqual({ table: NEW_TABLE });
    });

    it("every superseded trigger is a current default, and no old value equals the current one", () => {
        for (const { trigger, old } of DEFAULTS_UPGRADES) {
            expect(Object.prototype.hasOwnProperty.call(DEFAULT_SNIPPETS, trigger)).toBe(true);
            expect(old).not.toContain(DEFAULT_SNIPPETS[trigger]);
        }
    });

    it("the shipped values pass the install limits (the S-009 gate accepts them)", () => {
        expect(NEW_TABLE.length).toBeLessThan(INSTALL_MAX_REPLACEMENT_LEN);
        expect(Object.keys(planDefaultsUpgrade({ table: OLD_TABLE }))).toEqual(["table"]);
    });
});

describe("B-217 applied-upgrades marker", () => {
    it("an upgrade already marked is not run again: a value set back to the old text stays", () => {
        const result = plan({ "defaults/table": OLD_TABLE }, ["table@1.11.0"]);
        expect(result).toEqual({ updates: {}, newlyApplied: [] });
    });

    it("a first look marks the upgrade even when nothing matched (edited, deleted)", () => {
        expect(plan({ "defaults/table": "mine" })).toEqual({ updates: {}, newlyApplied: ["table@1.11.0"] });
        expect(plan({})).toEqual({ updates: {}, newlyApplied: ["table@1.11.0"] });
    });

    it("an upgrade that rewrites is marked too", () => {
        expect(plan({ table: OLD_TABLE })).toEqual({ updates: { table: NEW_TABLE }, newlyApplied: ["table@1.11.0"] });
    });

    it("ids are `<trigger>@<version>`, unique, and a fresh install is marked with all of them", () => {
        const ids = allDefaultsUpgradeIds();
        expect(new Set(ids).size).toBe(ids.length);
        for (const u of DEFAULTS_UPGRADES) expect(u.id).toMatch(new RegExp(`^${u.trigger}@\\d+\\.\\d+\\.\\d+$`));
        expect(plan({ table: OLD_TABLE }, ids)).toEqual({ updates: {}, newlyApplied: [] });
    });

    it("readAppliedUpgrades keeps the strings of a list and drops everything else", () => {
        expect(readAppliedUpgrades(["a@1.0.0", 5, null, "b@2.0.0"])).toEqual(["a@1.0.0", "b@2.0.0"]);
        expect(readAppliedUpgrades(undefined)).toEqual([]);
        expect(readAppliedUpgrades("table@1.11.0")).toEqual([]);
        expect(readAppliedUpgrades({ 0: "x" })).toEqual([]);
    });
});

describe("B-217 the S-009 gate", () => {
    it("a refused check upgrades and marks nothing, and says why", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const original = DEFAULT_SNIPPETS.table;
        DEFAULT_SNIPPETS.table = "x".repeat(INSTALL_MAX_REPLACEMENT_LEN + 1);
        try {
            expect(plan({ table: OLD_TABLE })).toEqual({ updates: {}, newlyApplied: [] });
        } finally {
            if (original !== undefined) DEFAULT_SNIPPETS.table = original;
        }
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0]?.[0]).toContain("refused by the install limits");
        expect(warn.mock.calls[0]?.[1]).toHaveProperty("errors");
    });
});

describe("B-208 default `table`", () => {
    const lines = NEW_TABLE.split("\n");

    it("is a 3-column table with a header, a separator and 2 body rows", () => {
        const rows = lines.filter((l) => l.startsWith("|")).map((l) => l.replace("$|", ""));
        expect(rows).toHaveLength(4);
        for (const row of rows) expect(row.split("|").length - 2).toBe(3);
    });

    it("ends with a newline, so the typed separator never lands after the last pipe (4th column in Live Preview)", () => {
        expect(NEW_TABLE.endsWith("|\n")).toBe(true);
    });

    it("keeps the caret in the first body cell", () => {
        expect(lines[2]).toBe("| $| | | |");
        expect(NEW_TABLE.split("$|")).toHaveLength(2);
    });
});
