import type { SnipSidianSettings } from "../types";

/**
 * B-255: manual expansion mode. Two independent switches under
 * `settings.expansion`; the defaults keep every existing install exactly as it
 * was (typing expands, Tab does not).
 */

/** Does typing a separator after a trigger expand it? Unset = yes. */
export function expandsOnType(settings: Pick<SnipSidianSettings, "expansion">): boolean {
    return settings.expansion?.onType !== false;
}

/** Does Tab expand the trigger before the caret? Unset = no. */
export function expandsOnTab(settings: Pick<SnipSidianSettings, "expansion">): boolean {
    return settings.expansion?.onTab === true;
}
