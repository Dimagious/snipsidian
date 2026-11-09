import * as fs from "node:fs";
import * as path from "node:path";
import { extractFile } from "@electron/asar";
import { isExplicitVersion, normalizeVersion } from "./obsidian-version";

/**
 * Node-side half of the B-221 version check: works out which Obsidian
 * version a run is *supposed* to test. The renderer half (what is actually
 * running) lives in the `win` fixture.
 */

/** Default macOS install used by both launch modes unless overridden. */
export const DEFAULT_MAC_BINARY = "/Applications/Obsidian.app/Contents/MacOS/Obsidian";
export const DEFAULT_MAC_RESOURCES = "/Applications/Obsidian.app/Contents/Resources";

/** Resources directory (the one holding `obsidian.asar`) that belongs to an
 *  Obsidian executable. macOS keeps it at `Contents/Resources`, next to
 *  `Contents/MacOS`; Windows/Linux ship a `resources` folder beside the
 *  binary. */
export function resourcesDirFor(binaryPath: string): string {
    const dir = path.dirname(binaryPath);
    const macResources = path.resolve(dir, "..", "Resources");
    if (path.basename(dir) === "MacOS" && fs.existsSync(macResources)) return macResources;
    return path.join(dir, "resources");
}

/** `version` field of `<resourcesDir>/obsidian.asar`'s package.json, or
 *  `null` if the asar is missing or unreadable.
 *
 *  This is the real app version. `app.asar` next to it is only the thin
 *  installer shell and carries a different (installer) version number. */
export function readBundledAppVersion(resourcesDir: string): string | null {
    const asarPath = path.join(resourcesDir, "obsidian.asar");
    if (!fs.existsSync(asarPath)) return null;
    try {
        const pkg = JSON.parse(extractFile(asarPath, "package.json").toString("utf8")) as {
            version?: unknown;
        };
        return typeof pkg.version === "string" ? normalizeVersion(pkg.version) : null;
    } catch {
        return null;
    }
}

/** The version this run must be testing: `OBSIDIAN_VERSION` when set,
 *  otherwise whatever the bundle at `resourcesDir` ships.
 *
 *  `OBSIDIAN_VERSION` must be an explicit `x.y.z`. Channel aliases
 *  (`public-latest`, ...) would need a network lookup and a download, which
 *  is the job of the `integration/` layer (`npm run it:matrix`); here an
 *  alias is rejected loudly instead of being silently ignored. */
export function resolveExpectedVersion(resourcesDir: string): string | null {
    const fromEnv = normalizeVersion(process.env.OBSIDIAN_VERSION);
    if (fromEnv !== null) {
        if (!isExplicitVersion(fromEnv)) {
            throw new Error(
                `OBSIDIAN_VERSION="${fromEnv}" is not an explicit x.y.z version. ` +
                    `The e2e fixture only verifies the installed Obsidian; to test other ` +
                    `versions or channels use \`npm run it:matrix\`.`,
            );
        }
        return fromEnv;
    }
    return readBundledAppVersion(resourcesDir);
}
