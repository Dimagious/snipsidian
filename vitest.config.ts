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
                // own follow-up PR per file):
                "src/ui/components/BasicTab.ts",
                "src/ui/components/FeedbackTab.ts",
                "src/ui/components/SettingsTab.ts",
                // Community-section files (biggest UI surface; defer
                // proper mount tests to a focused follow-up PR — too
                // many interactive paths to bundle here without
                // ballooning the diff). `EspansoSection.ts` IS in
                // the gate — its B-045 group-name flow ships in 1.1.7
                // and gets dedicated mount tests in `EspansoSection.test.ts`.
                "src/ui/components/community/PackageBrowser.ts",
                "src/ui/components/community/PackageSubmissionSection.ts",
                // `SnippetsTab.ts` + `SnippetPickerModal.ts` have
                // mount tests but coverage is partial (54% / 73%).
                // Both are 500+ line files — fully covering them is
                // a follow-up sprint, not a polish PR. Tests exist
                // for the high-value paths (add/edit/delete in
                // SnippetsTab, picker keyboard nav in SnippetPickerModal);
                // the remaining gaps are rename-group orchestration,
                // bulk operations, preview variable substitution.
                "src/ui/components/SnippetsTab.ts",
                "src/ui/components/SnippetPickerModal.ts",
                // `community-cache.ts` + the vault-backed loader half
                // of `community-packages.ts`: live-load fallback paths
                // and TFile/TFolder mocks would balloon the test
                // scaffolding. Defer to a focused PR.
                "src/services/community-cache.ts",
                "src/services/community-packages.ts",
                //
                // `src/packages/**` was previously excluded with no
                // tests at all (B-079). `espanso.test.ts` now covers
                // the importer's contract at the boundary level —
                // re-included so future regressions show up in coverage.
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
