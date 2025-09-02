import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
    test: {
        environment: "node",
        include: ["src/**/*.test.ts"],
        coverage: {
            reporter: ["text", "html"],
            reportsDirectory: "coverage",
        },
    },
    resolve: {
        alias: {
            // Route 'obsidian' imports to our test stub
            obsidian: fileURLToPath(new URL("./test/stubs/obsidian.ts", import.meta.url)),
        },
    },
});
