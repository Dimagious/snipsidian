import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
    test: {
        environment: "node",
        include: ["src/**/*.test.ts"],
        coverage: {
            enabled: true, 
            provider: "v8",
            reporter: ["text", "html", "lcov", "json-summary"],
            reportsDirectory: "coverage",
            include: ["src/**/*.ts"],
            exclude: [
                "main.js",
                "scripts/**",
                "src/main.ts",
                "src/types.ts",
                "src/engine/types.ts",
                "src/services/package-types.ts",
                "src/test/**",
                // B-114 (1.1.7): the `src/ui/**` umbrella exclusion is
                // gone. Each remaining UI file is in the gate by
                // default — what's still un-tested gets file-level
                // exclusions below with explicit follow-up items in
                // the brain backlog. Anything not listed here has
                // landed in the gate and any new uncovered surface
                // surfaces as a gate failure.
                //
                // Phase-5 UI testing (the mount-tests + integration
                // pass that would push these over the 90% line) is
                // tracked as a brain umbrella; opening this gate
                // makes the work visible. Per ADR-0005 the floor is
                // a noise gate, not a quality signal — the right fix
                // for any of these is adding tests, not loosening
                // the gate.
                //
                // Tab files (big render trees, no mount tests yet —
                // own follow-up PR per file). `BasicTab.ts` gained
                // mount tests for the B-131 restore-defaults flow in
                // 1.2.0 (`BasicTab.test.ts`) and the B-150/B-137
                // Expansion-section rows in 1.3.1, but stays excluded —
                // export/import/reveal wiring is still untested, same
                // partial-coverage precedent as SnippetsTab below.
                "src/ui/components/BasicTab.ts",
                "src/ui/components/FeedbackTab.ts",
                "src/ui/components/SettingsTab.ts",
                // Community-section files (biggest UI surface).
                // `PackageBrowser.ts`: B-142 (1.3.1) landed dedicated
                // mount tests (`PackageBrowser.test.ts`) covering the
                // install/uninstall/reinstall click→plan→write wiring
                // and the B-135 keydown guard — the file stays excluded
                // because large swaths (skeleton/error states, search
                // filter, refresh Notice wording, the details modal)
                // still have no net; a full pass is a follow-up, not a
                // reason to drop the tests that now exist.
                // `PackageSubmissionSection.ts` has no mount tests yet.
                // `EspansoSection.ts` IS in the gate — its B-045
                // group-name flow ships in 1.1.7 and gets dedicated
                // mount tests in `EspansoSection.test.ts`.
                "src/ui/components/community/PackageBrowser.ts",
                "src/ui/components/community/PackageSubmissionSection.ts",
                // `SnippetsTab.ts` + `SnippetPickerModal.ts` have
                // mount tests but coverage is partial. Both are 500+
                // line files — fully covering them is a follow-up
                // sprint, not a polish PR. `SnippetsTab.ts` gained
                // dedicated bulk delete/move wiring tests in 1.3.1
                // (B-142, `SnippetsTab.test.ts`) on top of the
                // existing add/edit/delete coverage; the remaining
                // gaps are rename-group orchestration and preview
                // variable substitution.
                "src/ui/components/SnippetsTab.ts",
                "src/ui/components/SnippetPickerModal.ts",
                //
                // `src/packages/**` was previously excluded with no
                // tests at all (B-079). `espanso.test.ts` now covers
                // the importer's contract at the boundary level —
                // re-included so future regressions show up in coverage.
                // `src/services/community-cache.ts` +
                // `community-packages.ts` were excluded pre-1.3.1 for
                // the vault-backed loader's TFile/TFolder mocking cost;
                // B-143 deleted that dead loader, both files are now
                // fully covered by their existing test suites and are
                // back in the gate (no exclusion needed).
                "**/*.d.ts"
            ],
            thresholds: {
                lines: 90,
                functions: 90,
                statements: 90,
                branches: 80,
            },
        },
    },
    resolve: {
        alias: {
            // Route 'obsidian' imports to our test stub
            obsidian: fileURLToPath(new URL("./src/test/stubs/obsidian.ts", import.meta.url)),
        },
    },
});
