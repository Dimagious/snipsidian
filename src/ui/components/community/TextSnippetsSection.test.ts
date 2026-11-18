import { describe, it, expect, beforeEach, vi } from "vitest";

const noticeCalls: string[] = [];
vi.mock("obsidian", async () => {
    const actual = await vi.importActual("../../../test/stubs/obsidian");
    return {
        ...actual,
        Notice: vi.fn().mockImplementation(function (msg: string) {
            noticeCalls.push(msg);
        }),
    };
});

import { findTrigger } from "../../../engine/match";
import { getDict } from "../../../store/snippets";
import { splitKey } from "../../../store/keys";
import { makeMockPlugin } from "../../../test/factories/plugin";
import { TextSnippetsSection, formatTextSnippetsSummary } from "./TextSnippetsSection";
import type { App } from "obsidian";
import type SnipSidianPlugin from "../../../main";

let plugin: ReturnType<typeof makeMockPlugin>;
let files: Map<string, string>;
let readSpy: ReturnType<typeof vi.fn>;
let writeSpy: ReturnType<typeof vi.fn>;

const SOURCE = ".cfg/plugins/text-snippets-obsidian/data.json";

beforeEach(() => {
    document.body.innerHTML = "";
    noticeCalls.length = 0;
    plugin = makeMockPlugin();
    Object.assign(plugin.app.vault, { configDir: ".cfg" });
    files = new Map();
    readSpy = vi.fn(async (p: string) => {
        const v = files.get(p);
        if (v === undefined) throw new Error("ENOENT");
        return v;
    });
    writeSpy = vi.fn();
    Object.assign(plugin.app.vault.adapter, {
        exists: async (p: string) => files.has(p),
        read: readSpy,
        write: writeSpy,
    });
});

function mount(): HTMLButtonElement {
    const root = document.createElement("div");
    document.body.appendChild(root);
    void new TextSnippetsSection(plugin.app as unknown as App, plugin as unknown as SnipSidianPlugin).render(root);
    const btn = Array.from(root.querySelectorAll("button")).find((b) => b.textContent === "Import");
    if (!btn) throw new Error("Import button not rendered");
    return btn;
}

async function clickAndSettle(btn: HTMLButtonElement): Promise<void> {
    btn.click();
    // The import is async (read -> parse -> plan): wait for its first
    // visible effect, a Notice or the preview modal.
    await vi.waitFor(() => {
        expect(noticeCalls.length > 0 || document.querySelector(".modal-button-container")).toBeTruthy();
    });
}

function modalButton(label: string): HTMLButtonElement {
    const btn = Array.from(document.body.querySelectorAll<HTMLButtonElement>(".modal-button-container button")).find(
        (b) => b.textContent === label,
    );
    if (!btn) throw new Error(`Modal ${label} button not found`);
    return btn;
}

/** Click Apply and wait until the write finished (a Notice appears). */
async function apply(): Promise<void> {
    const before = noticeCalls.length;
    modalButton("Apply").click();
    await vi.waitFor(() => {
        expect(noticeCalls.length).toBeGreaterThan(before);
    });
}

