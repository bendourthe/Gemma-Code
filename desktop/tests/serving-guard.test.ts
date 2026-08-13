/**
 * v1.16.0 Phase 1.6 (adoption item A1) -- serving-gateway security guard.
 *
 * The three controls that make an inbound HTTP surface acceptable in a
 * local-first product: the loopback bind refusal, bearer-token auth, and the
 * request-size / concurrency caps.
 */

import { describe, expect, it } from "vitest";
import type { IncomingMessage } from "node:http";
import { PassThrough } from "node:stream";

import { ServingHttpError } from "../sidecar/src/serving/errors";
import {
  ConcurrencyLimiter,
  ServingBindError,
  assertLoopbackHost,
  checkBearerToken,
  isLoopbackHost,
  parseJsonBody,
  presentedToken,
  readLimitedBody,
} from "../sidecar/src/serving/guard";

describe("isLoopbackHost", () => {
  it.each(["127.0.0.1", "127.1.2.3", "localhost", "::1", "[::1]", "ip6-localhost"])(
    "accepts the loopback host %s",
    (host) => {
      expect(isLoopbackHost(host)).toBe(true);
    },
  );

  it.each(["0.0.0.0", "192.168.1.10", "10.0.0.5", "example.com", "8.8.8.8", ""])(
    "rejects the non-loopback host %s",
    (host) => {
      expect(isLoopbackHost(host)).toBe(false);
    },
  );
});

describe("assertLoopbackHost", () => {
  it("passes for a loopback host", () => {
    expect(() => assertLoopbackHost("127.0.0.1")).not.toThrow();
  });

  it("refuses a routable bind address and cites the local-first policy", () => {
    expect(() => assertLoopbackHost("0.0.0.0")).toThrow(ServingBindError);
    expect(() => assertLoopbackHost("0.0.0.0")).toThrow(/loopback/i);
  });

  it("refuses a LAN address even though it is private", () => {
    expect(() => assertLoopbackHost("192.168.1.50")).toThrow(ServingBindError);
  });
});

describe("presentedToken", () => {
  it("reads an Authorization bearer header", () => {
    expect(presentedToken({ authorization: "Bearer abc123" })).toBe("abc123");
  });

  it("is case-insensitive on the Bearer scheme", () => {
    expect(presentedToken({ authorization: "bearer abc123" })).toBe("abc123");
  });

  it("reads the Anthropic x-api-key header", () => {
    expect(presentedToken({ "x-api-key": "abc123" })).toBe("abc123");
  });

  it("returns null with no credential", () => {
    expect(presentedToken({})).toBeNull();
  });
});

describe("checkBearerToken", () => {
  it("accepts the correct token via either header", () => {
    expect(() => checkBearerToken({ authorization: "Bearer secret" }, "secret")).not.toThrow();
    expect(() => checkBearerToken({ "x-api-key": "secret" }, "secret")).not.toThrow();
  });

  it("rejects a missing token with 401", () => {
    try {
      checkBearerToken({}, "secret");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ServingHttpError);
      expect((err as ServingHttpError).status).toBe(401);
    }
  });

  it("rejects a wrong token with 401", () => {
    try {
      checkBearerToken({ authorization: "Bearer nope" }, "secret");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as ServingHttpError).status).toBe(401);
    }
  });

  it("rejects a token that is a prefix of the real one", () => {
    expect(() => checkBearerToken({ authorization: "Bearer sec" }, "secret")).toThrow(
      ServingHttpError,
    );
  });
});

/** Build a minimal `IncomingMessage`-alike backed by a real stream. */
function fakeRequest(body: string, headers: Record<string, string> = {}): IncomingMessage {
  const stream = new PassThrough();
  const req = stream as unknown as IncomingMessage & { destroy(): void };
  (req as unknown as { headers: Record<string, string> }).headers = headers;
  setImmediate(() => {
    stream.write(body);
    stream.end();
  });
  return req;
}

describe("readLimitedBody", () => {
  it("reads a body under the limit", async () => {
    await expect(readLimitedBody(fakeRequest('{"a":1}'), 1024)).resolves.toBe('{"a":1}');
  });

  it("rejects a declared content-length over the limit before reading", async () => {
    const req = fakeRequest("x", { "content-length": "5000" });
    await expect(readLimitedBody(req, 1024)).rejects.toThrow(/exceeds/i);
  });

  it("rejects a streamed body that grows past the limit", async () => {
    await expect(readLimitedBody(fakeRequest("x".repeat(2048)), 1024)).rejects.toMatchObject({
      status: 413,
    });
  });
});

describe("parseJsonBody", () => {
  it("parses valid JSON", () => {
    expect(parseJsonBody('{"model":"m"}')).toEqual({ model: "m" });
  });

  it("treats an empty body as an empty object", () => {
    expect(parseJsonBody("   ")).toEqual({});
  });

  it("maps malformed JSON to a 400", () => {
    try {
      parseJsonBody("{not json");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as ServingHttpError).status).toBe(400);
    }
  });
});

describe("ConcurrencyLimiter", () => {
  it("allows up to the limit and then rejects with 429", () => {
    const limiter = new ConcurrencyLimiter(2);
    const a = limiter.acquire();
    limiter.acquire();
    expect(limiter.inFlight).toBe(2);
    try {
      limiter.acquire();
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as ServingHttpError).status).toBe(429);
    }
    a();
    expect(limiter.inFlight).toBe(1);
    expect(() => limiter.acquire()).not.toThrow();
  });

  it("is idempotent on release", () => {
    const limiter = new ConcurrencyLimiter(1);
    const release = limiter.acquire();
    release();
    release();
    expect(limiter.inFlight).toBe(0);
  });
});
