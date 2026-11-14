import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Integration layer (B-219): the same smoke tests run inside a real Obsidian
 * through `obsidian-integration-testing`. A standalone project (own
 * package.json and lockfile, not a workspace), so the root `npm test` /
 * coverage never launch Obsidian and root installs never pull this in.
 * Playwright (`e2e/`) keeps owning UI, IME and media.
 *
 * Run from the repo root (the `it*` scripts do `cd ..`): the library finds the
 * project root from `process.cwd()` and then looks for `dist/build` and `src/`
 * there, which is what keeps its stale-build guard meaningful. `root` below
 * points vitest back at this folder so tests and the library's own modules
 * resolve from `integration/node_modules`.
 *
 *   npm run it            desktop, the installed Obsidian
 *   npm run it:matrix     desktop, latest public + latest catalyst
 *   npm run it:android    Android emulator (needs the Android SDK, see below)
 *
 * `OBSIDIAN_VERSION` (x.y.z, `public-latest` or `catalyst-latest`) pins the
 * desktop app version; the matrix runner sets it per run.
 *
 * Android prerequisites (not part of this repo, checked by the library at
 * setup time): Android Studio / SDK with `adb` and `emulator` on PATH, an AVD
 * (name in `ANDROID_AVD`, default `obsidian_test`) provisioned per the
 * library's "AVD provisioning" table (16G data partition, 4 GB RAM), and
 * Obsidian installed on it with storage permission granted:
 *   adb shell appops set md.obsidian MANAGE_EXTERNAL_STORAGE allow
 * Appium and the UiAutomator2 driver are auto-installed by the library.
 * Input on Android goes through the WebView debugger, so it does not replace
 * a manual Gboard / IME check.
 */

const shared = {
    root: fileURLToPath(new URL(".", import.meta.url)),
    include: ["**/*.integration.test.ts"],
    // One Obsidian instance and one temporary vault per run: files must not
    // run in parallel (the library documents this as a flakiness source).
    fileParallelism: false,
    globalSetup: ["./test/global-setup.ts"],
    // Registers the per-worker transport/vault resolvers; without it a
    // worker silently builds its own un-prepared transport.
    setupFiles: ["obsidian-integration-testing/vitest-setup"],
    // Cold start of a freshly provisioned instance is slow, especially on Android.
    testTimeout: 60_000,
    hookTimeout: 60_000,
};

export default defineConfig({
    test: {
        projects: [
            {
                test: {
                    ...shared,
                    name: "desktop",
                    environmentOptions: {
                        obsidianTransport: {
                            type: "obsidian-cdp",
                            // Unset means "the installed Obsidian".
                            obsidianVersion: process.env.OBSIDIAN_VERSION || undefined,
                            // Keep test runs from stealing focus.
                            isObsidianAppVisible: false,
                        },
                    },
                },
            },
            {
                test: {
                    ...shared,
                    name: "android",
                    environmentOptions: {
                        obsidianTransport: {
                            type: "obsidian-android-appium",
                            appiumUrl: process.env.APPIUM_URL ?? "http://localhost:4723",
                            avdName: process.env.ANDROID_AVD ?? "obsidian_test",
                        },
                    },
                },
            },
        ],
    },
});