describe("TextSnippetsSection", () => {
    it("renders a sentence-case heading and the Import button", () => {
        const btn = mount();
        const heading = Array.from(
            document.querySelectorAll(".setting-item-heading .setting-item-name"),
        ).find((el) => el.textContent === "Text Snippets import");
        expect(heading).toBeTruthy();
        expect(btn.textContent).toBe("Import");
    });

    // The old text said Snipsy always expands "as you type", false with "Expand while typing" off.
    it("the description does not promise expansion while typing, and points at the Tab option", () => {
        mount();
        const desc = document.querySelector(".setting-item-description")?.textContent ?? "";
        expect(desc).not.toContain("automatically as you type");
        expect(desc).toContain("Expand on Tab");
        expect(desc).toContain("Expand while typing");
    });

    it("shows a Notice and writes nothing when the source plugin has no data.json", async () => {
        const before = JSON.stringify(plugin.settings.snippets);
        await clickAndSettle(mount());
        expect(noticeCalls).toContain("Text Snippets settings not found in this vault");
        expect(JSON.stringify(plugin.settings.snippets)).toBe(before);
    });

    it("reads from <configDir>/plugins/text-snippets-obsidian/data.json (never a hardcoded .obsidian)", async () => {
        files.set(SOURCE, JSON.stringify({ snippets_file: "a : b" }));
        await clickAndSettle(mount());
        expect(readSpy).toHaveBeenCalledWith(SOURCE);
    });

    it("imports into the text-snippets group and never writes to the source plugin", async () => {
        files.set(SOURCE, JSON.stringify({ snippets_file: "brb : be right back\nlink : [[$end$]]" }));
        await clickAndSettle(mount());
        await apply();
        expect(plugin.settings.snippets["text-snippets/brb"]).toBe("be right back");
        expect(plugin.settings.snippets["text-snippets/link"]).toBe("[[$|]]");
        expect(plugin.settings.snippets["brb"]).toBeUndefined();
        expect(writeSpy).not.toHaveBeenCalled();
        expect(noticeCalls).toContain('Imported 2 snippets into "text-snippets"');
    });

    it("reports skipped records and warnings in the success Notice", async () => {
        files.set(
            SOURCE,
            JSON.stringify({ snippets_file: "ok : fine\nbad trigger : x\nform : a$tb$b $tb$c" }),
        );
        await clickAndSettle(mount());
        await apply();
        expect(plugin.settings.snippets["text-snippets/ok"]).toBe("fine");
        const notice = noticeCalls.find((m) => m.startsWith("Imported 2"));
        expect(notice).toContain("1 skipped: bad trigger");
        expect(notice).toContain("form (tab stop next to text or a backslash removed)");
    });

    it("surfaces a parse error as a Notice with no mutation", async () => {
        files.set(SOURCE, "{broken");
        const before = JSON.stringify(plugin.settings.snippets);
        await clickAndSettle(mount());
        expect(noticeCalls.some((m) => m.includes("not valid JSON"))).toBe(true);
        expect(JSON.stringify(plugin.settings.snippets)).toBe(before);
    });

    it("says why nothing imported when every record is skipped", async () => {
        files.set(SOURCE, JSON.stringify({ snippets_file: "no separator here" }));
        const before = JSON.stringify(plugin.settings.snippets);
        await clickAndSettle(mount());
        expect(noticeCalls.some((m) => m.startsWith("Nothing to import:") && m.includes("no ' : ' separator"))).toBe(true);
        expect(JSON.stringify(plugin.settings.snippets)).toBe(before);
    });

    it("says so when the source plugin has no snippets at all", async () => {
        files.set(SOURCE, JSON.stringify({ snippets_file: "" }));
        await clickAndSettle(mount());
        expect(noticeCalls).toContain("Nothing to import: Text Snippets has no snippets");
    });

    it("[S-009] refuses the whole import when the install gate fails (count cap), no mutation", async () => {
        const lines = Array.from({ length: 501 }, (_, i) => `t${i} : v${i}`).join("\n");
        files.set(SOURCE, JSON.stringify({ snippets_file: lines }));
        const before = JSON.stringify(plugin.settings.snippets);
        await clickAndSettle(mount());
        expect(noticeCalls.some((m) => m.startsWith("Cannot import Text Snippets:"))).toBe(true);
        expect(JSON.stringify(plugin.settings.snippets)).toBe(before);
    });

    it("[B-184] a cross-group collision does not abort: preview opens for the rest and lists the left-out trigger with its group", async () => {
        plugin.settings.snippets["other/brb"] = "different";
        files.set(SOURCE, JSON.stringify({ snippets_file: "brb : be right back\nomw : on my way" }));
        const before = JSON.stringify(plugin.settings.snippets);
        await clickAndSettle(mount());

        expect(noticeCalls.some((m) => m.includes("trigger name collision"))).toBe(false);
        const info = document.body.querySelector(".modal-content .snipsy-espanso-skip-status");
        expect(info?.textContent).toContain('1 skipped: brb (already used in group "other")');
        // Nothing written before Apply.
        expect(JSON.stringify(plugin.settings.snippets)).toBe(before);

        await apply();
        expect(plugin.settings.snippets["text-snippets/omw"]).toBe("on my way");
        expect(
            Object.prototype.hasOwnProperty.call(plugin.settings.snippets, "text-snippets/brb"),
        ).toBe(false);
        expect(plugin.settings.snippets["other/brb"]).toBe("different");
        expect(noticeCalls.some((m) => m.startsWith('Imported 1 snippet into "text-snippets"') && m.includes("already used in group"))).toBe(true);
    });

    it("[B-184] a trigger skipped for a collision is not also reported as changed", async () => {
        plugin.settings.snippets["other/brb"] = "different";
        files.set(SOURCE, JSON.stringify({ snippets_file: "brb : be $tb$right\nomw : on my way" }));
        await clickAndSettle(mount());

        const info = document.body.querySelector(".modal-content .snipsy-espanso-skip-status");
        expect(info?.textContent).toContain('brb (already used in group "other")');
        expect(info?.textContent).not.toContain("changed");
        expect(info?.textContent).not.toContain("tab stop next to text");

        await apply();
        const notice = noticeCalls.find((m) => m.startsWith('Imported 1 snippet into "text-snippets"'));
        expect(notice).toBeDefined();
        expect(notice).not.toContain("tab stop next to text");
    });

    it("[B-184] when every trigger collides: nothing to import, no preview, no write", async () => {
        plugin.settings.snippets["other/brb"] = "different";
        files.set(SOURCE, JSON.stringify({ snippets_file: "brb : be right back" }));
        const before = JSON.stringify(plugin.settings.snippets);
        await clickAndSettle(mount());
        expect(noticeCalls.some((m) => m.startsWith("Nothing to import:") && m.includes('brb (already used in group "other")'))).toBe(true);
        expect(document.body.querySelector(".modal-button-container")).toBeNull();
        expect(JSON.stringify(plugin.settings.snippets)).toBe(before);
        expect(plugin._saveCalls).toHaveLength(0);
    });

    it("[B-184] Cancel after a partial collision writes nothing", async () => {
        plugin.settings.snippets["other/brb"] = "different";
        files.set(SOURCE, JSON.stringify({ snippets_file: "brb : x\nomw : y" }));
        const before = JSON.stringify(plugin.settings.snippets);
        await clickAndSettle(mount());
        modalButton("Cancel").click();
        await Promise.resolve();
        expect(JSON.stringify(plugin.settings.snippets)).toBe(before);
        expect(plugin._saveCalls).toHaveLength(0);
    });

    it("[B-184] a same-group conflict still goes through keep/overwrite in the preview", async () => {
        plugin.settings.snippets["text-snippets/brb"] = "USER EDIT";
        plugin.settings.snippets["other/omw"] = "different";
        files.set(SOURCE, JSON.stringify({ snippets_file: "brb : new\nomw : y" }));
        await clickAndSettle(mount());
        const overwrite = Array.from(document.body.querySelectorAll("button")).find(
            (b) => b.textContent === "Overwrite all",
        );
        if (!overwrite) throw new Error("Overwrite all button not found");
        overwrite.click();
        await apply();
        expect(plugin.settings.snippets["text-snippets/brb"]).toBe("new");
        expect(plugin.settings.snippets["other/omw"]).toBe("different");
    });

    it("a `__proto__` trigger lands as a normal grouped key", async () => {
        files.set(SOURCE, JSON.stringify({ snippets_file: "__proto__ : x" }));
        await clickAndSettle(mount());
        await apply();
        expect(Object.prototype.hasOwnProperty.call(plugin.settings.snippets, "text-snippets/__proto__")).toBe(true);
        expect(Object.getPrototypeOf(plugin.settings.snippets)).toBe(Object.prototype);
    });

    it("reports a read failure instead of throwing", async () => {
        files.set(SOURCE, "x");
        readSpy.mockRejectedValueOnce(new Error("disk\nerror"));
        await clickAndSettle(mount());
        expect(noticeCalls).toContain("Could not read Text Snippets settings: disk error");
    });
});

