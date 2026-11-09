/**
 * Pure helpers for the "which Obsidian did this run actually test?" check
 * (B-221). No Node or Playwright imports on purpose: the comparison is unit
 * tested from `src/test/e2e-obsidian-version.test.ts` (vitest only picks up
 * tests under `src/`), and the I/O half lives in `obsidian-install.ts`.
 */

const EXPLICIT_VERSION = /^\d+\.\d+\.\d+$/;

/** Outcome of comparing the version a run was meant to test with the one
 *  that is actually running in the renderer. */
export interface VersionVerdict {
    /** `match`: same x.y.z. `mismatch`: the run is testing the wrong build.
     *  `unknown`: one side could not be determined, so nothing is claimed. */
    status: "match" | "mismatch" | "unknown";
    /** Human-readable line for the failure message / test annotation. */
    message: string;
}

/** True for a plain `x.y.z` string. Channel aliases such as `public-latest`
 *  are not accepted here: this fixture only checks, it never downloads. */
export function isExplicitVersion(value: string): boolean {
    return EXPLICIT_VERSION.test(value);
}

/** Trims a version read from a file, env var or the renderer. Returns
 *  `null` when nothing usable is left, so callers can treat "unreadable"
 *  and "empty" the same way. */
export function normalizeVersion(raw: string | null | undefined): string | null {
    const trimmed = raw?.trim();
    return trimmed ? trimmed : null;
}

/** Compares the expected and the running Obsidian version.
 *
 *  Equality is on the trimmed string: Obsidian reports `x.y.z` for both the
 *  asar `package.json` and `ipcRenderer.sendSync("version")`, so no semver
 *  range logic is wanted (a "close enough" match would defeat the check). */
export function compareObsidianVersions(
    expected: string | null | undefined,
    actual: string | null | undefined,
): VersionVerdict {
    const want = normalizeVersion(expected);
    const got = normalizeVersion(actual);
    if (got === null) {
        return {
            status: "unknown",
            message: "could not read the running Obsidian version from the renderer",
        };
    }
    if (want === null) {
        return {
            status: "unknown",
            message: `running Obsidian ${got}; no expected version to compare against`,
        };
    }
    if (want === got) {
        return { status: "match", message: `Obsidian ${got}` };
    }
    return {
        status: "mismatch",
        message:
            `Obsidian version mismatch: expected ${want}, but ${got} is running. ` +
            `The run is not testing the build you asked for. Check OBSIDIAN_VERSION ` +
            `and the installed Obsidian (a newer obsidian-<version>.asar in the user-data ` +
            `dir, or an auto-update, can override the bundled one).`,
    };
}
