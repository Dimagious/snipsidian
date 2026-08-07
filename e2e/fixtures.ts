import { test as base, _electron, type ElectronApplication, type Page } from "@playwright/test";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Test fixtures for launching Obsidian against an isolated, fresh
 * copy of the pristine vault. Each test gets:
 *
 *   - `app`: the running ElectronApplication (closed automatically)
 *   - `win`: the first window, ready to drive (workspace mounted,
 *            community plugins loaded, Snipsy active)
 *   - `vaultPath`: the per-test vault directory (under `os.tmpdir()`)
 *
 * The vault is copied from `e2e-vault.pristine/` into a temp
 * directory per test so editor mutations don't leak across specs.
 * The pristine copy is committed into the repo with
 * `community-plugins.json` listing `snipsidian` — that's how the
 * plugin auto-enables on launch without a click-through trust gate.
 */

const ROOT = path.resolve(__dirname, "..");
/** Path to Obsidian's bootstrap asar. Loaded through our project-
 *  local `electron` devDependency so Playwright can attach via
 *  DevTools — Obsidian's shipped binary has the
 *  `EnableNodeCliInspectArguments` fuse disabled since 2024 and
 *  rejects the attachment. */
const OBSIDIAN_APP_ASAR = "/Applications/Obsidian.app/Contents/Resources/app.asar";
const PRISTINE_VAULT = path.join(ROOT, "e2e-vault.pristine");

// Playwright's `_electron.launch()` with no `executablePath` uses
// the local `electron` devDependency (node_modules/.bin/electron).

interface SnipsyFixtures {
    app: ElectronApplication;
    win: Page;
    vaultPath: string;
}

/** Recursively copy a directory tree. Resolves symlinks so the test
 *  vault gets actual copies of the plugin build, not symlinks back
 *  to the repo (which would let test mutations contaminate it). */
function copyTreeResolveLinks(src: string, dst: string): void {
    fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const s = path.join(src, entry.name);
        const d = path.join(dst, entry.name);
        // Use lstat to detect symlinks; copy through them so the
        // vault is fully self-contained.
        const stat = fs.lstatSync(s);
        if (stat.isSymbolicLink()) {
            const realSrc = fs.realpathSync(s);
            const realStat = fs.statSync(realSrc);
            if (realStat.isDirectory()) {
                copyTreeResolveLinks(realSrc, d);
            } else {
                fs.copyFileSync(realSrc, d);
            }
        } else if (stat.isDirectory()) {
            copyTreeResolveLinks(s, d);
        } else {
            fs.copyFileSync(s, d);
        }
    }
}

/** Verify the prereqs (unpacked Obsidian + pristine vault) are in
 *  place. If not, fail fast with a useful message rather than
 *  blowing up deep inside Playwright's Electron launch. */
function assertSetup(): void {
    if (!fs.existsSync(OBSIDIAN_APP_ASAR)) {
        throw new Error(
            `Obsidian is not installed at /Applications/Obsidian.app.\n` +
                `Install it first; the fixture loads it via our local Electron.`,
        );
    }
    if (!fs.existsSync(PRISTINE_VAULT)) {
        throw new Error(`Pristine vault missing at ${PRISTINE_VAULT}`);
    }
    if (!fs.existsSync(path.join(PRISTINE_VAULT, ".obsidian", "plugins", "snipsidian", "main.js"))) {
        throw new Error(
            `Plugin not linked into pristine vault. Run \`./scripts/e2e-setup.sh\` to symlink ` +
                `the build into e2e-vault.pristine/.obsidian/plugins/snipsidian/`,
        );
    }
}

