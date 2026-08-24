import { describe, expect, it } from "vitest";

import {
  formatSandboxViolationError,
  isSandboxViolation,
} from "../../../modules/coding/sandbox/violation.js";
import { SANDBOX_APPLY_FAILURE_EXIT } from "../../../modules/coding/sandbox/types.js";

describe("isSandboxViolation", () => {
  it("never classifies unconfined failures as sandbox denials", () => {
    expect(
      isSandboxViolation({
        mode: "unconfined",
        exitCode: 1,
        stderr: "Permission denied",
      }),
    ).toBe(false);
  });

  it("classifies apply-failure exit 125 and seatbelt markers", () => {
    expect(
      isSandboxViolation({
        mode: "confined",
        exitCode: SANDBOX_APPLY_FAILURE_EXIT,
        stderr: "",
      }),
    ).toBe(true);
    expect(
      isSandboxViolation({
        mode: "confined",
        exitCode: 1,
        stderr: "sandbox-exec: deny file-write*",
      }),
    ).toBe(true);
  });
});

describe("formatSandboxViolationError", () => {
  it("is a classified tool error, not a crash dump", () => {
    const err = formatSandboxViolationError("touch /etc/passwd", "Operation not permitted", 1);
    expect(err).toMatch(/OS sandbox denied/);
    expect(err).toMatch(/touch \/etc\/passwd/);
  });
});
