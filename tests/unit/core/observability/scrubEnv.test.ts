import { describe, it, expect } from "vitest";
import {
  isSensitiveEnvName,
  valueLooksLikeSecret,
  scrubEnv,
} from "../../../../core/observability/scrubEnv.js";

describe("isSensitiveEnvName (A5)", () => {
  it.each([
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "APIKEY",
    "GITHUB_TOKEN",
    "NPM_TOKEN",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_ACCESS_KEY_ID",
    "AWS_SESSION_TOKEN",
    "DATABASE_PASSWORD",
    "DB_PASSWD",
    "GCP_CREDENTIALS",
    "GPG_PRIVATE_KEY",
    "STRIPE_KEY",
    "SSH_KEY",
    "KEY",
  ])("flags %s as sensitive", (name) => {
    expect(isSensitiveEnvName(name)).toBe(true);
  });

  it.each([
    "PATH",
    "HOME",
    "PWD",
    "OLDPWD",
    "SHELL",
    "LANG",
    "TERM",
    "USER",
    "NODE_ENV",
    "SSH_AUTH_SOCK",
    "NUMBER_OF_PROCESSORS",
    "MONKEY_BUSINESS",
  ])("does not flag benign name %s", (name) => {
    expect(isSensitiveEnvName(name)).toBe(false);
  });

  it("is case-insensitive on the variable name", () => {
    expect(isSensitiveEnvName("my_secret")).toBe(true);
  });
});

describe("valueLooksLikeSecret (A5)", () => {
  it("detects an AWS access key shape", () => {
    expect(valueLooksLikeSecret("AKIAIOSFODNN7EXAMPLE")).toBe(true);
  });

  it("detects a GitHub PAT shape", () => {
    expect(valueLooksLikeSecret("ghp_" + "a".repeat(36))).toBe(true);
  });

  it("treats a plain value as non-secret", () => {
    expect(valueLooksLikeSecret("/usr/local/bin:/usr/bin")).toBe(false);
    expect(valueLooksLikeSecret("")).toBe(false);
    expect(valueLooksLikeSecret("development")).toBe(false);
  });
});

describe("scrubEnv (A5)", () => {
  it("drops variables with a secret-bearing name", () => {
    const out = scrubEnv({
      PATH: "/usr/bin",
      OPENAI_API_KEY: "sk-secret",
      GITHUB_TOKEN: "tok",
      HOME: "/home/dev",
    });
    expect(out.PATH).toBe("/usr/bin");
    expect(out.HOME).toBe("/home/dev");
    expect(out.OPENAI_API_KEY).toBeUndefined();
    expect(out.GITHUB_TOKEN).toBeUndefined();
  });

  it("drops innocuously-named variables whose value looks like a secret", () => {
    const out = scrubEnv({
      INNOCENT_VAR: "AKIAIOSFODNN7EXAMPLE",
      GREETING: "hello",
    });
    expect(out.INNOCENT_VAR).toBeUndefined();
    expect(out.GREETING).toBe("hello");
  });

  it("passes an allowlisted variable through despite a sensitive name", () => {
    const out = scrubEnv(
      { OPENAI_API_KEY: "sk-secret", AWS_SECRET_ACCESS_KEY: "x" },
      { allowlist: ["OPENAI_API_KEY"] },
    );
    expect(out.OPENAI_API_KEY).toBe("sk-secret");
    expect(out.AWS_SECRET_ACCESS_KEY).toBeUndefined();
  });

  it("matches the allowlist case-sensitively", () => {
    const out = scrubEnv(
      { MY_TOKEN: "x" },
      { allowlist: ["my_token"] },
    );
    expect(out.MY_TOKEN).toBeUndefined();
  });

  it("drops undefined-valued variables", () => {
    const out = scrubEnv({ PRESENT: "1", ABSENT: undefined });
    expect(out.PRESENT).toBe("1");
    expect("ABSENT" in out).toBe(false);
  });

  it("does not mutate the input environment", () => {
    const base = { OPENAI_API_KEY: "sk-secret", PATH: "/bin" };
    scrubEnv(base);
    expect(base.OPENAI_API_KEY).toBe("sk-secret");
  });

  it("returns a benign environment unchanged in content", () => {
    const out = scrubEnv({ PATH: "/bin", LANG: "en_US.UTF-8" });
    expect(out).toEqual({ PATH: "/bin", LANG: "en_US.UTF-8" });
  });
});