describe("TextSnippetsSection: preview and write path", () => {
    it("always previews, writes NOTHING before Apply, then writes the grouped keys and reports", async () => {
        files.set(SOURCE, JSON.stringify({ snippets_file: "brb : be right back\nomw : on my way" }));
        const before = JSON.stringify(plugin.settings.snippets);
        await clickAndSettle(mount());
        // Zero conflicts, yet the modal is open and nothing is written.
        expect(modalButton("Apply")).toBeTruthy();
        expect(JSON.stringify(plugin.settings.snippets)).toBe(before);
        expect(plugin._saveCalls).toHaveLength(0);
        expect(noticeCalls).toEqual([]);

        await apply();
        expect(plugin.settings.snippets["text-snippets/brb"]).toBe("be right back");
        expect(plugin.settings.snippets["text-snippets/omw"]).toBe("on my way");
        expect(noticeCalls).toContain('Imported 2 snippets into "text-snippets"');
    });

    it("Cancel closes the preview and writes nothing", async () => {
        files.set(SOURCE, JSON.stringify({ snippets_file: "brb : be right back" }));
        const before = JSON.stringify(plugin.settings.snippets);
        await clickAndSettle(mount());
        modalButton("Cancel").click();
        await Promise.resolve();
        expect(JSON.stringify(plugin.settings.snippets)).toBe(before);
        expect(noticeCalls).toEqual([]);
    });

    it("a real conflict shows the skip summary in the modal; Apply with overwrite writes", async () => {
        plugin.settings.snippets["text-snippets/brb"] = "other";
        files.set(SOURCE, JSON.stringify({ snippets_file: "brb : be right back\nbad trigger : x" }));
        await clickAndSettle(mount());
        const info = document.body.querySelector(".modal-content .snipsy-espanso-skip-status");
        expect(info?.textContent).toContain("1 skipped: bad trigger");
        expect(plugin.settings.snippets["text-snippets/brb"]).toBe("other");

        const overwrite = Array.from(document.body.querySelectorAll("button")).find(
            (b) => b.textContent === "Overwrite all",
        );
        if (!overwrite) throw new Error("Overwrite all button not found");
        overwrite.click();
        await apply();
        expect(plugin.settings.snippets["text-snippets/brb"]).toBe("be right back");
        expect(noticeCalls.some((m) => m.startsWith('Imported 1 snippet into "text-snippets"'))).toBe(true);
    });

    it("keep-current on every conflict reports 'No changes' and keeps the user's value", async () => {
        plugin.settings.snippets["text-snippets/brb"] = "USER EDIT";
        files.set(SOURCE, JSON.stringify({ snippets_file: "brb : be right back" }));
        await clickAndSettle(mount());
        await apply();
        expect(plugin.settings.snippets["text-snippets/brb"]).toBe("USER EDIT");
        expect(noticeCalls).toContain('No changes: "text-snippets" already matches your library');
    });

    it("surfaces a saveSettings failure as a Notice instead of swallowing it", async () => {
        files.set(SOURCE, JSON.stringify({ snippets_file: "brb : be right back" }));
        plugin.saveSettings = vi.fn().mockRejectedValue(new Error("disk\nfull"));
        await clickAndSettle(mount());
        await apply();
        expect(noticeCalls).toContain("Failed to import Text Snippets: disk full");
        expect(noticeCalls.some((m) => m.startsWith("Imported"))).toBe(false);
    });

    it("[B-181] restores the previous snippets (same object) when saveSettings rejects", async () => {
        files.set(SOURCE, JSON.stringify({ snippets_file: "brb : be right back" }));
        const previous = plugin.settings.snippets;
        plugin.saveSettings = vi.fn().mockRejectedValue(new Error("disk full"));
        await clickAndSettle(mount());
        await apply();
        expect(plugin.settings.snippets).toBe(previous);
        expect(plugin.settings.snippets).toEqual({});
    });
});

