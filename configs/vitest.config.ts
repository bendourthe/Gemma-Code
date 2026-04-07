import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    setupFiles: [resolve(__dirname, "../tests/setup.ts")],
    include: [
      "tests/unit/**/*.test.ts",
      "tests/integration/**/*.test.ts",
    ],
    benchmark: {
      include: ["tests/benchmarks/**/*.bench.ts"],
    },
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.d.ts",
        "**/BackendManager.ts",
        "**/extension.ts",
        "src/utils/**",
      ],
      thresholds: {
        lines: 80,
        branches: 75,
      },
      reporter: ["text", "lcov"],
    },
  },
  resolve: {
    alias: {
      // Allow importing .js extensions that resolve to .ts sources
    },
  },
});
