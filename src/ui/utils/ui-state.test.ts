// @vitest-environment jsdom
//
// jsdom is required for the debounced group-open save test below:
// `UIStateManager#setGroupOpen` schedules its save via `window.setTimeout`
// (ui-state.ts), and `window` is undefined under vitest's default "node"
// environment.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { UIStateManager } from "./ui-state";
import type { SnipSidianSettings } from "../../types";

/**
 * ADR-0005: every fix ships with a regression test that fails before
 * the fix. These tests pin the contract the SnippetsTab redesign
 * depends on for B-021 (re-renders destroying in-progress edits).
 *
 * Why these specific tests, not coverage chasing:
 * - tab persistence migration: orphans users on upgrade if broken
 * - edit state lift: load-bearing for B-021 — re-renders MUST preserve
 *   the live draft reference so input handlers keep mutating the same
 *   object
 */

function makeSettings(overrides: Partial<SnipSidianSettings> = {}): SnipSidianSettings {
    return {
        snippets: {},
        ...overrides,
    };
}

describe("UIStateManager — tab migration (1.0.x → 1.1.0)", () => {
    it("preserves stored new-IA tab ids unchanged", () => {
        const settings = makeSettings({ ui: { activeTab: "packages" } });
        const ui = new UIStateManager(settings);
        expect(ui.loadActiveTab()).toBe("packages");
    });

    it("migrates pre-1.1.0 'basic' to 'general'", () => {
        const settings = makeSettings({ ui: { activeTab: "basic" } });
        const ui = new UIStateManager(settings);
        expect(ui.loadActiveTab()).toBe("general");
    });

    it("migrates pre-1.1.0 'community' to 'packages'", () => {
        const settings = makeSettings({ ui: { activeTab: "community" } });
        const ui = new UIStateManager(settings);
        expect(ui.loadActiveTab()).toBe("packages");
    });

    it("migrates pre-1.1.0 'feedback' to 'about'", () => {
        const settings = makeSettings({ ui: { activeTab: "feedback" } });
        const ui = new UIStateManager(settings);
        expect(ui.loadActiveTab()).toBe("about");
    });

    it("keeps pre-1.1.0 'snippets' as 'snippets'", () => {
        const settings = makeSettings({ ui: { activeTab: "snippets" } });
        const ui = new UIStateManager(settings);
        expect(ui.loadActiveTab()).toBe("snippets");
    });

    it("falls back to landing tab when stored value is unknown", () => {
        const settings = makeSettings({ ui: { activeTab: "wat-is-this" } });
        const ui = new UIStateManager(settings);
        expect(ui.loadActiveTab()).toBe("snippets");
    });

    it("falls back to landing tab on first launch (no stored value)", () => {
        const settings = makeSettings();
        const ui = new UIStateManager(settings);
        expect(ui.loadActiveTab()).toBe("snippets");
    });

    it("writes migrated value back so subsequent reads hit the happy path", () => {
        const settings = makeSettings({ ui: { activeTab: "community" } });
        const ui = new UIStateManager(settings);
        ui.loadActiveTab();
        expect(settings.ui!.activeTab).toBe("packages");
    });
});

describe("UIStateManager — inline edit state (B-021 contract)", () => {
    let ui: UIStateManager;

    beforeEach(() => {
        ui = new UIStateManager(makeSettings());
    });

    it("starts with no row in edit", () => {
        expect(ui.getEditingKey()).toBeNull();
        expect(ui.getEditingDraft()).toBeNull();
        expect(ui.isEditing("anything")).toBe(false);
    });

    it("setEditing stores key and draft atomically", () => {
        ui.setEditing("arrows/right", { triggerName: "right", replacement: "→" });
        expect(ui.getEditingKey()).toBe("arrows/right");
        expect(ui.getEditingDraft()).toEqual({ triggerName: "right", replacement: "→" });
    });

    it("isEditing matches only the active key", () => {
        ui.setEditing("a/b", { triggerName: "b", replacement: "x" });
        expect(ui.isEditing("a/b")).toBe(true);
        expect(ui.isEditing("a/c")).toBe(false);
        expect(ui.isEditing("")).toBe(false);
    });

    it("getEditingDraft returns a live reference (not a copy)", () => {
        // This is the load-bearing contract for B-021. The SnippetsTab
        // edit form binds input.oninput to `draft.triggerName = ...`.
        // If getEditingDraft returned a copy, re-renders would read a
        // stale value and lose user keystrokes.
        ui.setEditing("g/k", { triggerName: "k", replacement: "v" });
        const draft = ui.getEditingDraft();
        expect(draft).not.toBeNull();
        draft!.triggerName = "k2";
        expect(ui.getEditingDraft()!.triggerName).toBe("k2");
    });

    it("setEditing(null, null) clears state cleanly", () => {
        ui.setEditing("g/k", { triggerName: "k", replacement: "v" });
        ui.setEditing(null, null);
        expect(ui.getEditingKey()).toBeNull();
        expect(ui.getEditingDraft()).toBeNull();
        expect(ui.isEditing("g/k")).toBe(false);
    });

    it("switching edit target overwrites the previous draft", () => {
        // Single-edit-mode: opening edit on row B while A is editing
        // discards A's draft. Verifies the design choice.
        ui.setEditing("a/x", { triggerName: "x", replacement: "1" });
        ui.setEditing("b/y", { triggerName: "y", replacement: "2" });
        expect(ui.getEditingKey()).toBe("b/y");
        expect(ui.getEditingDraft()).toEqual({ triggerName: "y", replacement: "2" });
        expect(ui.isEditing("a/x")).toBe(false);
    });
});

describe("UIStateManager — debounced group-open save (persist rejection handling)", () => {
    // Regression test for a CI-only flake (GitHub Actions run 31030336533):
    // `setGroupOpen`'s 250ms debounce timer used to call `void this.persist()`
    // with no rejection handling. A rejected `persist` (e.g. a failed
    // `saveSettings`) surfaced as an unhandled promise rejection once the
    // timer fired, since nothing awaited or caught it. Fails before the
    // `Promise.resolve(this.persist()).catch(...)` fix in `setGroupOpen`
    // (the timer callback would throw instead of routing to console.error,
    // and vitest's unhandled-rejection detector would flag the run).
    it("a rejected persist from the debounced group-open save is caught, not left unhandled", async () => {
        vi.useFakeTimers();
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            const persist = vi.fn(async () => {
                throw new Error("disk full");
            });
            const ui = new UIStateManager(makeSettings(), persist);

            ui.setGroupOpen("work", true);
            await vi.advanceTimersByTimeAsync(300);

            expect(persist).toHaveBeenCalledTimes(1);
            expect(errorSpy).toHaveBeenCalledWith(
                "[snipsy] failed to save group state",
                expect.any(Error),
            );
        } finally {
            errorSpy.mockRestore();
            vi.useRealTimers();
        }
    });

    it("a resolving persist is still called once after the debounce window, on the success path", async () => {
        vi.useFakeTimers();
        try {
            const persist = vi.fn(async () => {});
            const ui = new UIStateManager(makeSettings(), persist);

            ui.setGroupOpen("work", true);
            expect(persist).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(300);

            expect(persist).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });
});
