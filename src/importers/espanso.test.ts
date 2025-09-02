import { describe, it, expect } from "vitest";
import * as pkg from "../packages/espanso";
import * as imp from "./espanso";

describe("importers/espanso re-exports", () => {
    it("exports the same symbols as packages/espanso", () => {
        expect(Object.keys(imp).sort()).toEqual(Object.keys(pkg).sort());
    });
});
