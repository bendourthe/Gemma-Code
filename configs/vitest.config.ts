import { defineConfig } from "vitest/config";
import { resolve } from "path";

// v0.9.0 Phase 1 (sub-task 1.1) -- the two CLI script entry points
// (`bin/gemma-check.mjs` and `scripts/package-skills.mjs`) start with a
// `#!/usr/bin/env node` shebang so they can be invoked directly via the npm
// `bin` field on POSIX systems. Vite's transform pipeline does not strip the
// shebang when those files are imported as ESM dependencies of a test file,
// and the resulting source confuses Node's vm parser on Windows -- the
// symptom catalogued as v0.8.0 known-gaps 10.O.D / G / N / R. Stripping the
// leading shebang line at transform time is the minimum-surface fix and lets
// tests round-trip the public API exports of those scripts.
const stripShebang = {
  name: "gemma-code:strip-shebang",
  enforce: "pre" as const,
  transform(code: string, id: string) {
    if (!id.endsWith(".mjs") && !id.endsWith(".cjs") && !id.endsWith(".js")) {
      return null;
    }
    if (!code.startsWith("#!")) return null;
    const nl = code.indexOf("\n");
    const stripped = nl >= 0 ? code.slice(nl + 1) : "";
    return { code: stripped, map: null };
  },
};

export default defineConfig({
  plugins: [stripShebang],
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
        "**/extension.ts",
        "src/utils/**",
      ],
      thresholds: {
        lines: 80,
        branches: 75,
      },
      reporter: ["text", "lcov", "json-summary"],
    },
  },
  resolve: {
    alias: {
      // Allow importing .js extensions that resolve to .ts sources
    },
  },
});
