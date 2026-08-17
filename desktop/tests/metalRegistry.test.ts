import { afterEach, describe, expect, it } from "vitest";
import {
  METAL_INSTANCE_CAP,
  metalActiveCount,
  releaseMetalSlot,
  resetMetalRegistry,
  tryAcquireMetalSlot,
} from "../src/components/metalRegistry";

afterEach(() => {
  resetMetalRegistry();
});

describe("metalRegistry", () => {
  it("lets three instances acquire and denies the fourth", () => {
    expect(METAL_INSTANCE_CAP).toBe(3);
    expect(tryAcquireMetalSlot()).toBe(true);
    expect(tryAcquireMetalSlot()).toBe(true);
    expect(tryAcquireMetalSlot()).toBe(true);
    expect(tryAcquireMetalSlot()).toBe(false);
    expect(metalActiveCount()).toBe(3);
  });

  it("releases a slot so a later instance can acquire", () => {
    expect(tryAcquireMetalSlot()).toBe(true);
    expect(tryAcquireMetalSlot()).toBe(true);
    expect(tryAcquireMetalSlot()).toBe(true);
    releaseMetalSlot();
    expect(metalActiveCount()).toBe(2);
    expect(tryAcquireMetalSlot()).toBe(true);
    expect(tryAcquireMetalSlot()).toBe(false);
  });

  it("does not decrement below zero", () => {
    releaseMetalSlot();
    expect(metalActiveCount()).toBe(0);
  });
});
