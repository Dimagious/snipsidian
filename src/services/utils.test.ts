import { describe, it, expect } from "vitest";
import { diffIncoming } from "./utils";

describe("utils.diffIncoming", () => {
    it("splits incoming into added and conflicts", () => {
        const incoming = { a: "1", b: "2", c: "3" };
        const current = { b: "B", d: "4" };
        const r = diffIncoming(incoming, current);

        expect(r.added).toEqual(
            expect.arrayContaining([
                { key: "a", value: "1" },
                { key: "c", value: "3" },
            ])
        );
        expect(r.added).toHaveLength(2);

        expect(r.conflicts).toEqual(
            expect.arrayContaining([
                { key: "b", incoming: "2", current: "B" },
            ])
        );
        expect(r.conflicts).toHaveLength(1);
    });

    it("does not mark identical values as conflicts", () => {
        const incoming = { a: "same" };
        const current = { a: "same" };
        const r = diffIncoming(incoming, current);

        expect(r.added).toHaveLength(0);
        expect(r.conflicts).toHaveLength(0);
    });
});

// Trigger-helper tests (normalizeTrigger/isBadTrigger) moved to
// `src/engine/triggers.test.ts` in 1.1.6 (B-026).

// Key-helper tests (splitKey/joinKey/slugifyGroup/displayGroupTitle)
// moved to `src/store/keys.test.ts` in 1.1.6 (B-026).
