import { copyFileSync, existsSync, mkdirSync, statSync, utimesSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { TestProject } from "vitest/node";

/**
 * Global setup for the `integration/` layer (B-219).
 *
 * `obsidian-integration-testing` looks for the built plugin in `dist/dev` or
 * `dist/build` under the project root. Snipsy's build writes `main.js` /
 * `styles.css` at the repo root (that is where Obsidian, the release workflow
 * and the e2e symlinks expect them), so the build is staged into `dist/build`
 * here before the library installs it into its temporary vault and enables it.
 *
 * Timestamps are preserved on purpose: the library refuses a build that is
 * older than `src/` ("stale build" guard). A fresh mtime from the copy would
 * make a forgotten `npm run build` look current and the suite would test an
 * old plugin.
 *
 * The library is imported dynamically into an `unknown` and described by the
 * interface below. A static import is `any` for a linter that runs without
 * `integration/node_modules` (the community scanner installs only the root
 * dependencies) and would report every use of it as unsafe. `tsc` and
 * `npm run it:lint` still resolve the real package.
 */

interface LibrarySetup {
    setup: (project: TestProject) => Promise<void>;
    teardown: () => Promise<void>;
}

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const STAGE_DIR = join(ROOT, "dist", "build");
const BUILD_FILES = ["main.js", "manifest.json", "styles.css"] as const;

export function stageBuild(): void {
    const missing = BUILD_FILES.filter((f) => !existsSync(join(ROOT, f)));
    if (missing.length > 0) {
        throw new Error(
            `Missing build output at the repo root: ${missing.join(", ")}. ` +
                `Run \`npm run build\` first (the \`it*\` npm scripts do this for you).`,
        );
    }
    mkdirSync(STAGE_DIR, { recursive: true });
    for (const file of BUILD_FILES) {
        const from = join(ROOT, file);
        const to = join(STAGE_DIR, file);
        copyFileSync(from, to);
        const { atime, mtime } = statSync(from);
        utimesSync(to, atime, mtime);
    }
}

const loaded: unknown = await import("obsidian-integration-testing/vitest-global-setup-plugin");
const library = (loaded as { createSetup: () => LibrarySetup }).createSetup();

export async function setup(project: TestProject): Promise<void> {
    stageBuild();
    await library.setup(project);
}

export const teardown = library.teardown;
