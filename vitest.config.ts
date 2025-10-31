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
                "src/ui/**",
                "src/packages/**",
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
