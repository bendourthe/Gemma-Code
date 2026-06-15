import { describe, it, expect } from "vitest";
import {
  detectPrimaryLanguage,
  loadLanguageRules,
  resolveLanguageRules,
  DEFAULT_MAX_RULE_CHARS,
} from "../../../modules/coding/chat/LanguageRuleBuilder.js";

describe("LanguageRuleBuilder.detectPrimaryLanguage (HUB.P3.RULES)", () => {
  const fakeExists = (present: string[]) => (p: string) =>
    present.some((f) => p.replace(/\\/g, "/").endsWith(f));

  it("detects go from go.mod", () => {
    expect(detectPrimaryLanguage("/ws", fakeExists(["go.mod"]))).toBe("go");
  });

  it("detects python from pyproject.toml / requirements.txt", () => {
    expect(detectPrimaryLanguage("/ws", fakeExists(["pyproject.toml"]))).toBe("python");
    expect(detectPrimaryLanguage("/ws", fakeExists(["requirements.txt"]))).toBe("python");
  });

  it("detects typescript from tsconfig.json", () => {
    expect(detectPrimaryLanguage("/ws", fakeExists(["tsconfig.json"]))).toBe("typescript");
  });

  it("prefers go over typescript when both markers exist (priority order)", () => {
    expect(detectPrimaryLanguage("/ws", fakeExists(["go.mod", "package.json"]))).toBe("go");
  });

  it("returns null when no marker is present or no workspace", () => {
    expect(detectPrimaryLanguage("/ws", fakeExists([]))).toBeNull();
    expect(detectPrimaryLanguage(undefined, fakeExists(["go.mod"]))).toBeNull();
  });
});

describe("LanguageRuleBuilder.loadLanguageRules", () => {
  it("concatenates the available rule files under a header", () => {
    const files: Record<string, string> = {
      "code-style.md": "# Style\nUse tabs.",
      "security.md": "# Security\nNo eval.",
      "testing.md": "# Testing\nUse pytest.",
    };
    const out = loadLanguageRules("/rules", "python", {
      readFile: (p) => {
        const base = p.replace(/\\/g, "/").split("/").pop()!;
        if (base in files) return files[base];
        throw new Error("ENOENT");
      },
    });
    expect(out).toContain("python project rules");
    expect(out).toContain("Use tabs.");
    expect(out).toContain("No eval.");
    expect(out).toContain("Use pytest.");
  });

  it("returns null when no rule files are readable", () => {
    const out = loadLanguageRules("/rules", "go", {
      readFile: () => {
        throw new Error("ENOENT");
      },
    });
    expect(out).toBeNull();
  });

  it("truncates to maxChars", () => {
    const big = "x".repeat(10_000);
    const out = loadLanguageRules("/rules", "typescript", {
      maxChars: 500,
      readFile: () => big,
    });
    expect(out).not.toBeNull();
    expect(out!.length).toBeLessThanOrEqual(520); // 500 + truncation marker
    expect(out).toContain("[rules truncated]");
  });

  it("default cap is the documented constant", () => {
    expect(DEFAULT_MAX_RULE_CHARS).toBe(6000);
  });
});

describe("LanguageRuleBuilder.resolveLanguageRules", () => {
  it("returns null when no rulesRoot is given", () => {
    expect(
      resolveLanguageRules({ workspacePath: "/ws", rulesRoot: undefined }),
    ).toBeNull();
  });

  it("returns null when the language is undetected", () => {
    expect(
      resolveLanguageRules({
        workspacePath: "/ws",
        rulesRoot: "/rules",
        existsSync: () => false,
      }),
    ).toBeNull();
  });

  it("resolves detected-language rules end to end", () => {
    const out = resolveLanguageRules({
      workspacePath: "/ws",
      rulesRoot: "/rules",
      existsSync: (p) => p.replace(/\\/g, "/").endsWith("go.mod"),
      readFile: (p) =>
        p.replace(/\\/g, "/").endsWith("code-style.md") ? "# Go\nUse gofmt." : (() => { throw new Error("ENOENT"); })(),
    });
    expect(out).toContain("go project rules");
    expect(out).toContain("Use gofmt.");
  });
});
