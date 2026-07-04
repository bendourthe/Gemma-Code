import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const tokensCss = readFileSync(
  path.resolve(__dirname, "../src/styles/tokens.css"),
  "utf-8",
);
const globalsCss = readFileSync(
  path.resolve(__dirname, "../src/styles/globals.css"),
  "utf-8",
);

describe("v1.9.0 glow-layer tokens", () => {
  it("defines the constellation node/link colors", () => {
    expect(tokensCss).toContain("--glow-cyan: #38bdf8;");
    expect(tokensCss).toContain("--glow-cyan-node: #7dd3fc;");
  });

  it("defines the three glow drop-shadow tokens", () => {
    expect(tokensCss).toContain("--glow-sm:");
    expect(tokensCss).toContain("--glow-md:");
    expect(tokensCss).toContain("--glow-lg:");
    expect(tokensCss).toContain("rgba(56, 189, 248, 0.5)");
  });

  it("defines the signature gradient and its soft variant", () => {
    expect(tokensCss).toContain("--grad-signature:");
    expect(tokensCss).toContain("--grad-signature-soft:");
    expect(tokensCss).toContain("#3b82f6 0%");
    expect(tokensCss).toContain("#22d3ee 100%");
  });

  it("defines the radial-glow background and deepest stop", () => {
    expect(tokensCss).toContain("--bg-deep: #010608;");
    expect(tokensCss).toContain("--bg-radial-glow:");
    expect(tokensCss).toContain("radial-gradient(");
  });

  it("does not churn the base palette", () => {
    // Additive-only: the v1.0.0 base tokens are still present untouched.
    expect(tokensCss).toContain("--bg-0: #0a0d14;");
    expect(tokensCss).toContain("--accent-chatbot: #22d3ee;");
  });
});

describe("floating-logo keyframes", () => {
  it("defines the nexus-float animation", () => {
    expect(globalsCss).toContain("@keyframes nexus-float");
    expect(globalsCss).toContain("translateY(-9px)");
    expect(globalsCss).toContain(".nexus-floating-logo");
  });

  it("disables the float under reduced motion", () => {
    expect(globalsCss).toContain("prefers-reduced-motion: reduce");
    expect(globalsCss).toMatch(/nexus-floating-logo\s*{\s*animation:\s*none;/);
  });
});
