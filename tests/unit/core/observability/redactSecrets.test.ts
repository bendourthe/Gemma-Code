import { describe, it, expect } from "vitest";
import {
  redactSecrets,
  detectSecretCategories,
} from "../../../../core/observability/redactSecrets.js";

/**
 * v1.1.0 Phase 4.4 -- secret redaction tests.
 *
 * Exercises every pattern in the redactor:
 *   * AWS access keys
 *   * GitHub PATs (classic + fine-grained)
 *   * Slack tokens
 *   * JWTs
 *   * PEM private-key blocks
 *   * env-style assignments
 *
 * Also verifies that benign content round-trips unchanged.
 */

const AWS_KEY = "AKIAIOSFODNN7EXAMPLE";
const GITHUB_PAT_CLASSIC = "ghp_" + "A".repeat(40);
const GITHUB_PAT_FINE = "github_pat_" + "B".repeat(82);
const SLACK_TOKEN = "xoxb-1234567890-abcdefghij";
const JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
const PEM = `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA...
-----END RSA PRIVATE KEY-----`;

describe("redactSecrets", () => {
  it("redacts AWS access keys", () => {
    const out = redactSecrets(`access_key=${AWS_KEY} hello`);
    expect(out).toContain("<redacted>");
    expect(out).not.toContain(AWS_KEY);
  });

  it("redacts classic GitHub PATs", () => {
    const out = redactSecrets(`token=${GITHUB_PAT_CLASSIC} suffix`);
    expect(out).toContain("<redacted>");
    expect(out).not.toContain(GITHUB_PAT_CLASSIC);
  });

  it("redacts fine-grained GitHub PATs", () => {
    const out = redactSecrets(`pat=${GITHUB_PAT_FINE} end`);
    expect(out).toContain("<redacted>");
    expect(out).not.toContain(GITHUB_PAT_FINE);
  });

  it("redacts Slack tokens", () => {
    const out = redactSecrets(`Authorization: Bearer ${SLACK_TOKEN}`);
    expect(out).toContain("<redacted>");
    expect(out).not.toContain(SLACK_TOKEN);
  });

  it("redacts JWTs", () => {
    const out = redactSecrets(`bearer ${JWT}`);
    expect(out).toContain("<redacted>");
    expect(out).not.toContain(JWT);
  });

  it("redacts PEM-formatted private keys (multi-line)", () => {
    const out = redactSecrets(`prefix\n${PEM}\nsuffix`);
    expect(out).toContain("<redacted>");
    expect(out).not.toContain("BEGIN RSA PRIVATE KEY");
    expect(out).toContain("prefix");
    expect(out).toContain("suffix");
  });

  it("redacts env-style assignments while keeping the variable name", () => {
    const out = redactSecrets("OPENAI_API_KEY=sk-abcdefghij1234567890");
    expect(out).toBe("OPENAI_API_KEY=<redacted>");
  });

  it("rejoins multiple patterns in the same string", () => {
    const blob = `aws=${AWS_KEY}\ngh=${GITHUB_PAT_CLASSIC}\njwt=${JWT}\nslack=${SLACK_TOKEN}`;
    const out = redactSecrets(blob);
    expect(out).not.toContain(AWS_KEY);
    expect(out).not.toContain(GITHUB_PAT_CLASSIC);
    expect(out).not.toContain(JWT);
    expect(out).not.toContain(SLACK_TOKEN);
    expect((out.match(/<redacted>/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it("passes benign content through unchanged", () => {
    const benign = "Hello world. This is a memory entry about TypeScript.";
    expect(redactSecrets(benign)).toBe(benign);
  });

  it("handles empty input", () => {
    expect(redactSecrets("")).toBe("");
  });

  it("detectSecretCategories enumerates which patterns fired", () => {
    const cats = detectSecretCategories(`aws=${AWS_KEY} jwt=${JWT}`);
    expect(cats).toContain("aws-access-key");
    expect(cats).toContain("jwt");
  });
});
