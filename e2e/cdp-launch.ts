import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import * as net from "node:net";
import { filterObsidianPages } from "./obsidian-windows";

/**
 * B-220: launch the real Obsidian binary with `--remote-debugging-port` and
 * attach through `chromium.connectOverCDP`, instead of `_electron.launch`
 * over our local `electron` devDependency.
 *
 * The 2024 Electron fuse only disables `--inspect` (Node), not the Chromium
 * switch, so any installed or downloaded Obsidian binary can be driven.
 *
 * What this mode cannot do compared with `_electron` (hence opt-in):
 *   - no main-process access (`app.evaluate`: clipboard, BrowserWindow
 *     bounds, zoom), which the media/demo specs rely on;
 *   - no `recordVideo`, `connectOverCDP` does not support it.
 */

/** A launched Obsidian: the child process plus the CDP connection. */
export interface CdpSession {
    browser: Browser;
    context: BrowserContext;
    child: ChildProcess;
    port: number;
    /** Stops tracing (keeping it when `keepTrace` is a path), disconnects,
     *  kills the process. Safe to call more than once. */
    shutdown(keepTracePath?: string): Promise<void>;
}

export interface CdpLaunchOptions {
    binaryPath: string;
    userDataDir: string;
    env: NodeJS.ProcessEnv;
    /** Total budget for the debugging endpoint to come up. */
    readyTimeoutMs?: number;
}

/** Children we spawned and have not reaped yet. A last-resort `exit` hook
 *  kills them so a crashed test runner never leaves an Obsidian behind. */
const liveChildren = new Set<ChildProcess>();
process.once("exit", () => {
    for (const child of liveChildren) {
        signalTree(child, "SIGKILL");
    }
});

/** On POSIX the child is spawned `detached` (its own process group), so a
 *  negative pid reaches Chromium's helper processes (renderer/GPU/network),
 *  which have their own PIDs. Falls back to the single process. */
function signalTree(child: ChildProcess, signal: NodeJS.Signals): void {
    if (process.platform !== "win32" && child.pid !== undefined) {
        try {
            process.kill(-child.pid, signal);
            return;
        } catch {
            // group already gone (ESRCH) or not signalable: try the process
        }
    }
    try {
        child.kill(signal);
    } catch {
        // already gone
    }
}

/** Asks the OS for a free TCP port. There is an unavoidable window between
 *  closing this probe and Obsidian binding the port; a collision surfaces as
 *  the readiness timeout below, which names the port. */
export function getFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.unref();
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            if (address === null || typeof address === "string") {
                server.close();
                reject(new Error("could not determine a free port"));
                return;
            }
            server.close(() => resolve(address.port));
        });
    });
}

/** Polls `/json/version` until Chromium answers, the child dies, or the
 *  budget runs out. Each failure mode produces its own message. */