export const test = base.extend<SnipsyFixtures>({
    vaultPath: async ({}, use, testInfo) => {
        assertSetup();
        // Per-test vault under the OS temp dir. Suffix with the test
        // title so failure traces are easy to correlate.
        const safeTitle = testInfo.title.replace(/[^a-z0-9]+/gi, "-").slice(0, 40);
        const vaultPath = fs.mkdtempSync(
            path.join(os.tmpdir(), `snipsy-e2e-${safeTitle}-`),
        );
        copyTreeResolveLinks(PRISTINE_VAULT, vaultPath);
        await use(vaultPath);
        // Best-effort cleanup. Don't throw if the OS still has a
        // handle on the dir (Obsidian sometimes holds the cache lock).
        try {
            fs.rmSync(vaultPath, { recursive: true, force: true });
        } catch {
            // ignore
        }
    },

    app: async ({ vaultPath }, use) => {
        // `ELECTRON_RUN_AS_NODE=1` in the parent env forces our local
        // electron binary to run as plain Node, which rejects
        // Chromium-process flags like `--remote-debugging-port=0`
        // that Playwright passes for DevTools attachment. Strip it
        // from the spawn env so the child process starts as a real
        // Electron app even if the user's shell exported it.
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;

        // Pre-register the test vault in Obsidian's vault registry.
        // Without this, Obsidian opens the vault-picker UI on
        // startup (no workspace visible, all selectors miss). We
        // give Electron a fresh `--user-data-dir` per test and seed
        // it with an `obsidian.json` listing the test vault as the
        // currently-open one. The hash key is arbitrary — Obsidian
        // just uses it as a stable handle for the vault entry.
        const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "snipsy-e2e-userdata-"));
        const vaultRegistry = {
            vaults: {
                "e2e-test-vault": {
                    path: vaultPath,
                    ts: Date.now(),
                    open: true,
                },
            },
        };
        fs.writeFileSync(
            path.join(userDataDir, "obsidian.json"),
            JSON.stringify(vaultRegistry),
        );

        // Opt-in video recording. Set SNIPSY_DEMO_VIDEO_DIR=<absolute
        // path> to capture the Obsidian window at 1280×720 via
        // Playwright's Chromium pipeline. Bypasses the macOS Screen
        // Recording permission that screencapture / ffmpeg
        // avfoundation require — perfect for the README demo. Off by
        // default so regular E2E runs aren't slowed down by video
        // encoding.
        const recordVideoDir = process.env.SNIPSY_DEMO_VIDEO_DIR;
        const recordVideo = recordVideoDir
            ? { recordVideo: { dir: recordVideoDir, size: { width: 1280, height: 720 } } }
            : {};

        const app = await _electron.launch({
            args: [OBSIDIAN_APP_ASAR, `--user-data-dir=${userDataDir}`],
            env,
            timeout: 45_000,
            ...recordVideo,
        });
        await use(app);
        // Force-close with a hard timeout. Obsidian sometimes
        // refuses to exit cleanly (workspace-save prompt or some
        // internal listener that prevents `before-quit`) and
        // `app.close()` then never resolves. Race it against a
        // short timeout + escalate to killing the underlying
        // process — leaving zombies between tests slows the suite
        // and confuses Electron's port allocator.
        await Promise.race([
            app.close().catch(() => undefined),
            new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
        ]);
        try {
            const proc = app.process();
            if (!proc.killed) proc.kill("SIGKILL");
        } catch {
            // process already gone — fine
        }
        try {
            fs.rmSync(userDataDir, { recursive: true, force: true });
        } catch {
            // ignore
        }
    },

    win: async ({ app }, use) => {
        const win = await app.firstWindow();

        // Auto-dismiss any native JS dialogs (alert/confirm/prompt).
        // Obsidian rarely uses these, but the playwright-electron
        // teardown sometimes synthesises a dialog-handle call that
        // hangs without a handler. Registering one defensively
        // makes the close path resilient.
        win.on("dialog", (dialog) => {
            dialog.dismiss().catch(() => undefined);
        });

        // First-launch "Trust author" gate. Each test starts from a
        // freshly-copied pristine vault, so Obsidian treats it as
        // new and shows the dialog every time.
        //
        // Both buttons on that dialog ("Trust author and enable
        // plugins" / "Browse vault in Restricted Mode") have a side
        // effect of auto-opening Settings → Community plugins
        // afterwards, and closing that Settings modal in tests is
        // fragile. So instead of clicking either button, we:
        //   1. Dismiss the trust dialog via Escape (no state change)
        //   2. Enable community plugins programmatically via
        //      `app.plugins.setEnable(true)` — the same API the
        //      button calls under the hood, without the open-Settings
        //      side effect.
        //
        // After this the workspace is clean and the editor is ready
        // for tests to interact with.
        try {
            const trustButton = win.getByRole("button", {
                name: "Trust author and enable plugins",
            });
            await trustButton.waitFor({ state: "visible", timeout: 5_000 });
            // Press Escape to close the dialog without enabling
            // plugins. The trust modal is focused on open, so
            // keyboard Escape reliably dismisses it.
            await win.keyboard.press("Escape");
        } catch {
            // No trust dialog — vault was already trusted on this
            // Electron instance.
        }

        // Enable community plugins programmatically. This is what
        // the "Trust author and enable plugins" button does
        // internally (verified by reading Obsidian's unpacked
        // app.js), minus the auto-opening of Settings.
        await win
            .evaluate(async () => {
                const a = (globalThis as unknown as {
                    app?: { plugins?: { setEnable?: (b: boolean) => Promise<void> } };
                }).app;
                await a?.plugins?.setEnable?.(true);
            })
            .catch(() => undefined);

        // Wait briefly for plugin loading to settle. setEnable
        // returns once the global flag is set, but individual
        // plugin onload()s run asynchronously.
        await win.waitForTimeout(800);

        // Wait until an editor leaf is mounted with our Welcome.md
        // open. The pristine vault's workspace.json seeds this state
        // so tests don't have to manually open a note first.
        await win.waitForSelector(".cm-content[contenteditable=true]", {
            timeout: 30_000,
        });

        // Give Snipsy's onload() a moment to finish wiring up its
        // command + settings tab + cm6 bridge. Without this, the
        // very first keystroke test can race the plugin's init.
        await win.waitForTimeout(500);

        await use(win);
    },
});

