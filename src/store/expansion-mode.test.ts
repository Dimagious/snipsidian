import { describe, it, expect } from "vitest";
import { expandsOnTab, expandsOnType } from "./expansion-mode";

describe("store/expansion-mode (B-255)", () => {
    it("defaults keep existing installs unchanged: typing on, Tab off", () => {
        expect(expandsOnType({})).toBe(true);
        expect(expandsOnTab({})).toBe(false);
        expect(expandsOnType({ expansion: {} })).toBe(true);
        expect(expandsOnTab({ expansion: { requirePrefix: true } })).toBe(false);
    });

    it("typing is off only for an explicit false", () => {
        expect(expandsOnType({ expansion: { onType: false } })).toBe(false);
        expect(expandsOnType({ expansion: { onType: true } })).toBe(true);
    });

    it("Tab is on only for an explicit true", () => {
        expect(expandsOnTab({ expansion: { onTab: true } })).toBe(true);
        expect(expandsOnTab({ expansion: { onTab: false } })).toBe(false);
    });

    it("corrupt saved values fall back to the defaults", () => {
        const corrupt = { expansion: { onType: "no", onTab: "yes" } } as unknown as { expansion: { onType: boolean; onTab: boolean } };
        expect(expandsOnType(corrupt)).toBe(true);
        expect(expandsOnTab(corrupt)).toBe(false);
    });

    it("the two switches are independent", () => {
        const manual = { expansion: { onType: false, onTab: true } };
        expect([expandsOnType(manual), expandsOnTab(manual)]).toEqual([false, true]);
        const neither = { expansion: { onType: false, onTab: false } };
        expect([expandsOnType(neither), expandsOnTab(neither)]).toEqual([false, false]);
    });
});
