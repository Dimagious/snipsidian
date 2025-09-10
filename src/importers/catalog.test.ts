import { describe, it, expect } from "vitest";
import * as pkg from "../catalog";
import * as imp from "./catalog";

describe("importers/catalog re-exports", () => {
    it("exports the same symbols as packages/catalog", () => {
        expect(Object.keys(imp).sort()).toEqual(Object.keys(pkg).sort());
    });
});
