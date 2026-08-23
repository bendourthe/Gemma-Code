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

describe("v1.17.0 motion tokens", () => {
  it("defines durations, easings, and recede opacities", () => {
    expect(tokensCss).toContain("--motion-duration-fast:");
    expect(tokensCss).toContain("--motion-duration-base:");
    expect(tokensCss).toContain("--motion-duration-slow:");
    expect(tokensCss).toContain("--motion-ease-standard:");
    expect(tokensCss).toContain("--motion-ease-emphasized:");
    expect(tokensCss).toContain("--motion-ease-in-out:");
    expect(tokensCss).toContain("--motion-recede-opacity:");
    expect(tokensCss).toContain("--motion-recede-backdrop:");
  });

  it("aliases state accents to the locked palette and signature gradient", () => {
    expect(tokensCss).toContain("--motion-accent-coding: var(--accent-coding)");
    expect(tokensCss).toContain("--motion-accent-chatbot: var(--accent-chatbot)");
    expect(tokensCss).toContain("--motion-accent-image: var(--accent-image)");
    expect(tokensCss).toContain("--motion-accent-video: var(--accent-video)");
    expect(tokensCss).toContain("--motion-accent-signature: var(--grad-signature)");
  });

  it("maps motion tokens through Tailwind v4 @theme inline", () => {
    expect(tokensCss).toContain("@theme inline");
    expect(tokensCss).toContain("--duration-motion-fast: var(--motion-duration-fast)");
    expect(tokensCss).toContain("--duration-motion-base: var(--motion-duration-base)");
    expect(tokensCss).toContain("--duration-motion-slow: var(--motion-duration-slow)");
    expect(tokensCss).toContain("--ease-motion-standard: var(--motion-ease-standard)");
    expect(tokensCss).toContain("--color-motion-coding: var(--motion-accent-coding)");
    expect(tokensCss).toContain("--color-motion-chatbot: var(--motion-accent-chatbot)");
    expect(tokensCss).toContain("--color-motion-image: var(--motion-accent-image)");
    expect(tokensCss).toContain("--color-motion-video: var(--motion-accent-video)");
  });

  it("does not churn the locked accents or signature gradient", () => {
    expect(tokensCss).toContain("--accent-coding: #ec4899;");
    expect(tokensCss).toContain("--accent-chatbot: #22d3ee;");
    expect(tokensCss).toContain("--accent-image: #f97316;");
    expect(tokensCss).toContain("--accent-video: #22c55e;");
    expect(tokensCss).toContain("--grad-signature:");
  });
});

describe("v1.17.0 centralized reduced-motion CSS", () => {
  it("keeps a single prefers-reduced-motion media block", () => {
    const blocks = globalsCss.match(/@media \(prefers-reduced-motion: reduce\)/g);
    expect(blocks).toHaveLength(1);
  });

  it("halts floating-logo and aurora motion in that block", () => {
    expect(globalsCss).toMatch(/nexus-floating-logo\s*{\s*animation:\s*none;/);
    expect(globalsCss).toContain(".nexus-aurora-layer");
    expect(globalsCss).toContain("display: none");
    expect(globalsCss).toContain(".nexus-accent-beam::before");
  });
});

describe("v1.17.0 surface-liveness beam CSS", () => {
  it("declares the traveling angle property and both motion grammars", () => {
    expect(globalsCss).toContain("@property --nexus-beam-angle");
    expect(globalsCss).toContain("@keyframes nexus-beam-travel");
    expect(globalsCss).toContain("@keyframes nexus-beam-breathe");
    expect(globalsCss).toContain(".nexus-accent-beam");
  });
});

describe("v2.2.3 Phase 2 chrome CSS", () => {
  it("breathing no longer oscillates a 48deg conic wedge", () => {
    expect(globalsCss).not.toContain("--nexus-beam-angle: 48deg");
  });

  it("breathing paints a full-perimeter ring on a border-box ::before", () => {
    expect(globalsCss).toContain('[data-beam-mode="breathing"]::before');
    expect(globalsCss).toContain("box-sizing: border-box");
  });

  it("defines the liquid-glass nav-link selected state", () => {
    expect(globalsCss).toContain(".nexus-nav-link");
    expect(globalsCss).toContain('.nexus-nav-link[aria-current="page"]');
  });

  it("defines the shared glass icon button for studio actions", () => {
    expect(globalsCss).toContain(".nx-icon-btn");
  });

  it("does not put a border on .nexus-glass (the aside draws its own edge)", () => {
    const glassBlock = globalsCss.match(/\.nexus-glass\s*{[^}]*}/)?.[0] ?? "";
    expect(glassBlock).not.toContain("border:");
  });
});