export { expect } from "@playwright/test";

/**
 * Page-object helpers. Kept here rather than in a separate module so
 * tests get one import and the page-object surface stays in sync
 * with the fixtures.
 */
export const ui = {
    /** Open the command palette via Cmd+P. Returns the palette input. */
    async openCommandPalette(win: Page) {
        await win.keyboard.press("Meta+P");
        const input = win.locator(".prompt-input").first();
        await input.waitFor({ state: "visible" });
        return input;
    },

    /** Run a command by name through the command palette. */
    async runCommand(win: Page, command: string) {
        const input = await this.openCommandPalette(win);
        await input.fill(command);
        await win.keyboard.press("Enter");
    },

    /** Locator for the active CodeMirror editor's contenteditable.
     *  Falls back to a `.cm-content` selector when the leaf class
     *  isn't yet `mod-active` (Obsidian briefly drops the class while
     *  modals are open). */
    activeEditor(win: Page) {
        return win.locator(".cm-content[contenteditable=true]").first();
    },

    /** Clear the active editor — select all and delete. Used between
     *  tests when the pristine vault opened with seed content in
     *  Welcome.md. */
    async clearEditor(win: Page) {
        const editor = this.activeEditor(win);
        await editor.click();
        await win.keyboard.press("Meta+A");
        await win.keyboard.press("Delete");
    },

    /** Type a string into the active editor, character by character,
     *  so per-keystroke listeners (Snipsy's hotstring expander) fire.
     *  `fill()` synthesises a single mutation and won't trigger
     *  expansion — Playwright's codegen records `fill()` by default,
     *  always rewrite to `pressSequentially` for any spec that
     *  asserts on expansion.
     *
     *  Only clicks to focus when the editor doesn't already hold
     *  focus. Re-clicking on every call would reset the cursor to
     *  the click location, which corrupts multi-step scenarios
     *  (e.g. `typeInEditor("h1 ")` then `typeInEditor("Hello")` —
     *  if we re-click between, the second `Hello` lands at the line
     *  start, not at the `$|` cursor position the engine just set). */
    async typeInEditor(win: Page, text: string) {
        const editor = this.activeEditor(win);
        const hasFocus = await editor.evaluate(
            (el) => el.contains(activeDocument.activeElement),
        );
        if (!hasFocus) await editor.click();
        await editor.pressSequentially(text, { delay: 15 });
    },

    /** Read the current contents of the active editor as a string.
     *  Goes through Obsidian's `app.workspace.activeEditor.editor.getValue()`
     *  rather than `innerText()` on `.cm-content` — CodeMirror 6
     *  virtualises line rendering, so `innerText` only returns lines
     *  in the current viewport. For multi-line snippets (callouts,
     *  frontmatter, code blocks) `innerText` silently truncates and
     *  assertions miss content that's actually there. */
    async editorText(win: Page): Promise<string> {
        return (
            (await win.evaluate(() => {
                const a = (globalThis as unknown as {
                    app?: {
                        workspace?: {
                            activeEditor?: { editor?: { getValue?: () => string } } | null;
                        };
                    };
                }).app;
                return a?.workspace?.activeEditor?.editor?.getValue?.() ?? null;
            })) ?? ""
        );
    },
};
