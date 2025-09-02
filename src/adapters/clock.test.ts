import { describe, it, expect } from "vitest";
import { clock } from "./clock";

describe("adapters/clock", () => {
    it("now() returns a Date close to current time", () => {
        const t0 = Date.now();
        const d = clock.now();
        expect(d).toBeInstanceOf(Date);
        const delta = Math.abs(d.getTime() - t0);
        expect(delta).toBeLessThan(2000); // 2s tolerance is plenty
    });
});
