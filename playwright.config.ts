import { defineObsidianConfig } from "obsidian-plugin-dev-kit/e2e";

/**
 * One worker, no parallel files, a 60 s test timeout, a trace and a video of the Obsidian window kept for a failed
 * test: the kit's preset. Obsidian opens one window per process, so the specs run one at a time.
 */
export default defineObsidianConfig();
