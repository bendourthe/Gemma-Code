import { describe, it, expect, vi } from "vitest";
import {
  isBlockedIp,
  isSsrfBlockedSync,
  isSsrfBlocked,
  fetchWithSsrfGuard,
} from "../../../src/utils/ssrf.js";

describe("isBlockedIp", () => {
  it.each([
    ["127.0.0.1", true],
    ["127.255.255.254", true],
    ["169.254.169.254", true],
    ["10.0.0.1", true],
    ["172.16.5.5", true],
    ["172.31.0.1", true],
    ["192.168.1.1", true],
    ["0.0.0.0", true],
    ["::1", true],
    ["fe80::1", true],
    ["fc00::1", true],
    ["fd00::1", true],
    ["::", true],
    ["93.184.216.34", false],
    ["8.8.8.8", false],
    ["2001:4860:4860::8888", false],
  ])("returns %p for %s", (ip, expected) => {
    expect(isBlockedIp(ip)).toBe(expected);
  });
});

describe("isSsrfBlockedSync", () => {
  it("blocks malformed URLs", () => {
    expect(isSsrfBlockedSync("not a url")).toBe(true);
    expect(isSsrfBlockedSync("")).toBe(true);
  });

  it("blocks non-http(s) schemes", () => {
    expect(isSsrfBlockedSync("file:///etc/passwd")).toBe(true);
    expect(isSsrfBlockedSync("javascript:alert(1)")).toBe(true);
    expect(isSsrfBlockedSync("ftp://example.com")).toBe(true);
  });

  it("blocks well-known loopback hostnames", () => {
    expect(isSsrfBlockedSync("http://localhost/")).toBe(true);
    expect(isSsrfBlockedSync("http://ip6-localhost/")).toBe(true);
  });

  it("blocks literal private/loopback IPs", () => {
    expect(isSsrfBlockedSync("http://127.0.0.1/")).toBe(true);
    expect(isSsrfBlockedSync("http://192.168.1.1/")).toBe(true);
    expect(isSsrfBlockedSync("http://[::1]/")).toBe(true);
  });

  it("permits public hostnames (sync check only)", () => {
    expect(isSsrfBlockedSync("https://example.com/")).toBe(false);
    expect(isSsrfBlockedSync("http://93.184.216.34/")).toBe(false);
  });
});

describe("isSsrfBlocked (async with DNS)", () => {
  it("blocks when DNS resolves to a loopback IP (DNS rebinding guard)", async () => {
    const lookup = vi.fn(async () => ["127.0.0.1"]);
    expect(await isSsrfBlocked("http://rebind.example.com/", { lookup })).toBe(true);
  });

  it("blocks when DNS resolves to a private IP", async () => {
    const lookup = vi.fn(async () => ["10.0.0.42"]);
    expect(await isSsrfBlocked("http://internal.example.com/", { lookup })).toBe(true);
  });

  it("blocks when DNS resolves to IPv6 loopback", async () => {
    const lookup = vi.fn(async () => ["::1"]);
    expect(await isSsrfBlocked("http://rebind6.example.com/", { lookup })).toBe(true);
  });

  it("blocks when DNS lookup throws", async () => {
    const lookup = vi.fn(async () => {
      throw new Error("ENOTFOUND");
    });
    expect(await isSsrfBlocked("http://unreachable.example.com/", { lookup })).toBe(true);
  });

  it("blocks when DNS returns no addresses", async () => {
    const lookup = vi.fn(async () => [] as string[]);
    expect(await isSsrfBlocked("http://empty.example.com/", { lookup })).toBe(true);
  });

  it("permits when DNS resolves to a public IP", async () => {
    const lookup = vi.fn(async () => ["93.184.216.34"]);
    expect(await isSsrfBlocked("https://example.com/", { lookup })).toBe(false);
  });

  it("blocks if ANY resolved address is private (multi-answer)", async () => {
    const lookup = vi.fn(async () => ["93.184.216.34", "127.0.0.1"]);
    expect(await isSsrfBlocked("http://mixed.example.com/", { lookup })).toBe(true);
  });
});

describe("fetchWithSsrfGuard", () => {
  const publicLookup = async () => ["93.184.216.34"] as readonly string[];

  it("rejects the initial URL when SSRF check fails", async () => {
    const lookup = async () => ["127.0.0.1"] as readonly string[];
    await expect(
      fetchWithSsrfGuard("http://rebind.example.com/", { lookup }),
    ).rejects.toThrow(/SSRF/);
  });

  it("follows a safe redirect", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        status: 302,
        headers: new Map([["location", "https://target.example.com/next"]]),
      })
      .mockResolvedValueOnce({ status: 200, headers: new Map() });
    vi.stubGlobal("fetch", fetchMock);

    const res = await fetchWithSsrfGuard("https://example.com/start", { lookup: publicLookup });
    expect(res.status).toBe(200);
    vi.unstubAllGlobals();
  });

  it("blocks a redirect to a loopback target", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      status: 302,
      headers: new Map([["location", "http://127.0.0.1/internal"]]),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchWithSsrfGuard("https://example.com/redir", { lookup: publicLookup }),
    ).rejects.toThrow(/SSRF/);
    vi.unstubAllGlobals();
  });

  it("errors out when redirect chain exceeds max", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 302,
      headers: new Map([["location", "https://example.com/loop"]]),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchWithSsrfGuard("https://example.com/start", { lookup: publicLookup }),
    ).rejects.toThrow(/Too many redirects/);
    vi.unstubAllGlobals();
  });
});
