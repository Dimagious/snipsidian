import { requireApiVersion, SettingPage } from "obsidian";
import type { SettingDefinitionPage } from "obsidian";
import type SnipSidianPlugin from "../../main";
import type { SnippetsTab } from "./SnippetsTab";
import type { CommunityTab } from "./CommunityTab";
import { formatSnippetsSummary } from "../../store/snippets";
import { countInstalledPackages, formatInstalledPackagesSummary } from "../../core/install-plan";

export interface DeclarativePages {
    snippets: SettingDefinitionPage;
    packages: SettingDefinitionPage;
}

/**
 * Builds the "Snippets" and "Packages" `SettingDefinitionPage` entries
 * for the 1.13+ declarative tree (B-151/ADR-0007, option A). Returns
 * `null` below 1.13 — `SettingPage` doesn't exist as a usable base
 * class there, and `SnipSidianSettingTab.getSettingDefinitions()`
 * falls back to `[]` in that case anyway (`display()` renders the tab
 * strip instead).
 *
 * The `SnippetsPage`/`PackagesPage` classes are declared INSIDE the
 * `if (requireApiVersion("1.13.0"))` block on purpose: the spike found
 * `eslint-plugin-obsidianmd`'s `no-unsupported-api` rule (error,
 * type-checked) flags `class X extends SettingPage` and every
 * `this.containerEl` access on such a subclass at `minAppVersion`
 * 1.5.0 — UNLESS the class is declared inside the positive branch of
 * exactly this guard shape. An early-return guard
 * (`if (!requireApiVersion(...)) return null;` followed by the class
 * at module scope) is NOT recognised by the rule and still errors —
 * confirmed against `eslint-plugin-obsidianmd@0.4.2` in the spike
 * (`.claude/brain/reports/2026-09-29-spike-0007-declarative-settings.md`,
 * Q6). Moving the classes inside the `if` also means they don't need
 * their own constructor — they close over this function's `plugin`/
 * `snippetsTab`/`communityTab` params instead of receiving them via
 * `SettingPage`'s no-arg constructor.
 *
 * Each page reuses the SAME `snippetsTab`/`communityTab` instance the
 * tab strip (`SettingsTab.display()`, < 1.13) uses — not a fresh one
 * per open — so in-memory UI state (search filter, selection mode,
 * group-open map, all owned by `SnippetsTab`'s `UIStateManager`)
 * survives closing and reopening the page, even though the
 * `SettingPage` instance itself is discarded and rebuilt by the
 * framework on every open (spike, Q1: "the factory is called on every
 * open and builds a fresh instance... page state is not kept").
 *
 * `hide()` is overridden on both pages for documentation and test
 * coverage even though today neither has anything to actually clean
 * up: `SnippetsTab`/`CommunityTab` register no timers or listeners
 * outside `containerEl`'s own subtree (removed with it), and their UI
 * state is deliberately kept alive across a close/reopen — that's the
 * "restore state" half of the requirement above.
 */
export function createDeclarativePages(
    plugin: SnipSidianPlugin,
    snippetsTab: SnippetsTab,
    communityTab: CommunityTab,
): DeclarativePages | null {
    if (requireApiVersion("1.13.0")) {
        class SnippetsPage extends SettingPage {
            display(): void {
                this.containerEl.addClass("snipsidian-settings");
                snippetsTab.render(this.containerEl);
            }
            hide(): void {
                // Intentionally empty — see the module doc above.
            }
        }

        class PackagesPage extends SettingPage {
            display(): void {
                this.containerEl.addClass("snipsidian-settings");
                void communityTab.render(this.containerEl);
            }
            hide(): void {
                // Intentionally empty — see the module doc above.
            }
        }

        return {
            snippets: {
                type: "page",
                name: "Snippets",
                desc: "Add, edit, and organise your snippet library.",
                // Finding #6: correct singular/plural at every
                // boundary (0/1/N snippets, 0/1/N groups), no "in 0
                // groups" claim, and a "(K muted)" hint — see
                // `formatSnippetsSummary` (store/snippets.ts).
                displayValue: () => formatSnippetsSummary(plugin.settings),
                page: () => new SnippetsPage(),
            },
            packages: {
                type: "page",
                name: "Packages",
                desc: "Browse and install community snippet packages, or import from Espanso.",
                // Finding #6: the page is named "Packages", so the
                // wording says "packages", not "packs" — see
                // `formatInstalledPackagesSummary` (core/install-plan.ts).
                displayValue: () => formatInstalledPackagesSummary(countInstalledPackages(plugin.settings)),
                page: () => new PackagesPage(),
            },
        };
    }
    return null;
}
