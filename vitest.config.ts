import { defineUnitConfig } from "obsidian-plugin-dev-kit/vitest";

export default defineUnitConfig({
    rootDir: import.meta.dirname,
    // The tests run on Snipsy's own `obsidian` stub.
    obsidian: "./src/test/stubs/obsidian.ts",
    // Only the files that need a DOM start jsdom, with Obsidian's DOM helpers
    // installed by the kit: every UI test, the clipboard adapter and the jsdom
    // smoke test. The rest run in node.
    dom: [
        "src/ui/**/*.test.ts",
        "src/adapters/clipboard.test.ts",
        "src/test/integration/jsdom-env.test.ts",
    ],
    coverage: {
        include: ["src/**/*.ts"],
        exclude: [
            "main.js",
            "scripts/**",
            "src/main.ts",
            "src/types.ts",
            "src/engine/types.ts",
            "src/services/package-types.ts",
            // Per ADR-0005 the floor is a noise gate: the fix for an untested
            // file is a test, not a looser gate. These two stay out; every
            // other UI file is in.
            // Renders declarative setting definitions (ADR-0007); the tests
            // cover only part of it.
            "src/ui/components/SettingsTab.ts",
            // Mount tests cover install/uninstall/reinstall and the keydown
            // guard; the skeleton/error states, search filter, refresh Notice
            // and details modal have none.
            "src/ui/components/community/PackageBrowser.ts",
        ],
        // lcov.info goes to Codecov in CI, html is for reading locally.
        extraReporters: ["lcov", "html"],
    },
});
