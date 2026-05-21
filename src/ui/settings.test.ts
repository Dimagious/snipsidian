import { describe, it, expect } from "vitest";
import { SnipSidianSettingTab } from "./settings";
import { SnipSidianSettingTab as DirectImport } from "./components/SettingsTab";

/**
 * `src/ui/settings.ts` is a 2-line re-export — the smoke test
 * confirms the re-export points at the right class so a future
 * accidental break (renamed source class, moved file, etc.)
 * doesn't ship silently.
 */
describe("src/ui/settings re-export", () => {
    it("re-exports SnipSidianSettingTab from components/SettingsTab", () => {
        expect(SnipSidianSettingTab).toBe(DirectImport);
    });
});
