import { describe, expect, it } from "vitest";

import {
  AutoApproveForbiddenError,
  NO_AUTO_APPROVE_REASON,
  assertNoAutoApprove,
} from "../../../modules/coding/autonomy/noAutoApprove.js";

describe("assertNoAutoApprove", () => {
  it("allows a run that does not request auto-approve", () => {
    expect(() => assertNoAutoApprove({})).not.toThrow();
    expect(() => assertNoAutoApprove({ autoApprove: false })).not.toThrow();
  });

  it("refuses autoApprove, skipGate, and elevateTier", () => {
    expect(() => assertNoAutoApprove({ autoApprove: true })).toThrow(AutoApproveForbiddenError);
    expect(() => assertNoAutoApprove({ skipGate: true })).toThrow(NO_AUTO_APPROVE_REASON);
    expect(() => assertNoAutoApprove({ elevateTier: true })).toThrow(/elevateTier/);
  });
});
