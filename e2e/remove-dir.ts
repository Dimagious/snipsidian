import * as fs from "node:fs";

/**
 * Removes a temp directory (the per-test Obsidian user-data dir) and never
 * throws. Chromium helper processes (renderer/GPU/network) can still be
 * writing into the dir for a moment after the main process exits, which makes
 * a plain `rmSync` fail with ENOTEMPTY. Node retries ENOTEMPTY/EBUSY/EPERM
 * with `maxRetries`/`retryDelay`; if it still fails, leaking a temp dir is
 * acceptable, failing a test that passed is not, so it warns with the path.
 *
 * `rm` is injectable only so a unit test can force the failure.
 */
export function removeDirTolerant(
    dir: string,
    rm: typeof fs.rmSync = fs.rmSync,
): boolean {
    try {
        rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
        return true;
    } catch (err) {
        console.warn(
            `[e2e] could not remove ${dir} after retries, leaving it behind: ${
                err instanceof Error ? err.message : String(err)
            }`,
        );
        return false;
    }
}
