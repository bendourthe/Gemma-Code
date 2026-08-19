import { describe, it, expect, vi, afterEach } from "vitest";
import {
  isBlockedIp,
  isSsrfBlockedSync,
  isSsrfBlocked,
  fetchWithSsrfGuard,
  pinValidatedUrl,
  isDeniedDestination,
  configureDeniedDestinations,
  resetDeniedDestinations,
  getDeniedDestinations,
  DEFAULT_DENIED_DESTINATIONS,
} from "../../../modules/coding/utils/ssrf.js";

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

  it("pins the first DNS answer so a rebinding resolver never reaches the private IP", async () => {
    let lookups = 0;
    const lookup = vi.fn(async () => {
      lookups += 1;
      return lookups === 1 ? (["8.8.8.8"] as string[]) : (["127.0.0.1"] as string[]);
    });
    const contacted: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      contacted.push(String(input));
      return { status: 200, headers: new Map() } as Response;
    });

    const res = await fetchWithSsrfGuard("https://rebind.example.com/x", {
      lookup,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(res.status).toBe(200);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(contacted).toHaveLength(1);
    expect(contacted[0]).toContain("8.8.8.8");
    expect(contacted[0]).not.toContain("127.0.0.1");
    expect(contacted[0]).not.toContain("rebind.example.com");
  });

  it("pinValidatedUrl returns null for a private resolution", async () => {
    const lookup = async () => ["10.0.0.1"] as const;
    expect(await pinValidatedUrl("https://internal.example.com/", { lookup })).toBeNull();
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

// ---------------------------------------------------------------------------
// v1.4.0 Phase 2 (A4) -- egress denylist
// ---------------------------------------------------------------------------

describe("egress denylist (A4)", () => {
  // Clear any runtime-configured additions so cross-test state never leaks.
  afterEach(() => {
    resetDeniedDestinations();
  });

  const cloudMetadata = [
    "169.254.169.254",
    "metadata.google.internal",
    "metadata.azure.com",
  ];
  const pasteHosts = [
    "pastebin.com",
    "transfer.sh",
    "0x0.st",
    "paste.ee",
    "termbin.com",
    "ix.io",
  ];

  it("ships the cloud-metadata and paste-host defaults", () => {
    for (const host of [...cloudMetadata, ...pasteHosts]) {
      expect(DEFAULT_DENIED_DESTINATIONS).toContain(host);
    }
  });

  describe("isDeniedDestination", () => {
    it.each([...cloudMetadata, ...pasteHosts])("denies %s exactly", (host) => {
      expect(isDeniedDestination(host)).toBe(true);
    });

    it("denies sub-domains of a denied apex domain", () => {
      expect(isDeniedDestination("www.pastebin.com")).toBe(true);
      expect(isDeniedDestination("raw.pastebin.com")).toBe(true);
    });

    it("is case- and bracket-insensitive", () => {
      expect(isDeniedDestination("PASTEBIN.COM")).toBe(true);
    });

    it("does not deny a public host", () => {
      expect(isDeniedDestination("example.com")).toBe(false);
      expect(isDeniedDestination("notpastebin.com")).toBe(false);
    });
  });

  describe("isSsrfBlockedSync blocks denied destinations (no DNS)", () => {
    it.each([...cloudMetadata, ...pasteHosts])("blocks https://%s/", (host) => {
      expect(isSsrfBlockedSync(`https://${host}/path`)).toBe(true);
    });

    it("blocks a denied sub-domain", () => {
      expect(isSsrfBlockedSync("https://raw.pastebin.com/abc")).toBe(true);
    });

    it("still permits a public host", () => {
      expect(isSsrfBlockedSync("https://example.com/")).toBe(false);
    });
  });

  describe("isSsrfBlocked blocks denied destinations even when DNS is public", () => {
    const publicLookup = async () => ["93.184.216.34"] as readonly string[];

    it.each(pasteHosts)("blocks %s although it resolves publicly", async (host) => {
      expect(await isSsrfBlocked(`https://${host}/`, { lookup: publicLookup })).toBe(true);
    });

    it("blocks the GCP metadata hostname by name (not just by resolved IP)", async () => {
      expect(
        await isSsrfBlocked("http://metadata.google.internal/computeMetadata/v1/", {
          lookup: publicLookup,
        }),
      ).toBe(true);
    });
  });

  describe("post-redirect enforcement via fetchWithSsrfGuard", () => {
    const publicLookup = async () => ["93.184.216.34"] as readonly string[];

    it("blocks a redirect that targets a denied paste host", async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce({
        status: 302,
        headers: new Map([["location", "https://pastebin.com/raw/abc"]]),
      });
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        fetchWithSsrfGuard("https://example.com/redir", { lookup: publicLookup }),
      ).rejects.toThrow(/SSRF/);
      vi.unstubAllGlobals();
    });
  });

  describe("extensibility", () => {
    const publicLookup = async () => ["93.184.216.34"] as readonly string[];

    it("blocks a runtime-configured extra destination", () => {
      expect(isSsrfBlockedSync("https://evil.test/")).toBe(false);
      configureDeniedDestinations(["evil.test"]);
      expect(isDeniedDestination("evil.test")).toBe(true);
      expect(isSsrfBlockedSync("https://evil.test/")).toBe(true);
      expect(isSsrfBlockedSync("https://sub.evil.test/")).toBe(true);
      expect(getDeniedDestinations()).toContain("evil.test");
    });

    it("resets runtime additions without disturbing the defaults", () => {
      configureDeniedDestinations(["evil.test"]);
      resetDeniedDestinations();
      expect(isDeniedDestination("evil.test")).toBe(false);
      expect(isDeniedDestination("pastebin.com")).toBe(true);
    });

    it("normalizes and drops empty configured entries", () => {
      configureDeniedDestinations(["  EVIL.TEST  ", ""]);
      expect(isDeniedDestination("evil.test")).toBe(true);
    });

    it("honors a per-call deniedDestinations option (sync)", () => {
      expect(isSsrfBlockedSync("https://once.test/", { deniedDestinations: ["once.test"] })).toBe(
        true,
      );
      // The per-call option does not persist.
      expect(isSsrfBlockedSync("https://once.test/")).toBe(false);
    });

    it("honors a per-call deniedDestinations option on every redirect hop", async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce({
        status: 302,
        headers: new Map([["location", "https://hop.test/next"]]),
      });
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        fetchWithSsrfGuard("https://example.com/start", {
          lookup: publicLookup,
          deniedDestinations: ["hop.test"],
        }),
      ).rejects.toThrow(/SSRF/);
      vi.unstubAllGlobals();
    });
  });
});