async function waitForDebugger(
    port: number,
    child: ChildProcess,
    stderrTail: () => string,
    timeoutMs: number,
): Promise<void> {
    const url = `http://127.0.0.1:${port}/json/version`;
    const deadline = Date.now() + timeoutMs;
    let lastError = "no response yet";
    while (Date.now() < deadline) {
        if (child.exitCode !== null || child.signalCode !== null) {
            throw new Error(
                `Obsidian exited before the debugging endpoint came up ` +
                    `(code=${String(child.exitCode)}, signal=${String(child.signalCode)}). ` +
                    `Last stderr:\n${stderrTail()}`,
            );
        }
        try {
            const res = await fetch(url, { signal: AbortSignal.timeout(1_000) });
            if (res.ok) return;
            lastError = `HTTP ${res.status}`;
        } catch (err) {
            lastError = err instanceof Error ? err.message : String(err);
        }
        await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(
        `Timed out after ${timeoutMs}ms waiting for ${url} (${lastError}). ` +
            `Obsidian is running but not exposing --remote-debugging-port=${port}; ` +
            `check that the port is free and the binary is a real Obsidian build.\n` +
            `Last stderr:\n${stderrTail()}`,
    );
}

/** Stops the process tree and resolves only once the main process has
 *  exited (SIGTERM, then SIGKILL after 3s, each wait bounded). A final
 *  SIGKILL to the group sweeps helpers that outlived the main process, so
 *  nothing is still writing into the user-data dir when the caller deletes it. */
async function killAndReap(child: ChildProcess): Promise<void> {
    const alreadyExited = child.exitCode !== null || child.signalCode !== null;
    if (!alreadyExited) {
        const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
        signalTree(child, "SIGTERM");
        const graceful = await Promise.race([
            exited.then(() => true),
            new Promise<boolean>((r) => setTimeout(() => r(false), 3_000)),
        ]);
        if (!graceful) {
            signalTree(child, "SIGKILL");
            await Promise.race([exited, new Promise<void>((r) => setTimeout(r, 3_000))]);
        }
    }
    // Helpers may outlive the main process; reap the group (ESRCH is fine).
    signalTree(child, "SIGKILL");
    liveChildren.delete(child);
}

export async function launchObsidianCdp(opts: CdpLaunchOptions): Promise<CdpSession> {
    const port = await getFreePort();
    const child = spawn(
        opts.binaryPath,
        [`--remote-debugging-port=${port}`, `--user-data-dir=${opts.userDataDir}`],
        {
            env: opts.env,
            stdio: ["ignore", "ignore", "pipe"],
            // Own process group on POSIX so shutdown can signal the helpers too.
            detached: process.platform !== "win32",
        },
    );
    liveChildren.add(child);

    // Keep a bounded tail of stderr: it is the only diagnostic when the
    // process dies or never opens the port.
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
        stderr = (stderr + chunk.toString("utf8")).slice(-4_000);
    });
    const spawnFailed = new Promise<never>((_, reject) => {
        child.once("error", (err) =>
            reject(new Error(`could not start ${opts.binaryPath}: ${err.message}`)),
        );
    });
    // Once the race below has settled, a late `error` event would reject this
    // promise with nobody listening (unhandled rejection). Mark it handled.
    void spawnFailed.catch(() => undefined);

    let browser: Browser | undefined;
    let context: BrowserContext | undefined;
    let tracing = false;
    let closed = false;

    const shutdown = async (keepTracePath?: string): Promise<void> => {
        if (closed) return;
        closed = true;
        if (context && tracing) {
            await context.tracing
                .stop(keepTracePath ? { path: keepTracePath } : undefined)
                .catch(() => undefined);
        }
        // `Browser.close()` on a CDP connection only drops the socket; the
        // process is ours to stop.
        await browser?.close().catch(() => undefined);
        await killAndReap(child);
    };

    try {
        await Promise.race([
            waitForDebugger(port, child, () => stderr, opts.readyTimeoutMs ?? 45_000),
            spawnFailed,
        ]);
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
        const [defaultContext] = browser.contexts();
        if (!defaultContext) throw new Error("connected over CDP but found no browser context");
        context = defaultContext;
        try {
            await context.tracing.start({ screenshots: true, snapshots: true });
            tracing = true;
        } catch (err) {
            // Tracing is a debugging aid, not part of the contract: say so
            // loudly but let the test run.
            console.warn(
                `[e2e/cdp] tracing unavailable on the CDP context, continuing without it: ${
                    err instanceof Error ? err.message : String(err)
                }`,
            );
        }
    } catch (err) {
        // Setup failed part-way: do not leave the process behind.
        await shutdown();
        throw err;
    }

    return { browser, context, child, port, shutdown };
}

/** See `filterObsidianPages` (kept pure in its own module for unit tests). */
export function obsidianWindows(context: BrowserContext): Page[] {
    return filterObsidianPages(context.pages());
}

/** Waits for the main workspace window (`app://obsidian.md/index.html`),
 *  mirroring `ElectronApplication.firstWindow()`. */
export async function waitForMainWindow(context: BrowserContext, timeoutMs = 30_000): Promise<Page> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const main = obsidianWindows(context).find((p) => p.url().includes("obsidian.md/index.html"));
        if (main) return main;
        await new Promise((r) => setTimeout(r, 200));
    }
    const seen = obsidianWindows(context).map((p) => p.url() || "(empty)");
    throw new Error(
        `Obsidian's main window did not appear within ${timeoutMs}ms. Open pages: ${JSON.stringify(seen)}`,
    );
}
