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
                "src/test/**",
                // `src/ui/**` stays excluded — UI tests (mount-level) are
                // a later phase and need jsdom + the new factories. Once
                // those tests exist, drop this line and let coverage
                // enforce the contract.
                "src/ui/**",
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
