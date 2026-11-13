import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { normalizeTrigger } from "../src/engine/triggers";
import { defaultSnippetsAsGroup } from "../src/store/presets";
import type { PackageItem } from "../src/services/community-packages";
import type { SnipSidianSettings } from "../src/types";

/**
 * What the capture specs seed into the plugin's `data.json`, and the one day every picture is taken on.
 *
 * Pure data and file reads: nothing here starts Obsidian, so the shapes can be checked without it.
 */

/** The day of every picture and film. `new Date()`, `Date.now()` and `moment()` in the window report this day, so a
 *  retake on another date changes only what the code changed. A string without a zone is read in the machine's zone
 *  and shown in it, so the same run gives the same text everywhere (`$date` types 2026-11-05, `$time` 14:05). */
export const CAPTURE_NOW = "2026-11-05T14:05:00";

/** `data.json` of the plugin inside the seed vault. A seed file replaces the one the vault ships. */
export const DATA_PATH = ".obsidian/plugins/snipsidian/data.json";

const CATALOG_DIR = path.resolve("src", "services", "__fixtures__", "catalog");

interface PackageFile {
    name?: string;
    description?: string;
    author?: string;
    version?: string;
    tags?: string[];
    snippets?: Array<{ trigger?: string; replace?: string }>;
}

/**
 * The community catalog as the plugin's own loader would have cached it: one `PackageItem` per approved pack, in the
 * order of their names. The files are the repo's copy of the approved packs (`src/services/__fixtures__/catalog`), so
 * the Packages page of a picture lists what a user sees, and no request goes out. Same conversion as
 * `fetchAndParsePack` (trigger normalised, `verified`, no downloads).
 */
export function catalogPackages(): PackageItem[] {
    const items: PackageItem[] = [];
    for (const file of fs.readdirSync(CATALOG_DIR).filter((name) => /\.ya?ml$/.test(name)).sort()) {
        const data = parseYaml(fs.readFileSync(path.join(CATALOG_DIR, file), "utf8")) as PackageFile;
        if (!data.name || !Array.isArray(data.snippets)) throw new Error(`capture: ${file} is not a package`);
        const snippets: Record<string, string> = {};
        for (const snippet of data.snippets) {
            const key = normalizeTrigger(snippet.trigger ?? "");
            if (key && snippet.replace) snippets[key] = snippet.replace;
        }
        items.push({
            id: file.replace(/\.ya?ml$/, ""),
            label: data.name,
            description: data.description,
            author: data.author,
            version: data.version,
            downloads: 0,
            tags: data.tags ?? [],
            verified: true,
            rating: 0,
            snippets,
        });
    }
    return items.sort((a, b) => a.label.localeCompare(b.label));
}

/** The cached catalog, valid at any clock: its stamp is the moment the spec was loaded, and the cache counts as fresh
 *  while less than a day has passed since it, a negative span (the frozen clock is earlier) included. So the Packages
 *  page never asks the network. */
export function catalogCache(): NonNullable<SnipSidianSettings["communityPackages"]> {
    return { cache: { packages: catalogPackages(), lastUpdated: Date.now() } };
}

/** `data.json` as text, for `test.use({ seed: { files: { [DATA_PATH]: ... } } })`. */
export function dataJson(settings: SnipSidianSettings): string {
    return JSON.stringify(settings, null, 2);
}

/** Snippets of a group, keyed the way the store keys them (`<group>/<trigger>`). */
function group(name: string, snippets: Record<string, string>): Record<string, string> {
    return Object.fromEntries(Object.entries(snippets).map(([trigger, text]) => [`${name}/${trigger}`, text]));
}

/** The library of the site pictures: the shipped defaults, a few groups of someone's own and the one installed pack.
 *  `Callouts` is muted, as the group screenshot shows. The groups are in the order the Insert snippet picture lists
 *  them (the picker keeps the store's order). */
export function libraryForStills(): SnipSidianSettings {
    return {
        snippets: {
            ...defaultSnippetsAsGroup(),
            ...group("journal", {
                dj: "## $date\n**Mood:** $|\n**Grateful for:** ",
                gm: "Good morning! Today is $date.",
                win: "**Win:** $|",
            }),
            ...group("meetings", {
                mtg: "## Meeting: $|\n**Date:** $date\n**Attendees:** ",
                "1on1": "## 1:1 $date\n- Wins: $|\n- Blockers:\n- Next:",
                ai: "- [ ] **Action:** $| (owner: , due: )",
                dec: "> [!success] Decision\n> $|",
            }),
            ...group("work", {
                eod: "EOD update: $|",
                standup: "**Done:** $|\n**Next:** \n**Blockers:** ",
                pr: "## What changed\n$|\n\n## How to test\n",
            }),
            ...group("Daily Journal", { grtd: "Grateful for: $|" }),
            ...group("callouts", {
                quote: "> [!quote]\n> $|",
                tip: "> [!tip]\n> $|",
                warn: "> [!warning]\n> $|",
            }),
        },
        disabledGroups: ["callouts"],
        communityPackages: catalogCache(),
    };
}

/** The shipped defaults only, as on a first install. The films that type a trigger and read the result use it. */
export function libraryOfDefaults(): SnipSidianSettings {
    return { snippets: defaultSnippetsAsGroup(), communityPackages: catalogCache() };
}

/** The library of the Insert snippet film: the defaults and a Meetings group whose names all match the query "meet". */
export function libraryForPickerFilm(): SnipSidianSettings {
    return {
        snippets: {
            ...defaultSnippetsAsGroup(),
            ...group("meetings", {
                meeting: "# Meeting $date\n\n**Attendees:** $|\n\n**Notes:**\n- ",
                standup: "## Standup $date\n- Done: $|\n- Next:\n- Blocked:",
                retro: "## Retro $date\n**Went well:** $|\n**To change:** ",
            }),
            ...group("journal", {
                dj: "## $date\n**Mood:** $|",
                gm: "Good morning! Today is $date.",
            }),
        },
        communityPackages: catalogCache(),
    };
}

/** The other plugin's `data.json` for the import film: four records in its own format (`trigger : text`, `$nl$` for a
 *  line break). Not Snipsy's file: it goes to `.obsidian/plugins/text-snippets-obsidian/data.json`. */
export const TEXT_SNIPPETS_PATH = ".obsidian/plugins/text-snippets-obsidian/data.json";
export function textSnippetsData(): string {
    const records = ["sig : Best,$nl$Dmitriy", "addr : 12 Example Street$nl$Springfield", "lgtm : Looks good to me", "fyi : For your information"];
    return JSON.stringify({ snippets_file: records.join("\n") });
}

/** The dark theme, written to the vault's `appearance.json` before Obsidian starts. A window that falls back to the
 *  system theme when it takes focus then falls back to this one (seen with the machine's own user at the keyboard). */
export const APPEARANCE_PATH = ".obsidian/appearance.json";
export const appearanceFile = (mode: "light" | "dark"): string => JSON.stringify({ theme: mode === "dark" ? "obsidian" : "moonstone" });