describe("TextSnippetsSection: Unicode triggers", () => {
    const expandInput = (textBefore: string, prefix?: string) => ({
        textBefore,
        textAfter: "",
        lastTyped: " ",
        sepCh: textBefore.length,
        prefix,
    });

    it("imports `прив : Привет!` end to end, round-trips the key and expands it", async () => {
        files.set(SOURCE, JSON.stringify({ snippets_file: "прив : Привет!\ncafe\u0301 : coffee" }));
        await clickAndSettle(mount());
        await apply();
        expect(plugin.settings.snippets["text-snippets/прив"]).toBe("Привет!");
        expect(plugin.settings.snippets["text-snippets/caf\u00e9"]).toBe("coffee");
        expect(splitKey("text-snippets/прив")).toEqual({ group: "text-snippets", name: "прив" });

        const dict = getDict(plugin.settings);
        const hit = findTrigger(expandInput("прив"), dict);
        expect(hit?.trigger).toBe("прив");
        expect(dict[hit?.trigger ?? ""]).toBe("Привет!");
        // Word-bound: no match inside a longer word.
        expect(findTrigger(expandInput("приветик"), dict)).toBeNull();
        // NFC `café` typed in the editor matches the imported NFD record.
        expect(findTrigger(expandInput("caf\u00e9"), dict)?.trigger).toBe("caf\u00e9");
    });

    it("expands in prefix mode too (`:прив`), and not without the prefix", async () => {
        files.set(SOURCE, JSON.stringify({ snippets_file: "прив : Привет!" }));
        await clickAndSettle(mount());
        await apply();
        const dict = getDict(plugin.settings);
        expect(findTrigger(expandInput(":прив", ":"), dict)?.trigger).toBe("прив");
        expect(findTrigger(expandInput("прив", ":"), dict)).toBeNull();
    });

    it("skips an emoji trigger (named) while importing the Cyrillic one", async () => {
        files.set(SOURCE, JSON.stringify({ snippets_file: "прив : Привет!\nx\u{1F600} : smile" }));
        await clickAndSettle(mount());
        const info = document.body.querySelector(".modal-content .snipsy-espanso-skip-status");
        expect(info?.textContent).toContain("1 skipped");
        expect(info?.textContent).toContain("letters of any language");
        await apply();
        expect(Object.keys(plugin.settings.snippets)).toEqual(["text-snippets/прив"]);
    });

    it("shows the word-separator note in the preview and the Notice", async () => {
        files.set(SOURCE, JSON.stringify({ snippets_file: "прив : Привет!", wordDelimiters: " ." }));
        await clickAndSettle(mount());
        const info = document.body.querySelector(".modal-content .snipsy-espanso-skip-status");
        expect(info?.textContent).toContain("own word separators");
        await apply();
        expect(noticeCalls.some((m) => m.startsWith("Imported 1") && m.includes("own word separators"))).toBe(true);
    });

    it("shows no note for the default delimiters", async () => {
        files.set(
            SOURCE,
            JSON.stringify({ snippets_file: "прив : Привет!", wordDelimiters: "$()[]{}<>,.!?;:'\"\\/" }),
        );
        await clickAndSettle(mount());
        expect(document.body.querySelector(".modal-content .snipsy-espanso-skip-status")).toBeNull();
    });
});

