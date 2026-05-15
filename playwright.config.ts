import { defineConfig } from "@playwright/test";

/**
 * E2E config — runs against a real Obsidian instance launched from
 * `./.obsidian-unpacked/main.js` (Obsidian's `obsidian.asar` extracted
 * via `scripts/e2e-setup.sh`). Direct launch of the `.app` binary no
 * longer works on macOS due to a 2024 Electron fuse change.
 *
 * Constraints baked in here:
 *   - `fullyParallel: false` + `workers: 1` — Obsidian opens one
 *     window per launched Electron process. Running specs in
 *     parallel against the same vault corrupts state (and against
 *     separate vaults is wasteful for a UI-level test). Serial only.
 *   - Long timeout — Obsidian cold start (especially on first
 *     unpack) easily takes 15-20s on a busy machine.
 *   - Retain trace + video on failure — without these, debugging an
 *     E2E failure means re-running locally and reproducing by hand,
 *     which defeats the point.
 */
export default defineConfig({
    testDir: "./e2e",
    fullyParallel: false,
    workers: 1,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? "list" : [["list"], ["html", { open: "never" }]],
    timeout: 60_000,
    expect: { timeout: 10_000 },
    use: {
        trace: "retain-on-failure",
        video: "retain-on-failure",
        screenshot: "only-on-failure",
    },
});
