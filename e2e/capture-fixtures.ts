import { createObsidianTest } from "obsidian-plugin-dev-kit/e2e";

/**
 * The fixtures of the capture specs (pictures and films for the README and the site, `npm run capture`). They use
 * the vault in `e2e/capture-vault`, made for the shots: a few notes and the plugin's data come from the specs. The
 * ordinary e2e specs keep `e2e-vault.pristine` and `fixtures.ts`.
 *
 * The window size is part of the picture, so each kind has its own: a 1200 x 800 desktop window for the stills,
 * 1000 x 640 for the desktop films (2x gives 2000 x 1280, which the 1000 px GIF halves exactly) and the
 * phone films set theirs through `obsidian.mobile()`.
 */

/** `.opdk/demo` holds the raw frames and stills; `opdk demo` publishes them (see `opdk.config.mjs`). */
const COMMON = { seedVault: "e2e/capture-vault" } as const;

export const stills = createObsidianTest({ ...COMMON, window: { width: 1200, height: 800 } });
export const desktopFilms = createObsidianTest({ ...COMMON, window: { width: 1000, height: 640 } });
export const phoneFilms = createObsidianTest({ ...COMMON, window: { width: 390, height: 780 } });
