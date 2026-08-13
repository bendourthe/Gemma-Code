// v1.16.0 Phase 1.6 (adoption item A1) -- the shared loopback predicate.
//
// This module is the single definition of "local" for BOTH the outbound
// local-adapter registry and the inbound serving gateway's bind check, so it is
// tested directly here (LocalAdapterRegistry.test.ts covers it through the
// manifest path, and the desktop suite covers it through the bind path).

import { describe, expect, it } from "vitest";

import { isLoopbackEndpoint, isLoopbackHost } from "../../../modules/coding/llm/loopback.js";
import { isLoopbackEndpoint as reExported } from "../../../modules/coding/llm/LocalAdapterRegistry.js";

describe("isLoopbackEndpoint", () => {
  it.each([
    "http://127.0.0.1:11434",
    "http://127.1.2.3",
    "https://localhost:1234",
    "http://[::1]:8080",
    "http://ip6-localhost",
    "http://ip6-loopback",
  ])("accepts %s", (url) => {
    expect(isLoopbackEndpoint(url)).toBe(true);
  });

  it.each([
    "http://0.0.0.0:11434",
    "http://192.168.1.10",
    "http://10.0.0.5",
    "http://172.16.0.1",
    "http://example.com",
    "http://8.8.8.8",
    "ftp://127.0.0.1",
    "file:///etc/passwd",
    "not a url",
    "",
  ])("rejects %s", (url) => {
    expect(isLoopbackEndpoint(url)).toBe(false);
  });

  it("is case-insensitive on the hostname", () => {
    expect(isLoopbackEndpoint("http://LOCALHOST:1234")).toBe(true);
  });
});

describe("isLoopbackHost", () => {
  it.each(["127.0.0.1", "localhost", "::1", "[::1]", " 127.0.0.1 "])("accepts %s", (host) => {
    expect(isLoopbackHost(host)).toBe(true);
  });

  it.each(["0.0.0.0", "192.168.0.2", "example.com", "", "   "])("rejects %s", (host) => {
    expect(isLoopbackHost(host)).toBe(false);
  });
});

describe("LocalAdapterRegistry re-export", () => {
  it("re-exports the same function, so inbound and outbound rules cannot drift", () => {
    expect(reExported).toBe(isLoopbackEndpoint);
  });
});
