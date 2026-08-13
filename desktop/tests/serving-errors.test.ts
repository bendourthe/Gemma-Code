/**
 * v1.16.0 Phase 1.6 (adoption item A1) -- error mapping + leak prevention.
 *
 * The load-bearing assertions here are the sanitizer ones: an upstream failure
 * must not hand a caller the host's filesystem layout or a stack trace.
 */

import { describe, expect, it } from "vitest";

import {
  ServingHttpError,
  anthropicErrorBody,
  badRequest,
  notFound,
  openAiErrorBody,
  sanitizeMessage,
  toServingError,
  unauthorized,
} from "../sidecar/src/serving/errors";

describe("sanitizeMessage", () => {
  it("redacts a Windows absolute path", () => {
    const out = sanitizeMessage("failed reading C:\\Users\\bob\\.nexus\\models\\a.gguf");
    expect(out).not.toContain("Users");
    expect(out).toContain("[redacted]");
  });

  it("redacts a POSIX absolute path", () => {
    const out = sanitizeMessage("failed reading /home/bob/.nexus/models/a.gguf");
    expect(out).not.toContain("/home/bob");
    expect(out).toContain("[redacted]");
  });

  it("redacts a file:// URL", () => {
    expect(sanitizeMessage("open file:///etc/passwd failed")).not.toContain("passwd");
  });

  it("strips stack frames", () => {
    const out = sanitizeMessage("boom\n    at foo (bar.ts:1:1)\n    at baz (qux.ts:2:2)");
    expect(out).toBe("boom");
  });

  it("leaves a clean message intact", () => {
    expect(sanitizeMessage("Model \"m\" is not installed.")).toBe('Model "m" is not installed.');
  });
});

describe("toServingError", () => {
  it("passes a ServingHttpError through unchanged", () => {
    const original = notFound("nope", "model_not_found");
    expect(toServingError(original)).toBe(original);
  });

  it("maps an arbitrary Error to a sanitized 502", () => {
    const mapped = toServingError(new Error("connect ECONNREFUSED /tmp/ollama/sock"));
    expect(mapped.status).toBe(502);
    expect(mapped.message).not.toContain("/tmp/ollama");
  });

  it("maps a non-Error throw to a 502", () => {
    expect(toServingError("plain string").status).toBe(502);
  });
});

describe("openAiErrorBody", () => {
  it("emits the OpenAI error envelope", () => {
    const body = JSON.parse(openAiErrorBody(badRequest("bad thing", "invalid_body"))) as {
      error: { message: string; type: string; code: string | null };
    };
    expect(body.error).toEqual({
      message: "bad thing",
      type: "invalid_request_error",
      param: null,
      code: "invalid_body",
    });
  });

  it("sanitizes the message it renders", () => {
    const err = new ServingHttpError(502, "api_error", "failed at /home/bob/x/y.txt");
    expect(openAiErrorBody(err)).not.toContain("/home/bob");
  });
});

describe("anthropicErrorBody", () => {
  it("emits the Anthropic error envelope", () => {
    const body = JSON.parse(anthropicErrorBody(unauthorized())) as {
      type: string;
      error: { type: string; message: string };
    };
    expect(body.type).toBe("error");
    expect(body.error.type).toBe("authentication_error");
  });

  it.each([
    [400, "invalid_request_error"],
    [404, "not_found_error"],
    [413, "request_too_large"],
    [429, "rate_limit_error"],
    [502, "api_error"],
  ])("maps status %i to the Anthropic type %s", (status, expected) => {
    const err = new ServingHttpError(status, "api_error", "m");
    const body = JSON.parse(anthropicErrorBody(err)) as { error: { type: string } };
    expect(body.error.type).toBe(expected);
  });
});
