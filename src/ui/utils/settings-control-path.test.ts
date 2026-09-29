import { describe, it, expect } from "vitest";
import { createControlHost } from "./settings-control-path";
import { makeMockPlugin } from "../../test/factories/plugin";
import type SnipSidianPlugin from "../../main";

/**
 * Finding #10: `createControlHost` allowlists the two real
 * `expansion.*` fields (`requirePrefix`/`prefixChar`) by an explicit
 * `Set` membership check (S-004 style), instead of letting any field
 * name under `expansion.*` pass through to `expansion[field]`. These
 * tests pin both the allowed fields (unchanged contract) and the
 * allowlist boundary (an unrecognised field is a no-op, not a pass
 * -through write/read).
 */
describe("createControlHost — expansion.* allowlist (finding #10)", () => {
    function host(settings: Parameters<typeof makeMockPlugin>[0] = {}) {
        const plugin = makeMockPlugin(settings);
        return { plugin, host: createControlHost(plugin as unknown as SnipSidianPlugin) };
    }

    it("reads and writes the allowed requirePrefix field", async () => {
        const { plugin, host: h } = host({ settings: { snippets: {}, expansion: { requirePrefix: true } } });
        expect(h.getControlValue("expansion.requirePrefix")).toBe(true);

        await h.setControlValue("expansion.requirePrefix", false);
        expect(plugin.settings.expansion?.requirePrefix).toBe(false);
        expect(plugin._saveCalls.length).toBe(1);
    });

    it("reads and writes the allowed prefixChar field", async () => {
        const { plugin, host: h } = host({ settings: { snippets: {}, expansion: { prefixChar: ";" } } });
        expect(h.getControlValue("expansion.prefixChar")).toBe(";");

        await h.setControlValue("expansion.prefixChar", ":");
        expect(plugin.settings.expansion?.prefixChar).toBe(":");
    });

    it("an unrecognised field under expansion.* reads undefined and writes as a no-op", async () => {
        const { plugin, host: h } = host({
            settings: { snippets: {}, expansion: { requirePrefix: true } },
        });

        expect(h.getControlValue("expansion.notARealField")).toBeUndefined();

        await h.setControlValue("expansion.notARealField", "x");
        expect(
            Object.prototype.hasOwnProperty.call(plugin.settings.expansion ?? {}, "notARealField"),
        ).toBe(false);
        expect(plugin._saveCalls.length).toBe(0);
    });

    // Checker finding #5: `key`'s two segments come from `key.split(".")`
    // on a bare string — before the `EXPANSION_FIELDS.has(field)`
    // allowlist check, `field` could be an inherited `Object.prototype`
    // member name (`constructor`, `__proto__`, `toString`, …). Pin
    // that these are no-ops on both sides, same defensive posture as
    // S-004/S-008's `hasOwnProperty` guards elsewhere in the codebase —
    // `EXPANSION_FIELDS` is a `Set`, so `.has()` never resolves an
    // inherited member the way a bare `field in expansion` or
    // `expansion[field]` lookup would.
    it.each(["constructor", "__proto__", "toString"])(
        "expansion.%s is a no-op on write and reads undefined",
        async (field) => {
            const { plugin, host: h } = host({
                settings: { snippets: {}, expansion: { requirePrefix: true } },
            });

            expect(h.getControlValue(`expansion.${field}`)).toBeUndefined();

            await h.setControlValue(`expansion.${field}`, "polluted");
            expect(plugin._saveCalls.length).toBe(0);
            // The real Object.prototype member must be untouched.
            expect(({} as Record<string, unknown>)[field]).not.toBe("polluted");
            // And the allowlisted fields must be unaffected too.
            expect(plugin.settings.expansion?.requirePrefix).toBe(true);
        },
    );

    it("a dotted key outside the expansion section reads undefined and writes as a no-op", async () => {
        const { plugin, host: h } = host({ settings: { snippets: {} } });

        expect(h.getControlValue("packages.source")).toBeUndefined();

        await h.setControlValue("packages.source", "x");
        expect(plugin._saveCalls.length).toBe(0);
    });

    it("a key with no dotted field segment (no '.') is a no-op both ways", async () => {
        const { plugin, host: h } = host({ settings: { snippets: {} } });

        expect(h.getControlValue("expansion")).toBeUndefined();

        await h.setControlValue("expansion", "x");
        expect(plugin._saveCalls.length).toBe(0);
    });
});
