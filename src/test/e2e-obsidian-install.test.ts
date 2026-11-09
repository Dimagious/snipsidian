import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createPackage } from "@electron/asar";
import { readBundledAppVersion, resolveExpectedVersion } from "../../e2e/obsidian-install";
import { filterObsidianPages } from "../../e2e/obsidian-windows";

/**
 * B-221 / B-220: the Node-side half of the version check and the CDP page
 * filter. Real (tiny) asar files in a tmpdir, no Obsidian involved.
 */

let tmp: string;
let savedVersion: string | undefined;

beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "snipsy-install-"));
    savedVersion = process.env.OBSIDIAN_VERSION;
    delete process.env.OBSIDIAN_VERSION;
});

afterEach(() => {
    if (savedVersion === undefined) delete process.env.OBSIDIAN_VERSION;
    else process.env.OBSIDIAN_VERSION = savedVersion;
    fs.rmSync(tmp, { recursive: true, force: true });
});

async function writeAsar(resourcesDir: string, pkg: string): Promise<void> {
    const src = path.join(tmp, "asar-src");
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, "package.json"), pkg);
    fs.mkdirSync(resourcesDir, { recursive: true });
    await createPackage(src, path.join(resourcesDir, "obsidian.asar"));
}

describe("readBundledAppVersion (B-221)", () => {
    it("reads the version from obsidian.asar's package.json", async () => {
        const res = path.join(tmp, "Resources");
        await writeAsar(res, JSON.stringify({ version: " 1.14.5\n" }));
        expect(readBundledAppVersion(res)).toBe("1.14.5");
    });

    it("returns null when the asar is missing", () => {
        expect(readBundledAppVersion(path.join(tmp, "nowhere"))).toBeNull();
    });

    it("returns null when the asar is unreadable", () => {
        const res = path.join(tmp, "Resources");
        fs.mkdirSync(res, { recursive: true });
        fs.writeFileSync(path.join(res, "obsidian.asar"), "not an asar");
        expect(readBundledAppVersion(res)).toBeNull();
    });

    it("returns null when package.json has no string version", async () => {
        const res = path.join(tmp, "Resources");
        await writeAsar(res, JSON.stringify({ version: 5 }));
        expect(readBundledAppVersion(res)).toBeNull();
    });
});

describe("resolveExpectedVersion (B-221)", () => {
    it("prefers an explicit OBSIDIAN_VERSION over the bundle", async () => {
        const res = path.join(tmp, "Resources");
        await writeAsar(res, JSON.stringify({ version: "1.13.7" }));
        process.env.OBSIDIAN_VERSION = " 1.14.5 ";
        expect(resolveExpectedVersion(res)).toBe("1.14.5");
    });

    it("falls back to the bundled version when the env var is unset or empty", async () => {
        const res = path.join(tmp, "Resources");
        await writeAsar(res, JSON.stringify({ version: "1.13.7" }));
        expect(resolveExpectedVersion(res)).toBe("1.13.7");
        process.env.OBSIDIAN_VERSION = "  ";
        expect(resolveExpectedVersion(res)).toBe("1.13.7");
    });

    it("rejects channel aliases loudly instead of ignoring them", () => {
        process.env.OBSIDIAN_VERSION = "public-latest";
        expect(() => resolveExpectedVersion(tmp)).toThrow(/public-latest.*explicit x\.y\.z/);
        process.env.OBSIDIAN_VERSION = "catalyst-latest";
        expect(() => resolveExpectedVersion(tmp)).toThrow(/it:matrix/);
    });

    it("rejects partial versions", () => {
        process.env.OBSIDIAN_VERSION = "1.14";
        expect(() => resolveExpectedVersion(tmp)).toThrow();
    });
});

describe("filterObsidianPages (B-220)", () => {
    const page = (url: string): { url(): string } => ({ url: () => url });

    it("drops devtools:// targets and keeps real and popout windows", () => {
        const main = page("app://obsidian.md/index.html");
        const popout = page("about:blank");
        const dev = page("devtools://devtools/bundled/inspector.html");
        expect(filterObsidianPages([dev, main, popout])).toEqual([main, popout]);
    });

    it("returns an empty list when only devtools targets exist", () => {
        expect(filterObsidianPages([page("devtools://x")])).toEqual([]);
    });

    it("does not match devtools:// elsewhere in the URL", () => {
        const odd = page("app://obsidian.md/index.html?next=devtools://x");
        expect(filterObsidianPages([odd])).toEqual([odd]);
    });
});
