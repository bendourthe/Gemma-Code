import { describe, expect, it } from "vitest";

import {
  formatChatTurnError,
  formatInferenceError,
  isSidecarTimeoutCopy,
  LOCAL_INFERENCE_TIMEOUT_COPY,
} from "../src/lib/inferenceRpcError";

describe("formatInferenceError", () => {
  it("rewrites sidecar response timeout into typed local-model copy", () => {
    expect(isSidecarTimeoutCopy("sidecar response timeout")).toBe(true);
    expect(formatInferenceError(new Error("sidecar response timeout"))).toBe(
      LOCAL_INFERENCE_TIMEOUT_COPY,
    );
    expect(formatInferenceError("Local model did not finish in time. Check Ollama.")).toBe(
      LOCAL_INFERENCE_TIMEOUT_COPY,
    );
  });

  it("passes through a typed Ollama runtime error", () => {
    expect(formatInferenceError(new Error("ollama: connection refused"))).toBe(
      "ollama: connection refused",
    );
  });
});

describe("formatChatTurnError", () => {
  it("does not prefix sidecar timeout with chat unavailable", () => {
    const copy = formatChatTurnError(new Error("sidecar response timeout"));
    expect(copy).toBe(LOCAL_INFERENCE_TIMEOUT_COPY);
    expect(copy).not.toMatch(/sidecar response timeout/i);
    expect(copy).not.toMatch(/chat unavailable/i);
  });

  it("keeps chat unavailable for ipc-unavailable", () => {
    expect(formatChatTurnError(new Error("ipc-unavailable"))).toMatch(/chat unavailable/);
  });

  it("surfaces a typed Ollama error without the sidecar timeout string", () => {
    const copy = formatChatTurnError(new Error("ECONNREFUSED 127.0.0.1:11434"));
    expect(copy).toMatch(/ECONNREFUSED/);
    expect(copy).not.toMatch(/sidecar response timeout/i);
  });
});
