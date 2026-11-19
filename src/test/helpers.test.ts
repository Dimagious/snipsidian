import { describe, it, expect } from "vitest";
import { fastestOf } from "./helpers";

function sampler(values: number[]): { run: () => number; calls: () => number } {
    let i = 0;
    return { run: () => values[i++] ?? Infinity, calls: () => i };
}

describe("fastestOf", () => {
    it("stops at the first sample under the bound", () => {
        const s = sampler([5, 1, 1]);
        expect(fastestOf(s.run, 10, 100)).toBe(5);
        expect(s.calls()).toBe(1);
    });

    it("one slow sample (a preempted run) does not end the loop: the next fast sample is used", () => {
        const s = sampler([500, 5]);
        expect(fastestOf(s.run, 10, 100)).toBe(5);
        expect(s.calls()).toBe(2);
    });

    it("gives up after two samples over `hopeless`, returning the minimum", () => {
        const s = sampler([500, 300, 1]);
        expect(fastestOf(s.run, 10, 100)).toBe(300);
        expect(s.calls()).toBe(2);
    });

    it("keeps sampling up to `samples` when the minimum sits between bound and hopeless", () => {
        const s = sampler([50, 40, 60, 45, 70, 1]);
        expect(fastestOf(s.run, 10, 100, 5)).toBe(40);
        expect(s.calls()).toBe(5);
    });
});
