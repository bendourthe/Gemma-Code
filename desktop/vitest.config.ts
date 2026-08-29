import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: [path.resolve(__dirname, "./tests/setup.ts")],
    include: ["tests/**/*.test.{ts,tsx}", "src/**/*.test.{ts,tsx}", "sidecar/src/**/*.test.ts"],
    // GitHub windows-latest Shell Build runs this suite with coverage across
    // ~200 files. Parallel workers starve PowerShell Add-Type in the live
    // process-host tests (empty stdout, timedOut, no ready.txt). Local Windows
    // keeps the default pool. This is runner config, not a workflow topology change.
    ...(process.env.CI && process.platform === "win32"
      ? { maxWorkers: 1, fileParallelism: false }
      : {}),
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "lcov"],
      include: ["src/**/*.{ts,tsx}", "sidecar/src/**/*.ts"],
      exclude: [
        "src/main.tsx",
        "src/App.tsx",
        "src/vite-env.d.ts",
        "**/*.test.{ts,tsx}",
        "**/*.types.ts",
        "**/types/**",
        "sidecar/src/main.ts",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
  },
});
