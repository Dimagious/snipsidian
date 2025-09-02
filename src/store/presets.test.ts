import { describe, it, expect } from "vitest";
import * as storePresets from "./presets";
import * as rootPresets from "../presets";

describe("store/presets re-export", () => {
    it("re-exports DEFAULT_SNIPPETS from root presets", () => {
        expect(storePresets).toHaveProperty("DEFAULT_SNIPPETS");
        expect(storePresets.DEFAULT_SNIPPETS).toBe(rootPresets.DEFAULT_SNIPPETS);
    });
});
