import { describe, it, expect, vi } from "vitest";

// Provide a dummy class exported as SnipSidianSettingTab
vi.mock("../ui/settings", () => ({
    SnipSidianSettingTab: class TestTab { },
}));

import { SettingsTab } from "./settings-tab";

describe("app/settings-tab re-export", () => {
    it("re-exports SnipSidianSettingTab as SettingsTab", () => {
        expect(SettingsTab.name).toBe("TestTab");
    });
});
