import { afterEach, describe, expect, it } from "vitest";

import { isExecSandboxEnabled, parseExecSandboxEnv } from "../../../modules/coding/sandbox/enabled.js";

describe("parseExecSandboxEnv", () => {
  it("accepts common truthy and falsy tokens", () => {
    expect(parseExecSandboxEnv("1")).toBe(true);
    expect(parseExecSandboxEnv("true")).toBe(true);
    expect(parseExecSandboxEnv("ON")).toBe(true);
    expect(parseExecSandboxEnv("0")).toBe(false);
    expect(parseExecSandboxEnv("false")).toBe(false);
    expect(parseExecSandboxEnv("off")).toBe(false);
    expect(parseExecSandboxEnv(undefined)).toBeUndefined();
    expect(parseExecSandboxEnv("maybe")).toBeUndefined();
  });
});

describe("isExecSandboxEnabled", () => {
  const prev = process.env.NEXUS_EXEC_SANDBOX;

  afterEach(() => {
    if (prev === undefined) delete process.env.NEXUS_EXEC_SANDBOX;
    else process.env.NEXUS_EXEC_SANDBOX = prev;
  });

  it("defaults off when env and vscode are unset", () => {
    delete process.env.NEXUS_EXEC_SANDBOX;
    expect(isExecSandboxEnabled()).toBe(false);
    expect(isExecSandboxEnabled(false)).toBe(false);
  });

  it("honors the vscode value only when env is unset", () => {
    delete process.env.NEXUS_EXEC_SANDBOX;
    expect(isExecSandboxEnabled(true)).toBe(true);
  });

  it("lets the env var override vscode", () => {
    process.env.NEXUS_EXEC_SANDBOX = "0";
    expect(isExecSandboxEnabled(true)).toBe(false);
    process.env.NEXUS_EXEC_SANDBOX = "1";
    expect(isExecSandboxEnabled(false)).toBe(true);
  });
});
