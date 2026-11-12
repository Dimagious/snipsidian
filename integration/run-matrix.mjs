import { spawnSync } from "node:child_process";
import { runObsidianVersionMatrix } from "obsidian-integration-testing";

/**
 * `npm run it:matrix`: runs the desktop smoke tests against latest public and
 * latest catalyst Obsidian. When the two channels point at the same build the
 * library runs it once and says so, instead of reporting a two-end pass it did
 * not verify. Every version runs before a failure is thrown, so a red catalyst
 * does not hide the public result.
 *
 * `OBSIDIAN_VERSION` (comma-separated `x.y.z` / `public-latest` /
 * `catalyst-latest`) overrides the default pair.
 */
await runObsidianVersionMatrix({
    versions: process.env.OBSIDIAN_VERSION || undefined,
    run: ({ version }) => {
        // Runs from the repo root (see vitest.config.ts); `vitest` comes from
        // PATH, which `npm run` extends with integration/node_modules/.bin.
        const result = spawnSync(
            "vitest",
            ["run", "--config", "integration/vitest.config.ts", "--project", "desktop"],
            {
                env: { ...process.env, OBSIDIAN_VERSION: version },
                stdio: "inherit",
                shell: process.platform === "win32",
            },
        );
        if (result.status !== 0) {
            throw new Error(`vitest exited with ${String(result.status)} on Obsidian ${version}`);
        }
    },
});
