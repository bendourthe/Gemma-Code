/**
 * v0.9.0 Phase 4 sub-task 4.4 -- unit tests for `scripts/work.mjs`.
 *
 * The dispatcher's I/O surface (gh, git, clipboard, agent spawn) is exercised
 * separately as part of the Phase 4.5 manual smoke. These tests cover the
 * pure functions:
 *
 *   - `parseArgs` (positional, --agent, --no-checkout, --help).
 *   - `slugify` and `deriveBranchName` (the 40-char cap + non-alphanum
 *     collapse + trailing-dash trim).
 *   - `buildAgentPrompt` (includes title, body, link, labels, conventions).
 *   - `main([... --help])` exits 0 and prints usage.
 */

import { describe, it, expect } from "vitest";

import {
  parseArgs,
  slugify,
  deriveBranchName,
  buildAgentPrompt,
  main,
} from "../../../scripts/work.mjs";

describe("parseArgs", () => {
  it("captures the issue number from the first positional", () => {
    const args = parseArgs(["42"]);
    expect(args.issue).toBe(42);
    expect(args.extraPrompt).toBe("");
    expect(args.noCheckout).toBe(false);
    expect(args.agent).toBe(null);
  });

  it("captures an extra prompt after the issue number", () => {
    const args = parseArgs(["42", "focus", "on", "auth"]);
    expect(args.issue).toBe(42);
    expect(args.extraPrompt).toBe("focus on auth");
  });

  it("recognizes --no-checkout", () => {
    const args = parseArgs(["42", "--no-checkout"]);
    expect(args.noCheckout).toBe(true);
  });

  it("recognizes --agent <name> and --agent=<name>", () => {
    expect(parseArgs(["42", "--agent", "claude"]).agent).toBe("claude");
    expect(parseArgs(["42", "--agent=codex"]).agent).toBe("codex");
  });

  it("flags --help", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["-h"]).help).toBe(true);
  });
});

describe("slugify", () => {
  it("lowercases, replaces non-alphanum with dashes, trims dashes", () => {
    expect(slugify("Hello, World!")).toBe("hello-world");
  });

  it("caps to 40 characters and trims any trailing dash", () => {
    const long = "A".repeat(60) + " name";
    const out = slugify(long);
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out.endsWith("-")).toBe(false);
  });

  it("falls back to `issue` when input collapses to empty", () => {
    expect(slugify("!@#$%")).toBe("issue");
    expect(slugify("")).toBe("issue");
    expect(slugify(null)).toBe("issue");
  });
});

describe("deriveBranchName", () => {
  it("produces feat/issue-<num>-<slug>", () => {
    expect(deriveBranchName(42, "Add cool feature")).toBe(
      "feat/issue-42-add-cool-feature",
    );
  });

  it("works with very long titles", () => {
    const name = deriveBranchName(
      7,
      "An extraordinarily verbose title that absolutely will not fit",
    );
    expect(name.startsWith("feat/issue-7-")).toBe(true);
    // Slug portion capped at 40 chars.
    const slug = name.slice("feat/issue-7-".length);
    expect(slug.length).toBeLessThanOrEqual(40);
  });
});

describe("buildAgentPrompt", () => {
  const baseIssue = {
    number: 42,
    title: "Wire reflect worker into scheduler",
    body: "We need to wire ReflectJob into the idle scheduler.",
    url: "https://github.com/bendourthe/Gemma-Code/issues/42",
    labels: [{ name: "phase-6" }, { name: "memory" }],
    state: "OPEN",
  };

  it("includes the title, number, link, and body verbatim", () => {
    const prompt = buildAgentPrompt({ issue: baseIssue, extraPrompt: "" });
    expect(prompt).toContain("#42");
    expect(prompt).toContain("Wire reflect worker into scheduler");
    expect(prompt).toContain(baseIssue.url);
    expect(prompt).toContain("We need to wire ReflectJob");
  });

  it("includes labels joined by commas", () => {
    const prompt = buildAgentPrompt({ issue: baseIssue, extraPrompt: "" });
    expect(prompt).toMatch(/Labels:\s+phase-6,\s+memory/);
  });

  it("appends the extra prompt when provided", () => {
    const prompt = buildAgentPrompt({
      issue: baseIssue,
      extraPrompt: "make the cadence configurable",
    });
    expect(prompt).toContain("Additional context:");
    expect(prompt).toContain("make the cadence configurable");
  });

  it("includes the Gemma-Code conventions reminder", () => {
    const prompt = buildAgentPrompt({ issue: baseIssue, extraPrompt: "" });
    expect(prompt).toContain("Strict TypeScript");
    expect(prompt).toContain("Zod");
    expect(prompt).toContain("500 lines");
    expect(prompt).toContain("ASCII-only");
    expect(prompt).toContain("ADR");
  });

  it("handles plain-string label arrays", () => {
    const issue = { ...baseIssue, labels: ["bug", "p1"] };
    const prompt = buildAgentPrompt({ issue, extraPrompt: "" });
    expect(prompt).toMatch(/Labels:\s+bug,\s+p1/);
  });

  it("handles missing labels / body / url gracefully", () => {
    const issue = { number: 9, title: "tiny", body: null, url: null, labels: null };
    const prompt = buildAgentPrompt({ issue, extraPrompt: "" });
    expect(prompt).toContain("#9");
    expect(prompt).toContain("tiny");
    expect(prompt).toContain("(empty)");
  });
});

describe("main", () => {
  it("prints usage on --help and exits 0", async () => {
    const written: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    // @ts-expect-error -- monkey-patch
    process.stdout.write = (chunk: string) => {
      written.push(String(chunk));
      return true;
    };
    try {
      const code = await main(["node", "work.mjs", "--help"]);
      expect(code).toBe(0);
      expect(written.join("")).toMatch(/gemma-code work runner/);
    } finally {
      // @ts-expect-error -- restore
      process.stdout.write = orig;
    }
  });

  it("returns non-zero and prints usage when no issue is given", async () => {
    const written: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    // @ts-expect-error -- monkey-patch
    process.stdout.write = (chunk: string) => {
      written.push(String(chunk));
      return true;
    };
    try {
      const code = await main(["node", "work.mjs"]);
      expect(code).toBe(2);
      expect(written.join("")).toMatch(/gemma-code work runner/);
    } finally {
      // @ts-expect-error -- restore
      process.stdout.write = orig;
    }
  });
});
