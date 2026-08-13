/**
 * v1.16.0 Phase 1.6 (adoption item A1) -- serving-gateway config resolution.
 *
 * Covers the opt-in default (OFF), the settings-over-env-over-default precedence
 * chain, and the generate-and-persist token behavior that makes a copied token
 * survive an app restart.
 */

import { describe, expect, it } from "vitest";

import { InMemorySettingsStore } from "../../core/storage/SettingsStore";
import {
  DEFAULT_SERVING_HOST,
  DEFAULT_SERVING_PORT,
  SERVING_KEYS,
  generateServingToken,
  redactToken,
  resolveServingConfig,
  servingBaseUrl,
} from "../sidecar/src/serving/config";

const NO_ENV: NodeJS.ProcessEnv = {};

describe("resolveServingConfig", () => {
  it("defaults to disabled on loopback with no settings and no env", async () => {
    const settings = new InMemorySettingsStore();
    const config = await resolveServingConfig({
      settings,
      env: NO_ENV,
      generateToken: () => "tok",
    });
    expect(config.enabled).toBe(false);
    expect(config.host).toBe(DEFAULT_SERVING_HOST);
    expect(config.port).toBe(DEFAULT_SERVING_PORT);
  });

  it("generates and persists a token when none is configured", async () => {
    const settings = new InMemorySettingsStore();
    const config = await resolveServingConfig({
      settings,
      env: NO_ENV,
      generateToken: () => "generated-token",
    });
    expect(config.token).toBe("generated-token");
    expect(await settings.get<string>(SERVING_KEYS.token)).toBe("generated-token");
  });

  it("reuses the persisted token on a later resolve", async () => {
    const settings = new InMemorySettingsStore();
    await settings.set(SERVING_KEYS.token, "already-stored");
    const config = await resolveServingConfig({
      settings,
      env: NO_ENV,
      generateToken: () => "should-not-be-used",
    });
    expect(config.token).toBe("already-stored");
  });

  it("prefers stored settings over environment variables", async () => {
    const settings = new InMemorySettingsStore();
    await settings.set(SERVING_KEYS.enabled, true);
    await settings.set(SERVING_KEYS.port, 12345);
    const config = await resolveServingConfig({
      settings,
      env: { NEXUS_SERVING_ENABLED: "0", NEXUS_SERVING_PORT: "9999" },
      generateToken: () => "tok",
    });
    expect(config.enabled).toBe(true);
    expect(config.port).toBe(12345);
  });

  it("falls back to environment variables when nothing is stored", async () => {
    const config = await resolveServingConfig({
      settings: new InMemorySettingsStore(),
      env: {
        NEXUS_SERVING_ENABLED: "true",
        NEXUS_SERVING_HOST: "127.0.0.5",
        NEXUS_SERVING_PORT: "11600",
        NEXUS_SERVING_TOKEN: "env-token",
      },
      generateToken: () => "unused",
    });
    expect(config).toEqual({
      enabled: true,
      host: "127.0.0.5",
      port: 11600,
      token: "env-token",
    });
  });

  it("ignores an out-of-range env port and uses the default", async () => {
    const config = await resolveServingConfig({
      settings: new InMemorySettingsStore(),
      env: { NEXUS_SERVING_PORT: "70000" },
      generateToken: () => "tok",
    });
    expect(config.port).toBe(DEFAULT_SERVING_PORT);
  });

  it("degrades to an in-memory token when the settings store cannot be written", async () => {
    const settings = new InMemorySettingsStore();
    settings.set = async () => {
      throw new Error("read-only settings file");
    };
    const config = await resolveServingConfig({
      settings,
      env: NO_ENV,
      generateToken: () => "ephemeral",
    });
    expect(config.token).toBe("ephemeral");
  });
});

describe("generateServingToken", () => {
  it("produces distinct, URL-safe, high-entropy tokens", () => {
    const a = generateServingToken();
    const b = generateServingToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThanOrEqual(32);
  });
});

describe("servingBaseUrl", () => {
  it("renders an IPv4 loopback base URL", () => {
    expect(servingBaseUrl({ host: "127.0.0.1", port: 11500 })).toBe("http://127.0.0.1:11500/v1");
  });

  it("brackets an IPv6 host", () => {
    expect(servingBaseUrl({ host: "::1", port: 11500 })).toBe("http://[::1]:11500/v1");
  });
});

describe("redactToken", () => {
  it("keeps only the last four characters", () => {
    expect(redactToken("abcdefghij")).toBe("****ghij");
  });

  it("fully masks a short token", () => {
    expect(redactToken("abc")).toBe("****");
  });
});
