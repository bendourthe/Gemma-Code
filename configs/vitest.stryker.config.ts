import { defineConfig } from "vitest/config";
import { resolve } from "path";

// Narrow vitest config used only by the Stryker mutation pass (v0.6.0
// Phase 7.6). It excludes timing-sensitive tests that run on the regular
// suite (e.g. Orchestrator timestamp assertions) so they do not gate
// Stryker's initial dry-run.
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    setupFiles: [resolve(__dirname, "../tests/setup.ts")],
    include: [
      "tests/unit/guardrails/**/*.test.ts",
      "tests/unit/tools/handlers/**/*.test.ts",
      "tests/unit/utils/secretPaths.test.ts",
    ],
    benchmark: {
      include: [],
    },
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text"],
    },
  },
});
