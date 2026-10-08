import { describe, it, expect, vi, beforeEach } from "vitest";

const modalArgs: unknown[][] = [];
const open = vi.fn();
vi.mock("./Modals", () => ({
    AddSnippetModal: class {
        constructor(...args: unknown[]) { modalArgs.push(args); }
        open = open;
    },
}));
const notices: string[] = [];
vi.mock("obsidian", () => ({
    Notice: class { constructor(msg: string) { notices.push(msg); } },
}));

const { openAddSnippetFromSelection } = await import("./AddFromSelection");

type Confirm = (s: { trigger: string; replacement: string; group: string }) => Promise<{ ok: boolean; error?: string }>;

function setup(snippets: Record<string, string> = {}) {
    const plugin = {
        app: {},
        settings: { snippets, expansion: { mode: "prefix" } },
        saveSettings: vi.fn().mockResolvedValue(undefined),
    };
    openAddSnippetFromSelection(plugin as never, "sel\nected");
    const args = modalArgs[modalArgs.length - 1] as unknown[];
    return { plugin, onConfirm: args[1] as Confirm, args };
}

describe("openAddSnippetFromSelection (B-175)", () => {
    beforeEach(() => { modalArgs.length = 0; notices.length = 0; vi.clearAllMocks(); });

    it("opens the modal prefilled with the selection", () => {
        const { plugin, args } = setup();
        expect(args[2]).toBe(plugin.settings.expansion);
        expect(args[3]).toBe("sel\nected");
        expect(open).toHaveBeenCalledTimes(1);
    });

    it("saves through the validated path, then notices", async () => {
        const { plugin, onConfirm } = setup();
        const res = await onConfirm({ trigger: "sel", replacement: "sel\nected", group: "" });
        expect(res).toEqual({ ok: true });
        expect(plugin.settings.snippets).toEqual({ sel: "sel\nected" });
        expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
        expect(notices).toEqual(['Snippet "sel" added']);
    });

    it("names the notice after the stored (normalized) trigger, not the typed one", async () => {
        const { plugin, onConfirm } = setup();
        const res = await onConfirm({ trigger: ":sel", replacement: "x", group: "" });
        expect(res).toEqual({ ok: true });
        expect(Object.keys(plugin.settings.snippets)).toEqual(["sel"]);
        expect(notices).toEqual(['Snippet "sel" added']);
    });

    it("reports a collision inline: no write, no save, no notice", async () => {
        const { plugin, onConfirm } = setup({ sel: "old" });
        const res = await onConfirm({ trigger: "sel", replacement: "x", group: "" });
        expect(res.ok).toBe(false);
        expect(plugin.settings.snippets).toEqual({ sel: "old" });
        expect(plugin.saveSettings).not.toHaveBeenCalled();
        expect(notices).toEqual([]);
    });

    it("rejects an invalid trigger (single -)", async () => {
        const { plugin, onConfirm } = setup();
        const res = await onConfirm({ trigger: "-", replacement: "x", group: "" });
        expect(res.ok).toBe(false);
        expect(plugin.saveSettings).not.toHaveBeenCalled();
    });

    // S-013 (B-179)
    it("rejects a selection longer than 10000 chars: message returned, nothing written", async () => {
        const { plugin, onConfirm } = setup();
        const res = await onConfirm({ trigger: "big", replacement: "y".repeat(10001), group: "" });
        expect(res).toEqual({ ok: false, error: "Replacement is 10,001 characters; the limit is 10,000" });
        expect(plugin.settings.snippets).toEqual({});
        expect(plugin.saveSettings).not.toHaveBeenCalled();
        expect(notices).toEqual([]);
    });

    it("accepts a selection of exactly 10000 chars", async () => {
        const { plugin, onConfirm } = setup();
        const res = await onConfirm({ trigger: "edge", replacement: "y".repeat(10000), group: "" });
        expect(res).toEqual({ ok: true });
        expect(plugin.settings.snippets["edge"]).toHaveLength(10000);
    });
});
