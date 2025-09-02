import { describe, it, expect } from "vitest";
import { runMigrations } from "./migrations";

describe("store/migrations", () => {
    it("returns input unchanged when no migrations", () => {
        const obj = { a: 1 };
        expect(runMigrations(obj)).toEqual(obj);
    });
});
