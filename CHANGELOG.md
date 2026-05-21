# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **A11y: assistive-technology coverage of the Settings UI** (B-003 umbrella tail — closes B-084 / B-085 / B-087 / B-088 / B-090). Package-submission validation result now carries a `✓` / `✗` text prefix and `role="status"` / `role="alert"` alongside the existing colour tint, so users on monochrome schemes or with strong colour blindness get the same at-a-glance signal as everyone else. Three previously-unlabelled hand-built inputs (`JSONModal` textarea, `GroupPickerModal` new-group input, `EspansoSection` YAML paste) get explicit `aria-label`s; screen readers stop announcing them as "edit, blank". Five modals (`JSONModal`, `PackagePreviewModal`, `GroupPickerModal`, `AddSnippetModal`, the raw-`new Modal` package-details) now `.focus()` their primary input / primary action on open instead of leaving focus on the modal title. The bulk-bar count, the package-filter result count, and the validation-error text in `TextPromptModal` are now wrapped in `aria-live="polite"`; the package-Refresh button toggles `aria-busy="true"` while a reload is in flight. Custom-styled buttons (`.snipsy-tab`, `.snippet-action`) gain explicit `:focus-visible` outlines so keyboard users can see which one currently holds focus.

### Changed

- **Espanso imports now go into a named group** (B-045). Pre-1.1.7 imported triggers landed bare in `settings.snippets` (e.g. `brb → "be right back"`), so after 2-3 imports users couldn't tell what came from where and bulk-uninstall of a previously-imported pack was impossible. Now the Espanso import section asks for a group name (default: "Espanso import" or "Espanso import 2/3/…" if the slug collides), and each trigger lands as `<groupSlug>/<trigger>` — same shape as community packages. **Existing user data is NOT migrated** — keys from prior Espanso imports stay where they were. Users who want a unified group can rename existing snippets in Settings → Snippets.

### UX polish

- **Delete-group confirmation now previews the first 5 trigger names** (B-053). The pre-1.1.7 confirm dialog showed only the count ("Delete group 'foo' with 30 snippet(s)?"); now it lists the first 5 trigger names of the group plus "(and N more)" — same pattern as the 1.1.6 Uninstall pack flow. One UX cadence to learn across destructive operations.
- **Popup-blocked submission no longer fires a misleading success Notice** (B-044). `window.open` doesn't throw when a popup blocker rejects the call — it returns `null`. The submit flow used to celebrate success regardless; now it detects the null, best-effort copies the submission URL to the clipboard, and surfaces an actionable Notice ("Popup blocked — link copied, paste it in your browser").
- **Espanso-import section renamed to honest framing** (B-056 + B-059 + B-060). "Install package from hub" / "Install package" implied Snipsy fetches from the Espanso hub — it doesn't, the user pastes YAML manually. Renamed to "Import from Espanso YAML" / "Import snippets" with help text matching. Conflict-resolution modal title also normalised from Title Case "Espanso Package" to sentence-case "Import from Espanso YAML" to match the rest of the UI.
- **Group rename now shows "Will be saved as: …" preview** (B-051). When the typed name slugifies lossy (e.g. "My Project 2024!" → `my-project-2024` → "My project 2024" — lost the `!`, lost the case), the rename modal now surfaces the reconstructed display name live as the user types. `aria-live="polite"` so AT users hear the preview too.
- **Bulk-selection count no longer flickers on every checkbox toggle** (B-052). `updateBulkBar` used to `empty()` the entire bar and rebuild every time selection changed — visible strobe on the count and event-listener churn on the action buttons. Now the count `<span>` and buttons are built once; count updates via `.setText` in place.
- **"Package format docs" link points at the live catalog** (B-058). The previous wiki URL redirected to the repo home (GitHub wikis are off by default). New link goes to the `community-packages/approved/` directory — real packs as templates.
- **Espanso YAML parsed once on import** (B-061). The collision-path + conflict-modal path + no-conflict path all share the already-parsed `incoming` map now. Drops a redundant `espansoYamlToSnippets()` call on every conflict-resolved import.

### Performance

- **Community-package fetch is parallel now** (B-024 / P-007). The Packages-tab cold-load used to fetch each `.yml` file sequentially — ~12× the latency of a single fetch with the current 12-pack catalog. Switched to `Promise.all` over the per-pack downloads; cold open of Packages drops from a couple of seconds to ~one fetch round trip. Each per-pack fetch still swallows its own errors, so one bad pack doesn't reject the whole batch.
- **`findTrigger` lookback capped at 64 chars** (B-019). Without the cap, pathological inputs — a 50,000-char base64 paste, a long URL on one line, "log everything" files where a single line spans thousands of characters — caused `findTrigger` to walk all of it on every separator keystroke. 64 is well above any legitimate trigger length (current community-pack triggers max out at ~12 chars). Three boundary tests pin the cap. The other perf items (B-067 isInFencedCode caching, B-068 getDict memoise, B-070 picker regex cache) were investigated and deferred — see [ADR-0006](.claude/brain/decisions/0006-perf-hot-path-deferred.md).

### Internal

