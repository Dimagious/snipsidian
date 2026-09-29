import type { Locator, Page } from "@playwright/test";

/**
 * Demo recording overlays + cinematic helpers.
 *
 * Adapted from the `ui-demo` skill (everything-claude-code) for the
 * Electron/Obsidian target:
 *
 *   - `injectCursor` — SVG arrow that tracks mousemove so cursor
 *     motion is visible in the screen capture (Electron's native
 *     cursor often doesn't render through screen recording reliably
 *     on macOS).
 *   - `injectSubtitleBar` — bottom-aligned subtitle bar for in-shot
 *     captions, separate from any audio track we add later.
 *   - `showSubtitle` / `hideSubtitle` — toggle the bar between shots.
 *   - `moveAndClick` — humanised click: hover with `steps`, brief
 *     pause, then click. Never teleport.
 *   - `typeSlowly` — character-by-character typing with a delay so
 *     viewers can read the trigger before it expands.
 *
 * All overlays are scoped to `document.body` via fixed positioning
 * with z-index 999_999, so Obsidian modals (z-index ~1000) sit below
 * them — subtitles stay visible across modal/picker transitions.
 *
 * Re-inject overlays after every navigation; some Obsidian flows
 * (Settings open/close) re-mount the workspace container and would
 * otherwise erase the overlay nodes.
 */

const CURSOR_ID = "snipsy-demo-cursor";
const SUBTITLE_ID = "snipsy-demo-subtitle";

/** Inject (or re-inject) the SVG cursor overlay. Idempotent. */
export async function injectCursor(page: Page): Promise<void> {
    await page.evaluate((id) => {
        const existing = document.getElementById(id);
        if (existing) return;
        const cursor = document.createElement("div");
        cursor.id = id;
        cursor.innerHTML =
            '<svg width="22" height="22" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">' +
            '<path d="M5 3L19 12L12 13L9 20L5 3Z" fill="#ffffff" stroke="#1a1a1a" stroke-width="1.4" stroke-linejoin="round"/>' +
            "</svg>";
        cursor.style.cssText = [
            "position: fixed",
            "left: 0",
            "top: 0",
            "z-index: 999999",
            "pointer-events: none",
            "width: 22px",
            "height: 22px",
            "transition: transform 0.08s linear",
            "filter: drop-shadow(1px 1px 2px rgba(0,0,0,0.35))",
            "transform: translate(-9999px, -9999px)",
        ].join(";");
        document.body.appendChild(cursor);
        document.addEventListener(
            "mousemove",
            (e) => {
                cursor.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
            },
            { passive: true },
        );
    }, CURSOR_ID);
}

/** Inject (or re-inject) the subtitle bar. Hidden initially. */
export async function injectSubtitleBar(page: Page): Promise<void> {
    await page.evaluate((id) => {
        const existing = document.getElementById(id);
        if (existing) return;
        const bar = document.createElement("div");
        bar.id = id;
        bar.style.cssText = [
            "position: fixed",
            "left: 50%",
            "bottom: 36px",
            "transform: translateX(-50%)",
            "z-index: 999998",
            "max-width: min(720px, 80vw)",
            "padding: 10px 22px",
            "background: rgba(15, 15, 18, 0.82)",
            "color: #ffffff",
            "font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif",
            "font-size: 17px",
            "font-weight: 500",
            "letter-spacing: 0.2px",
            "line-height: 1.4",
            "border-radius: 10px",
            "text-align: center",
            "opacity: 0",
            "transition: opacity 0.25s ease",
            "pointer-events: none",
            "backdrop-filter: blur(4px)",
            "-webkit-backdrop-filter: blur(4px)",
        ].join(";");
        bar.textContent = "";
        document.body.appendChild(bar);
    }, SUBTITLE_ID);
}

/** Inject both overlays. Use after any navigation that might tear
 *  the previous instances down. */
export async function injectOverlays(page: Page): Promise<void> {
    await injectSubtitleBar(page);
    await injectCursor(page);
}

/** Show a subtitle. Pass an empty string (or call `hideSubtitle`) to
 *  fade it out without removing the bar. */
export async function showSubtitle(page: Page, text: string): Promise<void> {
    await page.evaluate(
        ({ id, t }) => {
            const bar = document.getElementById(id);
            if (!bar) return;
            bar.textContent = t;
            bar.style.opacity = t ? "1" : "0";
        },
        { id: SUBTITLE_ID, t: text },
    );
    // Give the fade-in a chance to render before the next action.
    if (text) await page.waitForTimeout(250);
}

export async function hideSubtitle(page: Page): Promise<void> {
    await showSubtitle(page, "");
}

/** Humanised mouse move + click. `steps` controls how many
 *  interpolated samples the synthetic mousemove emits — higher means
 *  smoother visible motion. */
export interface MoveClickOptions {
    /** Pause (ms) AFTER the click resolves. Default 600. */
    postClickDelay?: number;
    /** Mouse move steps. Default 14. */
    steps?: number;
    /** Whether the helper logs in rehearsal mode. Default true. */
    log?: boolean;
}

export async function moveAndClick(
    page: Page,
    target: Locator | string,
    label: string,
    opts: MoveClickOptions = {},
): Promise<boolean> {
    const { postClickDelay = 600, steps = 14, log = true } = opts;
    const locator = typeof target === "string" ? page.locator(target).first() : target;

    const visible = await locator.isVisible().catch(() => false);
    if (!visible) {
        if (log)
            // eslint-disable-next-line no-console
            console.warn(`[demo] moveAndClick MISS: "${label}" not visible`);
        return false;
    }

    await locator.scrollIntoViewIfNeeded().catch(() => undefined);
    await page.waitForTimeout(150);

    const box = await locator.boundingBox();
    if (box) {
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        await page.mouse.move(cx, cy, { steps });
        await page.waitForTimeout(280);
    }

    await locator.click();
    await page.waitForTimeout(postClickDelay);
    return true;
}

/** Type into a field/editor character-by-character. */
export async function typeSlowly(
    page: Page,
    target: Locator | string,
    text: string,
    label: string,
    charDelay = 38,
): Promise<boolean> {
    const locator = typeof target === "string" ? page.locator(target).first() : target;
    const visible = await locator.isVisible().catch(() => false);
    if (!visible) {
        // eslint-disable-next-line no-console
        console.warn(`[demo] typeSlowly MISS: "${label}" not visible`);
        return false;
    }
    await moveAndClick(page, locator, label, { postClickDelay: 250, log: false });
    await locator.pressSequentially(text, { delay: charDelay });
    await page.waitForTimeout(350);
    return true;
}

/** Wait a beat between scenes so the cut feels intentional, not
 *  rushed. Centralised so we can rebalance pacing in one place. */
export async function beat(page: Page, ms = 700): Promise<void> {
    await page.waitForTimeout(ms);
}

/** Rehearsal helper: log + return whether a selector resolves. */
export async function ensureVisible(
    page: Page,
    target: Locator | string,
    label: string,
): Promise<boolean> {
    const locator = typeof target === "string" ? page.locator(target).first() : target;
    const visible = await locator.isVisible().catch(() => false);
    // eslint-disable-next-line no-console
    console.log(
        visible ? `[rehearse] OK   ${label}` : `[rehearse] MISS ${label}`,
    );
    return visible;
}