describe("TextSnippetsSection under the text-snippets-obsidian id (recovery from a backup)", () => {
    const DIR = ".cfg/plugins/text-snippets-obsidian";
    const BACKUP = `${DIR}/text-snippets-backup.json`;

    beforeEach(() => {
        plugin = makeMockPlugin({ pluginId: "text-snippets-obsidian" });
        Object.assign(plugin.app.vault, { configDir: ".cfg" });
        Object.assign(plugin.manifest, { dir: DIR });
        Object.assign(plugin.app.vault.adapter, {
            exists: async (p: string) => files.has(p),
            read: readSpy,
            write: writeSpy,
            list: async (dir: string) => ({
                files: Array.from(files.keys()).filter((p) => p.startsWith(`${dir}/`)),
                folders: [],
            }),
        });
    });

    async function mountCompat(): Promise<{ root: HTMLElement; button: HTMLButtonElement | undefined }> {
        const root = document.createElement("div");
        document.body.appendChild(root);
        await new TextSnippetsSection(plugin.app as unknown as App, plugin as unknown as SnipSidianPlugin).render(root);
        const button = Array.from(root.querySelectorAll("button")).find((b) => b.textContent === "Import");
        return { root, button };
    }

    it("is hidden when there is no backup (data.json alone is the migrated file)", async () => {
        files.set(`${DIR}/data.json`, "{}");
        const { root, button } = await mountCompat();
        expect(button).toBeUndefined();
        expect(root.textContent).not.toContain("Text Snippets import");
    });

    it("is hidden when the folder cannot be listed, and says why in the console", async () => {
        const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
        Object.assign(plugin.app.vault.adapter, { list: async () => Promise.reject(new Error("no folder")) });
        const { button } = await mountCompat();
        expect(button).toBeUndefined();
        expect(err).toHaveBeenCalled();
        err.mockRestore();
    });

    it("is shown when a text-snippets-backup*.json exists, with a description naming the backup", async () => {
        files.set(BACKUP, JSON.stringify({ snippets_file: "brb : be right back" }));
        const { root, button } = await mountCompat();
        expect(button).toBeDefined();
        expect(root.querySelector(".setting-item-description")?.textContent).toContain("backup of the original Text Snippets file");
    });

    it("reads the newest backup (highest number), not the first one and not data.json", async () => {
        files.set(`${DIR}/data.json`, JSON.stringify({ snippets_file: "cur : from data" }));
        files.set(BACKUP, JSON.stringify({ snippets_file: "old : from first" }));
        files.set(`${DIR}/text-snippets-backup-2.json`, JSON.stringify({ snippets_file: "mid : from second" }));
        files.set(`${DIR}/text-snippets-backup-10.json`, JSON.stringify({ snippets_file: "new : from tenth" }));
        files.set(`${DIR}/text-snippets-backup-x.json`, JSON.stringify({ snippets_file: "bad : not a backup" }));
        const { button } = await mountCompat();
        await clickAndSettle(button as HTMLButtonElement);
        await apply();
        expect(readSpy).toHaveBeenCalledWith(`${DIR}/text-snippets-backup-10.json`);
        expect(readSpy).not.toHaveBeenCalledWith(`${DIR}/data.json`);
        expect(plugin.settings.snippets["text-snippets/new"]).toBe("from tenth");
        expect(plugin.settings.snippets["text-snippets/old"]).toBeUndefined();
        expect(writeSpy).not.toHaveBeenCalled();
    });

    it("still goes through the validated import: an over-limit backup is refused and nothing is written", async () => {
        const lines = Array.from({ length: 501 }, (_, i) => `t${i} : v${i}`).join("\n");
        files.set(BACKUP, JSON.stringify({ snippets_file: lines }));
        const { button } = await mountCompat();
        const before = JSON.stringify(plugin.settings.snippets);
        await clickAndSettle(button as HTMLButtonElement);
        expect(noticeCalls.some((m) => m.startsWith("Cannot import Text Snippets"))).toBe(true);
        expect(JSON.stringify(plugin.settings.snippets)).toBe(before);
    });

    it("the `snipsidian` id keeps reading the other plugin's data.json and shows the section without a backup", async () => {
        plugin = makeMockPlugin();
        Object.assign(plugin.app.vault, { configDir: ".cfg" });
        Object.assign(plugin.app.vault.adapter, {
            exists: async (p: string) => files.has(p),
            read: readSpy,
            list: vi.fn(),
        });
        files.set(SOURCE, JSON.stringify({ snippets_file: "a : b" }));
        const { button } = await mountCompat();
        expect(button).toBeDefined();
        await clickAndSettle(button as HTMLButtonElement);
        expect(readSpy).toHaveBeenCalledWith(SOURCE);
        expect((plugin.app.vault.adapter as unknown as { list: ReturnType<typeof vi.fn> }).list).not.toHaveBeenCalled();
    });
});

describe("formatTextSnippetsSummary", () => {
    it("is just the count when nothing was skipped or changed", () => {
        expect(formatTextSnippetsSummary(3, { skipped: [], warnings: [] })).toBe("3 imported");
    });

    it("caps the listed names at three and sanitizes control characters", () => {
        const skipped = ["a", "b", "c", "d"].map((t) => ({ trigger: `${t}\n`, reason: "r" }));
        const out = formatTextSnippetsSummary(1, { skipped, warnings: [] });
        expect(out).toBe("1 imported; 4 skipped: a (r), b (r), c (r), …");
    });

    it("appends import-wide notes, sanitized", () => {
        const out = formatTextSnippetsSummary(1, { skipped: [], warnings: [], notes: ["own\nseparators"] });
        expect(out).toBe("1 imported; own separators");
    });
});