- **`services/community-packages.ts` split into focused modules** (B-025 — architect's "single biggest refactor"). The 355-line junk drawer becomes three files: `community-api.ts` (GitHub I/O, allowlist defence, YAML→snippet conversion), `community-cache.ts` (24-hour TTL, settings-backed storage, stale-fallback on live-load failure), `community-packages.ts` (now a thin facade — `PackageItem` type, vault-backed `loadDynamicCommunityPackages`, the `loadAllCommunityPackages` router). Each module has its own responsibility and tests stay co-located with the function they cover. `PluginCacheHost` replaces the old `PluginWithApp` shape — narrower contract, clearer intent.
- **Removed unused `createPackageIssue`** + its three tests. The legacy direct-API submission flow had zero production callers since 1.1.0 — the active flow is `services/github-issue-url.ts` opening a prefilled issue in the browser. Dead code carrying its own tests as the only link is the cleanest case for deletion.
- **Snippets-tab add / edit logic lifted into pure `core/snippet-ops.ts`** (B-028 second half — closes the architectural debt the architect review flagged together with `core/install-plan.ts`, which shipped in 1.1.6). `planAddSnippet` and `planEditSnippet` build a `{ ok, data | reason }` plan from current settings + user input; `SnippetsTab.showAddSnippetModal` and `SnippetsTab.saveEdit` reduce to "build plan → apply or surface reason". 18 boundary tests per [ADR-0005](.claude/brain/decisions/0005-test-philosophy.md) — including the prototype-key (`__proto__`) defence lifted up from `safeRenameKey` into the plan layer. 100% coverage on the new file. Delete handlers deliberately left inline — they were three repetitions of `delete map[key] + save + cleanup` with no rule worth pinning at the boundary.

## [1.1.6] - 2026-05-21

Install path correctness. Closes the P0 footgun where the disabled "Already installed" button after a user edit silently overwrote local changes on the next install click; replaces the dead-end with explicit Reinstall and Uninstall affordances. Refactors the install-plan logic out of UI handlers so the fix has a function-boundary test that pins the contract.

### Fixed

- **Install button no longer silently overwrites locally-edited snippets** (B-017). Pre-1.1.6, after installing a community pack and editing 2+ rows, the `≥ 80 %-value-match` heuristic flipped the row's badge from "Installed" back to "Install" — clicking it opened the preview modal (which the user read as "fresh install") and Apply overwrote their edits with upstream values. "Installed" is now defined as **key-presence only**: any pack key in the snippet store keeps the badge stable regardless of value, so user edits don't move the state machine. The Reinstall affordance is the only path back to upstream, and it routes through `PackagePreviewModal` with "Keep current" defaulted on every conflict.
- **Reinstall / Uninstall affordances replace the disabled "Already installed" button** (B-042). The dead-end button had no resync path and no way to remove the pack. The row + Package Details modal now show two explicit actions: **Reinstall** (opens preview modal with current-vs-upstream diff, per-row Keep/Overwrite choices, Keep defaulted) and **Uninstall** (opens a confirmation modal listing the first 5 trigger names that will be removed, plus the full count). Both work for partially-installed and user-edited packs.
- **`PackagePreviewModal` bulk-action buttons stop duplicating the modal** (PR #40). "Keep all current" / "Overwrite all" used a `close(); open();` re-render trick that — in the real Obsidian Modal lifecycle — re-ran `onOpen` without first emptying `contentEl`, appending a duplicate summary + table + footer on every click. Bug pre-dates 1.1.6 but was hidden behind the disabled "Installed" state until Reinstall surfaced the modal. Selects now update in place via a stored handle.

### Internal

- **`services/utils.ts` demoted** (B-026). Its contents moved to semantic homes: `splitKey`/`joinKey`/`slugifyGroup`/`displayGroupTitle` → `src/store/keys.ts`; `normalizeTrigger`/`isBadTrigger` → `src/engine/triggers.ts`; `diffIncoming`/`DiffResult` → `src/store/diff.ts`. Closes the wrong-way `store → services` import arrow from the 2026-05-14 architect review.
- **`isBadTrigger` regex literals lifted out of the function body** (B-072 folded in with B-026). Runs on the editor-change hot path; same caching now, but at the module-level for clarity.
- **Install-plan logic extracted from `PackageBrowser` into pure `src/core/install-plan.ts`** (B-028 partial). `buildPackageDiff`, `isPackageInstalled`, `listPackageKeys`, `removePackageSnippets` are now pure functions with 22 boundary tests per [ADR-0005](.claude/brain/decisions/0005-test-philosophy.md). 100 % coverage. UI handler reduced to "build plan → confirm → write".
- **Bonus a11y**: replaced the lingering `new Setting(contentEl).setHeading().setName("Conflicts")` styled-div in `PackagePreviewModal` with a real `<h3>Conflicts</h3>`. Last B-091 site outside the 1.1.0 sweep.

## [1.1.5] - 2026-05-19

Polish pass on the Snippet Picker — the most-opened surface in the plugin, which had been shipping without CSS since 1.1.0.

### Fixed

- **Snippet picker now has actual CSS** (B-115). `SnippetPickerModal` (Cmd+P → Insert snippet) had been emitting a dozen layout classes (`.snippet-results`, `.snippet-item`, `.snippet-name`, `.snippet-folder`, `.snippet-preview-text`, `.snippet-preview`, `.snippet-preview-meta`, `.snippet-highlight-cursor`, `.snippet-highlight-tabstop`, etc.) without a single matching rule in `main.css` since the 1.1.0 redesign. The picker rendered as a vertical text dump — trigger / (group) / preview as three stacked lines per row, preview pane indistinguishable from regular text. New `.snippet-picker-modal` block covers the search input (focus ring), the results listbox (scrollable bordered card, max-height 280px), each row as a 3-col grid `[trigger][group-pill][mini-preview]` with hover + selected states, the preview card (bordered, monospace, `white-space: pre-wrap` so multi-line replacements like callouts and tables render with real line breaks), the `$|` cursor marker (accent-coloured pill), `$1`-`$9` tabstop markers (muted pill), and the hints row (kbd-style chips). Theme-aware via Obsidian CSS custom properties.
- **README MP4 link no longer promises inline playback.** GitHub serves raw `.mp4` URLs with `application/octet-stream` content-type, so browsers refuse to play the file inline — clicking the previous "Watch the 60-second walkthrough with voice-over" link just downloaded the file. Reworded to make the GIF the inline asset and frame the MP4 honestly: "lives at `docs/screens/demo.mp4` — GitHub serves it as a download, so save it locally or watch in your editor."

### Maintenance

- **DRY: `espanso.ts` now imports `normalizeTrigger` from `services/utils.ts`.** Until 1.1.4 both files had their own copy with similar-but-different semantics. After the 1.1.4 strip-trailing-colons fix in `services/utils.ts`, the two functions had silently diverged in capability. Removed the local copy; both call sites now use the shared export. Behaviour stays correct, and Espanso imports inherit the strip-trailing-colons rule for free.

## [1.1.4] - 2026-05-19

Ship-what-the-README-promises release. A first-time user who followed the Quick Start (`type todo and a space`) on 1.1.3 got nothing — `todo` wasn't in `DEFAULT_SNIPPETS`. Same with `done` / `note` / `bold` / `table` / etc. — all advertised in the README "Try these out of the box" table, none actually present. 1.1.4 closes that gap.

### Added

- **Default snippets the README has been promising all along.** `presets.ts` now ships `todo` → `- [ ] $|`, `done` → `- [x] $|`, `bold` / `italic` / `code` (inline-emphasis wrappers with cursor inside), `note` → `> [!note]\n> $|` (Obsidian callout with cursor on the body line), `table` → 3×3 scaffold. Existing user data wins the merge in `loadSettings`; only fresh installs get the new defaults.

### Changed

- **`today` / `now` now produce actual dates/times.** Was `{{date:YYYY-MM-DD}}` / `{{time:HH:mm}}` — Templater-syntax stubs that only worked if you also had Templater installed and configured. Now `$date` / `$time` — Snipsy's native variables, substituted at expansion time regardless of which other plugins you have. Existing user-defined values still win in the merge, so users who'd been relying on the old strings keep them; users on a clean install get the new behaviour.

### Fixed

- **Community-pack install path now normalises Espanso-style trigger keys** (B-117). The Basic Emojis pack ships triggers as `:smile:` / `:fire:` (Espanso convention). Snipsy's engine treats `:` as a separator, so a stored `:smile:` is reachable by no keystroke sequence — `:smile:<space>` produces an empty trigger candidate, `:smile<space>` produces `smile` which the dict didn't have. The Espanso importer (`src/packages/espanso.ts`) already stripped leading colons; the community-packages install path didn't. Fixed by strengthening `services/utils.ts:normalizeTrigger` to strip both leading AND trailing colons, and calling it inside `convertSnippetsToObject` for every key on install. Existing users with corrupt `:smile:` entries from prior installs need to **reinstall the pack** — there's no retroactive cleanup pass over their data.json.
- **README copy now matches engine behaviour.** "How expansion works" used to show `I need to :todo buy groceries` → `I need to - [ ] buy groceries`. In reality the leading `:` is a typed character that stays in the document; the actual result is `I need to :- [ ] buy groceries`. Replaced with a clear two-mode example documenting both `todo·` and `:todo·` invocations with the correct outputs. The "Try these out of the box" table also rewritten to list only the actual `DEFAULT_SNIPPETS` — no more advertising packs that have to be installed separately as if they were defaults.
- **README demo embed** switched from `<video>` tag to `[![demo.gif](...)](demo.mp4)`. GitHub strips relative-path `<video>` (the raw URL serves `application/octet-stream`, browsers refuse to play it inline). GIF auto-plays as fallback; click-through opens the narrated MP4.

## [1.1.3] - 2026-05-19

Patch release polishing the rest of the obvious CSS gaps that shipped in 1.1.2. Bundled with the seeding of the community catalog ([snipsidian-community#1](https://github.com/Dimagious/snipsidian-community/pull/1) — 10 starter packs, ~190 snippets), which made the modal CSS gap impossible to ignore.

### Fixed

- **Package Details modal renders correctly** (B-116). Clicking a row in **Settings → Packages** used to show meta lines collapsed against each other (`Author: snipsidian-communityVersion: 1.0.08 snippets`), tags concatenated into a single string, and multi-line snippet replacements (callouts, tables, journal templates) rendered as walls of single-line text. Root cause: every `.package-meta` / `.package-tags` / `.snippet-row` / `.snippet-replacement` rule in `main.css` was scoped under `.snipsidian-settings`, but the modal's `contentEl` carries `.snipsidian-modal` instead — none of the rules applied. Added a dedicated `.snipsidian-modal` rule block covering the badge, description, meta line with separator dots, tag pills, and the snippet-preview grid with `white-space: pre-wrap` so multi-line replacements finally render with real line breaks.

### Maintenance

- **Cleared remaining `!important` scorecard warnings.** 1.1.2 still surfaced 5 `declaration-no-important` hits — 3 were the literal word inside CSS comments (rephrased to "priority overrides"), 2 were real declarations in the `prefers-reduced-motion` block. Class-doubled the selectors (`.snipsidian-settings.snipsidian-settings *`) so specificity rises to (0,2,0) — matches every `.snipsidian-settings .x` rule that declares an animation / transition, and source-order resolves in the reduced-motion block's favour. `grep -c "!important" styles.css` → 0 (was 5).

## [1.1.2] - 2026-05-15

Maintenance release. No user-visible changes; cuts a new bundle so the Obsidian community plugin index ships the scorecard-clean assets to users.

### Maintenance

- **Test foundation.** ~100 new unit / integration / mount tests across `src/packages/**` (espanso importer boundary cases — B-079), engine + store + validator (boundary hardening per [ADR-0005](.claude/brain/decisions/0005-test-philosophy.md) — B-080), full keystroke → expansion integration flow (B-081), and UI mount tests for `SnippetPickerModal` / `ImportPreviewModal` / `SnippetsTab` (B-001 partial). Plus Playwright + Electron E2E against a real Obsidian instance — 33 specs covering expansion / picker / settings / persistence / variables / delete-flow / rename / commands / Add-snippet validation (B-100..B-107).
- **Scorecard cleanup.** Replaced 7 `!important` declarations in `styles.css` with class-doubled specificity (`.snipsidian-settings.snipsidian-settings ...`) for the section reset rule + `.is-hidden` utility. Only the `prefers-reduced-motion` block keeps `!important` — idiomatic per MDN. Also dropped one unnecessary `as string | undefined` assertion in `src/ui/utils/ui-state.ts`. Resolves the 15-warning Review batch on `community.obsidian.md/plugins/snipsidian` (scorecard re-scans on its own cadence after release).

## [1.1.1] - 2026-05-15

Patch release polishing the Snippet Picker — the most-opened surface in the plugin, which wasn't touched in the 1.1.0 redesign. Closes the [B-040](.claude/brain/backlog.md) UX cluster + [A-006](.claude/brain/reports/2026-05-14-accessibility-specialist.md) (a11y combobox pattern) + the picker half of [B-091](.claude/brain/backlog.md) (real heading elements).

### Added

- **"Wrap selection" mode**. Opening the picker while a Markdown editor has a non-empty selection now reads "Wrap selection" in the title (was always "Insert snippet"). The action wraps the selection with the snippet text.
- **Truncation badge** "Showing X of Y". Visible only when the user's query matched more snippets than fit under the 100-result cap. The exact-limit boundary stays silent so the hint doesn't surface as noise.
- **Home / End keyboard navigation** in the picker — jump to the first / last result.
- **WAI-ARIA combobox-with-listbox pattern** for screen-reader users. Search input gets `role="combobox"` + `aria-controls` + `aria-activedescendant` pointing at the active row; results container gets `role="listbox"`; each row gets `role="option"` + `aria-selected`.

### Changed

- "Folder" label in the picker rows and preview meta is now "Group" — matches the lexicon used by every other surface in the plugin (the data shape is unchanged).
- Modal title now uses Obsidian's native `titleEl` instead of a manual `<h2>` (the latter was invisible to the modal's a11y tree).
- "Preview" was rendered as an orphan `<label>` not tied to any input. Now a real `<h3>` so screen-reader users can navigate to it via "next heading".
- Dropped "directly" filler word from the click-to-insert hint.

### Fixed

- **Double-click race**. Two click handlers used to fire on a row click — one at the list level, one per-item. They raced on double-click and could fire `insert` twice. Now: one handler per row.

### Internal

- `SnippetPickerService.search()` contract changed from `SnippetItem[]` to `{ items, total }` to support the truncation hint. Three new boundary tests pin the contract per [ADR-0005](.claude/brain/decisions/0005-test-philosophy.md): `total > items` when the limit truncates, `total === items` at the exact-limit boundary (no false "Showing N of N" noise).
- Tests: 235 pass, coverage above thresholds.
- Bundle: 179.0kb → 180.5kb (+1.5kb).

## [1.1.0] - 2026-05-15

UI redesign release. Closes ~16 P0/P1 backlog items as side-effects of one coordinated implementation. See [ADR-0006](.claude/brain/decisions/0006-adopt-1.1.0-redesign.md).

### Added

- **Tab strip** with new information architecture (Snippets → Packages → General → About). Snippets is the landing tab. Full WAI-ARIA tabs pattern: arrow keys + Home/End move focus and activation, roving tabindex, screen-reader-visible labels. Pre-1.1.0 stored `activeTab` values (`basic` / `community` / `feedback`) migrate to the new IDs transparently on first launch.
- **Import preview**. Import JSON now opens a modal with a merge vs replace radio and a diff list (added / updated / removed). Replace mode highlights the removed rows in red. No more silent library wipes.
- **Search result-count badge** on the Snippets tab while filtering.
- **Sticky bulk operations bar** above the snippet list when items are selected.
- **Loading skeleton, empty, and error states** on the Packages tab.
- **Single-edit-mode** in the snippets list. In-progress edits now survive list re-renders. Opening edit on a second row auto-discards the first row's unsaved draft.
- **GitHub-issue submission flow** for both feedback (bug / feature / general) and community packages. Prefilled with plugin / Obsidian / platform versions.

### Changed

- **Packages tab**: table → list-of-rows layout. Install always opens the preview modal, even at zero conflicts.
- **General tab**: ghost-style utility buttons instead of 8 CTAs. Sections regrouped into Commands + Backup. Headings are real `<h3>` / `<h4>` for screen readers.
- **Feedback tab → About tab**: plain rows, no CTAs, version footer.
- **Action buttons** across snippet rows and group actions use native `setIcon()` with per-row `aria-label`s (e.g. "Edit snippet :hello"), replacing emoji glyphs.
- **`prefers-reduced-motion: reduce`** is now honoured globally — transitions and animations off for users who request it.
- **CSS** consolidated from six files into one, scoped to `.snipsidian-settings` so nothing leaks into the rest of Obsidian's UI.

### Removed

- **Google Forms** integration. Both feedback and package submission now go through GitHub issues. Simpler privacy story (no third-party form vendor). `services/feedback-form.{ts,test.ts}` and `services/package-submission-form.{ts,test.ts}` deleted (~1000 lines).
- **Help & Resources** section from General. Its content (Documentation / Espanso hub / Demo) lived in About too.

### Fixed

- Inline snippet edit no longer wipes itself on every keystroke (B-021).
- Search input keeps focus and cursor position while typing.

### Internal

- Tests: 232 pass, coverage 92.32% lines / 86.82% branches. New tests pin boundary contracts per [ADR-0005](.claude/brain/decisions/0005-test-philosophy.md): `getEditingDraft()` returns a live reference; `removed` list populates correctly for replace-mode warning; tab-ID migration honours each legacy value; URL-encoded title/body round-trips through GitHub issue URLs.

## [1.0.11] - 2026-05-14

### Fixed

- **Snippet picker** no longer silently ignores Enter / click when no Markdown view is active. Triggering the picker from the Command Palette while focused on Canvas, the file explorer, or the settings tab used to do nothing — no Notice, no error, just a quiet failure. Now shows `"Open a Markdown note to insert a snippet"` and keeps the picker open so the user can switch to a note and try again.

### Documentation

- README rewritten end-to-end for honest positioning. Removed stale "Version 1.0.0 - First stable release" banner, outdated stats from `1.0.5` (test count, coverage, bundle size), and dev-heavy filler. Added explicit "Why Snipsy" differentiation, a "When Snipsy is NOT the right tool" section that recommends Templater / Espanso / Snippets Manager for the jobs they own, and a Privacy section. 348 → 175 lines, all user-facing content density up.

## [1.0.10] - 2026-05-14

### Security

- Community packages fetched from the catalog are now re-validated at install time. Adds shape, size, and count caps for triggers and replacements — and explicitly rejects `/` and `\` in package labels / triggers — so attacker-controllable content from the upstream catalog can't land arbitrary keys in `settings.snippets`. New `validatePackageForInstall` in `services/package-validator.ts`; wired into `PackageBrowser.installPackage`. (Closes B-033, S-002, S-006.)
- The directory-listing → file-fetch step in `loadCommunityPackagesFromGitHub` now requires `download_url` to be `https://raw.githubusercontent.com/…`. A spoofed or future-changed GitHub API response can no longer redirect us to an attacker-controlled host. (Closes B-036, S-005.)
- Snippet collision checks in `ui/utils/group-utils.ts` now use `Object.prototype.hasOwnProperty.call(map, key)` instead of `key in map`. Eliminates a ghost-collision when renaming or moving snippets to names that match `Object.prototype` members (`toString`, `constructor`, `valueOf`, etc.) — a real edge case after importing JSON packs that contained those keys. (Closes B-035, S-004.)

### Tests

- 19 new boundary-case tests across `package-validator.test.ts` (install-validator contracts, including exact-limit values, RTL-override / control-character triggers, aggregate-size attack, error-message truncation), `community-packages.test.ts` (off-host and downgrade-protocol rejections), and `group-utils.test.ts` (prototype-chain ghost-collision regressions). First structural application of ADR-0005: tests verify the contract at boundaries, not just line coverage.

## [1.0.9] - 2026-05-14

### Added

- Settings now remember the active tab and which groups are collapsed across Obsidian restarts. Previously `setActiveTab` and `setGroupOpen` mutated `settings.ui` in memory but never called `saveSettings()`, so the user landed back on the default tab with every group re-expanded after a restart.

### Changed

- Empty or punctuation-only group names are now rejected with an inline error message instead of silently routing the snippet to "Ungrouped". Affects three places: the **Rename group** prompt, the **New group…** option in `GroupPickerModal`, and the **Group** field in the **Add snippet** modal. The rule is the same everywhere: a non-empty name must contain at least one letter or number; empty input stays valid only in the Add Snippet modal (which means "Ungrouped" intentionally).
- The **Add Snippet** modal now also shows an inline error when the Trigger or Replacement field is empty, instead of silently no-oping on click.
- Consolidated the duplicated `isRecordOfString` type guard into `src/shared/guards.ts` (was in both `store/schema.ts` and `services/utils.ts`).

### Removed

- Dead `src/core/expander.ts` (~180 lines) — duplicated `engine/expand.ts` + `engine/match.ts` + `shared/markdown.ts` and had a divergent `isSeparator` that would have been a foot-gun for any future auto-import.
- Deprecated `loadCommunityPackages()` and `loadCommunityPackagesFromVault()` stubs (~50 lines) — both returned `[]` and had no production callers. Active load paths (`loadCommunityPackagesWithCache`, `loadDynamicCommunityPackages`) untouched.
- Two no-op normalisation substitutions in the Espanso importer (`CURSOR_PLACEHOLDER` → `$|` and `\\n` → `\n`) — both regexes matched the literal string they replaced. `YAML.parse` already handles real string escapes.
- Unused `replaceAllSnippets` from `src/store/snippets.ts`.

## [1.0.8] - 2026-05-14

### Removed

- Dead `SubmitPackageModal` component (legacy in-vault submission flow). The active submission path goes through `services/package-submission-form.ts` (Google Form) via `PackageSubmissionSection` — `SubmitPackageModal` was no longer reachable.
- Now-orphaned `processPackageSubmission` helper in `services/community-packages.ts` and its 4 tests.

### Fixed

- Reverted timer functions back to `window.setTimeout` / `window.clearTimeout` (from `activeWindow.*`) per updated Obsidian community-plugin scorecard guidance. The scanner rule reversed between the `1.0.5` and `1.0.7` scans — timers should bind to the window the code was loaded in, not the currently-focused window. Affects `SnippetPickerModal` (search debounce) and `BasicTab` (hotkey-tab scroll). `activeDocument` stayed correct.

## [1.0.7] - 2026-05-14

### Fixed

- Multi-line snippet replacements now place the cursor on the correct line. Previously any callout/list snippet that used `$|` after a `\n` (e.g. `> [!note] $|\n> `) landed the caret past end-of-line of the first inserted line. `EditPlan` now carries a structured `(lineDelta, ch)` cursor position and the adapter applies the line delta when setting the caret.
- `$|` cursor marker is now located **after** variable substitution. Previously `$|` was resolved against the raw replacement, so any length change in `$date` / `$time` / `$filename` / `$clipboard` to the left of `$|` silently desynced the caret (e.g. `"$date $|"` placed the cursor at index 6 of the raw string rather than at the end of the expanded date).

## [1.0.6] - 2026-05-14

### Changed

- Adopt Obsidian community-scorecard API rules across UI and modals: `document.*` → `activeDocument.*`, `setTimeout` / `clearTimeout` → `activeWindow.setTimeout` / `activeWindow.clearTimeout`, and `createEl("span" / "div")` → `createSpan` / `createDiv`.
- Consolidate the stylesheet: drop `!important` overrides in favour of class-doubled specificity, expand 3-digit hex literals, normalise trailing-zero margins, and de-duplicate selectors that previously lived in multiple source files.
- Migrate YAML parsing from `js-yaml` to `yaml` (Eemeli Aro) across the espanso importer, community-package loader, submission modal/section, and submission form.
- Type Obsidian's internal `App.setting` and `App.version` via `declare module "obsidian"` and remove the corresponding `@ts-expect-error` shims. Type GitHub API responses in `community-packages.ts` instead of leaning on `any`.
- Update plugin description in `manifest.json` so it no longer starts with the plugin name.

### Security

- Bump `esbuild` to `^0.28.0` (dev-server SSRF advisory) and add npm `overrides` for vulnerable transitive deps (`picomatch`, `minimatch`, `brace-expansion`, `js-yaml`, `glob`, `flatted`, `fast-uri`, `postcss`, `rollup`). `npm audit` now reports 0 vulnerabilities.

### Build

- Release workflow now attests build provenance for `main.js` / `manifest.json` / `styles.css` via `actions/attest-build-provenance` and no longer attaches the legacy `snipsidian-*.zip` artifact to the GitHub Release.
- Enable `@typescript-eslint/no-unused-vars` (strict, with `^_` opt-out) in `eslint.config.js` so CI catches the same warning the scorecard scanner runs.

## [1.0.5] - 2026-03-04

### Fixed

- Fixed package conflict resolution so `Keep current` / `Overwrite` choices are actually applied.
- Fixed Espanso install conflict detection and conflict-resolution application.
- Switched package submission UI flow to Google Form submission opening (instead of unauthenticated GitHub Issue POST).
- Added collision checks to prevent duplicate trigger names across groups in add/edit flows.
- Made trigger dictionary resolution deterministic when grouped keys share the same trigger name.
- Hardened external link opening with `noopener,noreferrer`.
- Fixed false-positive conflicts for imports when incoming and current values are identical.
- Fixed group handling so ungrouped snippets no longer collide with a literal `"Ungrouped"` group.
- Fixed snippet add/edit forms to preserve replacement whitespace and line breaks.
- Fixed bulk move and group rename operations to persist changes to disk via settings save.
- Fixed package install collision checks to detect conflicting replacements across all groups.
- Removed stale-reference risk in group operations by applying moves to the current snippets map.
- Removed unused legacy `CommunityPackageModal` code path and related dead modal styles.

## [1.0.0] - 2025-01-15

### 🎉 Major Release - First Stable Version

This is the first stable release of Snipsy! After extensive development and testing, we're proud to present a mature, feature-complete text expansion plugin for Obsidian.

### Added

- **Google Form Package Submission**: Complete integration with Google Forms for community package submissions
  - Pre-filled form with package data, contact information, and system metadata
  - Automatic YAML validation and error reporting
  - Contact information collection (name, email) for package submitters
  - System metadata auto-filling (plugin version, Obsidian version, platform, OS, locale, theme)
- **Enhanced Package Validation**: Comprehensive validation for community packages
  - Required field validation (name, author, version, description, snippets)
  - Snippet structure validation (trigger, replace text)
  - Optional field warnings (category, tags, license)
  - Detailed error and warning messages
- **Comprehensive Test Coverage**: Significantly improved test suite
  - Added tests for `package-submission-form.ts` (91.51% coverage)
  - Added tests for `feedback-form.ts` (100% coverage)
  - Added tests for `obsidian-editor.ts` (74.3% coverage)
  - Total test count increased from 119 to 221 tests
  - Overall coverage improved from 78.81% to 87.92%
- **Modular Architecture**: Improved code organization and maintainability
  - Split `CommunityTab.ts` into focused modules: `PackageBrowser`, `PackageSubmissionSection`, `EspansoSection`
  - Better separation of concerns and code reusability
  - Maintained all existing functionality while improving structure
- **Improved UI Components**: Better user experience for package management
  - Cleaner package display with proper CSS classes
  - Better visual hierarchy and spacing
  - Improved button states and interactions
  - Enhanced modal layouts and styling

### Changed

- **Code Quality Improvements**: 
  - Fixed all TypeScript errors and improved type safety
  - Extracted inline styles to CSS classes for better maintainability
  - Improved module boundaries and architecture compliance
  - Enhanced error handling and validation
- **UI/UX Enhancements**:
  - Replaced inline styles with semantic CSS classes
  - Better responsive design and accessibility
  - Improved visual feedback for user actions
  - Cleaner code structure and separation of concerns

### Fixed

- **TypeScript Issues**: Resolved all compilation errors
  - Fixed interface exports and type definitions
  - Corrected property access patterns
  - Improved type safety across components
- **CSS Architecture**: Moved inline styles to proper CSS classes
  - Better maintainability and consistency
  - Improved performance and caching
  - Enhanced theme compatibility

---

## [0.8.0] - 2025-01-15

### Added

- **Google Form Package Submission**: Complete integration with Google Forms for community package submissions
  - Pre-filled form with package data, contact information, and system metadata
  - Automatic YAML validation and error reporting
  - Contact information collection (name, email) for package submitters
  - System metadata auto-filling (plugin version, Obsidian version, platform, OS, locale, theme)
- **Enhanced Package Validation**: Comprehensive validation for community packages
  - Required field validation (name, author, version, description, snippets)
  - Snippet structure validation (trigger, replace text)
  - Optional field warnings (category, tags, license)
  - Detailed error and warning messages
- **Comprehensive Test Coverage**: Significantly improved test suite
  - Added tests for `package-submission-form.ts` (91.51% coverage)
  - Added tests for `feedback-form.ts` (100% coverage)
  - Added tests for `obsidian-editor.ts` (74.3% coverage)
  - Total test count increased from 119 to 221 tests
  - Overall coverage improved from 78.81% to 87.92%
- **Modular Architecture**: Improved code organization and maintainability
  - Split `CommunityTab.ts` into focused modules: `PackageBrowser`, `PackageSubmissionSection`, `EspansoSection`
  - Better separation of concerns and code reusability
  - Maintained all existing functionality while improving structure
- **Improved UI Components**: Better user experience for package management
  - Cleaner package display with proper CSS classes
  - Better visual hierarchy and spacing
  - Improved button states and interactions
  - Enhanced modal layouts and styling

### Changed

- **Code Quality Improvements**: 
  - Fixed all TypeScript errors and improved type safety
  - Extracted inline styles to CSS classes for better maintainability
  - Improved module boundaries and architecture compliance
  - Enhanced error handling and validation
- **UI/UX Enhancements**:
  - Replaced inline styles with semantic CSS classes
  - Better responsive design and accessibility
  - Improved visual feedback for user actions
  - Cleaner code structure and separation of concerns

### Fixed

- **TypeScript Issues**: Resolved all compilation errors
  - Fixed interface exports and type definitions
  - Corrected property access patterns
  - Improved type safety across components
- **CSS Architecture**: Moved inline styles to proper CSS classes
  - Better maintainability and consistency
  - Improved performance and caching
  - Enhanced theme compatibility

### Technical

- **Test Coverage**: Maintained comprehensive test suite
  - 201 tests passing
  - 75.37% code coverage (target: 90%)
  - All critical paths tested
- **Module Architecture**: Verified proper module boundaries
  - Engine modules isolated from UI
  - Services properly abstracted
  - Clean separation of concerns

## [0.1.0] - 2025-08-31

### Added

- Initial plugin skeleton with `manifest.json`, `main.ts`, `package.json`.
- Interactive snippets manager UI: add, edit, delete snippets.
- Export/Import snippets as JSON.
- Reveal `data.json` in file manager (desktop only).
- Automatic expansion of triggers on space/enter/punctuation.
- Default snippets (Markdown/Obsidian and general productivity).
- Modular structure: core expander, settings UI, presets, types.

### Changed

- Comments translated to English and simplified.
- Deep-merge defaults with user snippets, added "Add missing defaults" action.

### Fixed

- Correct cursor placement after expansion using `EditorPosition`.

## [0.2.0] - 2025-09-01

### Added

- Espanso-compatible packages: install from built-in catalog or paste YAML.
- Built-in package catalog (curated for Obsidian):
  - **Obsidian Callouts (builtin)** — quick callout blocks (`> [!note]`, `> [!tip]`, …).
  - **Markdown basics (builtin)** — code fence, quote, todo (was present; moved to catalog).
  - **Markdown tables (builtin)** — 3×3 table scaffold.
  - **Unicode arrows (builtin)** — → ← ↑ ↓ and shortcuts.
  - **Math symbols (lite, builtin)** — ± × ÷ ≤ ≥ ≠ ≈ µ ° ∞.
  - **Kaomoji (lite, builtin)** — ¯\\\_(ツ)\_/¯, table flip, etc. _(optional; can be toggled/edited)_

### Changed

- Settings UI: help text with link to Espanso Hub; clearer labels/tooltips.
- Styles: subtle help block, group headers, nicer empty state.
- **Package preview modal:** improved layout and readability:
  - Added spacing between buttons.
  - Monospace font and padding for snippet text.
  - Hover highlight for conflict rows.
  - Footer separated with border and spacing.

### Notes

- Catalog items are small and safe-by-default. Big sets (e.g. full emoji packs) can be installed via **Paste YAML**.

## [0.3.0] - 2025-09-02

### Added
- Selection mode: checkboxes on rows and groups; per-group “Select all”; floating action bar.
- Bulk delete: remove all selected snippets with confirmation and a live counter.
- Move snippets:
  - Bulk move to a new or existing folder via the “Move to…” modal.
  - Per-row move using a dropdown (“Ungrouped” / existing groups / “New group…”).
- Group management: rename a folder; delete a folder (with an option to move its contents).
- Expand/Collapse all and persistent open/closed state of groups across sessions.

### Changed
- Catalog/YAML installs now go into nicely named folders (label → slug); the UI shows human-readable names.
- Modals are responsive: “Move to…” no longer overflows horizontally; the preview table scrolls inside.

### Fixed
- Selection is preserved when renaming or moving snippets.

## [0.4.0] - 2025-09-02

### Added
- **Modular architecture**: split into `app/`, `engine/`, `adapters/`, `store/`, `importers/`, `shared/`, `core/`. Clear boundaries; most logic moved into small pure modules.
- **Test suite (Vitest + jsdom)** with high coverage for engine, core expander, adapters, store, importers, and shared utils.
- **CI (GitHub Actions)**: typecheck (`tsc --noEmit`), unit tests with coverage, Codecov upload, release bundle build, artifacts.
- **Release workflow** on tags `v*`: build `main.js`, pack ZIP, auto-create GitHub Release and attach assets.
- **Badges & docs**: CI/Codecov/Release/stack badges in README; coverage section.
- **Funding links**: Sponsor/Buy Me a Coffee hooks added (README + repo).
- **Dev scripts**: 
  - `scripts/assert-versions.cjs` (checks `package.json` vs `manifest.json`),
  - `scripts/version-sync.cjs` (quick bump & sync),
  - `scripts/make-zip.cjs` (release ZIP).

### Changed
- **Thin entry**: `main.ts` now delegates to `app/plugin.ts`; esbuild keeps `obsidian`/CM6 externals.
- **Importers**: Espanso/catalog moved from `packages/` to `src/importers/…`.
- **Utilities**: refactor/organize helpers (`normalizeTrigger`, `isBadTrigger`, `splitKey/joinKey`, `slugifyGroup`, `displayGroupTitle`) and shared markdown/delimiters.
- **Type safety**: add `tsconfig.json`, `@types/js-yaml`; stricter CI typecheck.

### Fixed
- Hardened expansion/guards around inline & fenced code and YAML frontmatter (covered by tests).
- Prevent version drift on releases via version-consistency check.

## [0.4.1] - 2025-09-02

### Fixed
- Release bundle now built as **CommonJS** with an interop footer so Obsidian can construct the plugin class correctly.  
  No more “TypeError: h is not a constructor” on load.

### Changed
- Build scripts unified for CI and local vault builds (consistent flags).
- Docs: clarify plugin folder name (`snipsidian`) for manual installs.

## [0.4.2] - 2025-09-03

### Added
- Demo GIF in README to showcase one-click catalog install, callouts, and symbolic triggers.

### Changed
- Delimiters: -, /, \, | are no longer treated as separators (enables ->, <-, etc.); double and single quotes added to the separator set for better Markdown behavior.
- Runtime dictionary: engine now compiles the dict from grouped keys, so groups are UI-only and do not affect matching.
- Settings UX: edits no longer save & resort on every keystroke; changes are debounced and saved on blur—no flicker, no focus loss.

### Fixed
- Symbolic & structural triggers: -> → →, info → callout now expand reliably; token detection scans left to the nearest separator instead of relying on \w boundaries.
- Markdown awareness: sturdier checks for fenced code/inline code/frontmatter to avoid false positives.
- Tests updated to reflect the new delimiter contract.

## [0.5.0] - 2025-09-03

### Added
- **Emoji (lite, builtin)** — ~120 most popular emojis.
- **Task states (builtin)** — task states (`- [ ]`, `- [x]`, doing, waiting, canceled, etc.).
- Extended:
  - **Markdown basics** (bold, italic, headings, links).
  - **Obsidian Callouts** (summary, question, success, error, etc.).

### Changed
- Package catalog (`PACKAGE_CATALOG`) is now sorted alphabetically by `label` for convenience.

## [0.8.0] - 2025-09-11

### Added
- **🎯 Snippet Picker Command** - New "Insert Snippet…" command for quick snippet search and insertion
  - Real-time search by trigger or replacement text
  - Live preview of snippet content with placeholder highlighting
  - Keyboard navigation support for accessibility
  - Smart cursor placement and tabstop detection
- **⚙️ Commands Section** in Basic settings tab with hotkey configuration
  - "Set Hotkey" buttons for both main commands
  - Direct navigation to Obsidian's hotkey settings
  - Auto-scroll to specific commands for easy configuration
- **📦 Built-in Markdown Package** with comprehensive markdown snippets
- **🔧 Enhanced Editor Integration** with improved snippet insertion
  - Better handling of selected text wrapping
  - Improved cursor positioning after insertion
  - Robust error handling for edge cases

### Changed
- **🎨 Unified Green Styling** across all settings tabs
  - All sections now use consistent green theme (`var(--color-green)`)
  - Removed emoji icons from all sections for professional appearance
  - Clean, modern interface design throughout
- **📁 Collapsed Groups by Default** - Snippet groups start collapsed to reduce visual clutter
- **🏗️ Enhanced Architecture** with new core services
  - `SnippetPickerAPI` for snippet management
  - `getAllSnippetsFlat` function for efficient data access
  - Improved type definitions (`SnippetItem`, `SnippetSearchQuery`)

### Fixed
- **🐛 UI Initialization Error** - Resolved "Cannot access section before initialization" in BasicTab
- **🔧 TypeScript Errors** - Fixed CI compilation issues with proper type handling
- **📝 Code Quality** - Translated all Russian comments to English for consistency

### Technical Improvements
- **🧪 Test Coverage** - All 119 tests passing with 91.89% coverage
- **📦 Build Optimization** - Maintained efficient bundle size
- **🔒 Type Safety** - Enhanced TypeScript configuration and error handling

### Notes
- **Command Palette Integration** - Both commands are now available in Obsidian's Command Palette
- **Backward Compatibility** - All existing functionality preserved
- **Performance** - No impact on existing snippet expansion performance

## [0.7.0] - 2025-01-XX

### Added
- **Enhanced TypeScript configuration** with stricter type checking (`noImplicitAny`, `noUncheckedIndexedAccess`)
- **Comprehensive test coverage** for core expander with 13 new test cases covering edge cases
- **Modular UI architecture** with separated components for better maintainability

### Changed
- **Settings UI refactored** into modular components (BasicTab, PackagesTab, SnippetsTab)
- **Catalog module extracted** from packages into dedicated `src/catalog/` module
- **Improved type safety** throughout the codebase with reduced `any` usage
- **Enhanced test coverage** for `src/core/expander.ts` (92.68% coverage)

### Fixed
- **TypeScript compilation errors** resolved with proper nullish coalescing and type annotations
- **Import path consistency** after architectural refactoring

### Notes
- All user-facing functionality remains unchanged
- Focus on code quality, maintainability, and architectural improvements
- Build size optimized to 76.6kb

## [0.6.0] - 2025-09-05

### Changed
- **Settings UI redesigned** in a Copilot-like style with tabs (Basic / Packages / Snippets):
  - Larger header title for clarity.
  - Removed **Advanced** tab (was placeholder-only).
  - **Packages**:
    - Simplified *Install from catalog*: dropdown + single **Install** button.  
      Removed confusing overwrite toggle and folder rename option — packages now install into fixed folders by label.
    - Simplified *Install from YAML*: cleaner three-column layout (folder label / YAML textarea / install button).  
      Removed overwrite toggle for clarity.
  - **Snippets**:
    - Removed redundant "Snippets" heading at the top of the tab.
    - Group actions (**Rename**, **Delete group**) are now aligned to the right for consistency.
- Polished spacing, alignment and layout across sections for a cleaner look.

### Notes
- All snippet management logic, package install behavior, and export/import functionality remain unchanged.  
  This release focuses purely on improving usability and consistency of the settings panel.
