import { describe, expect, it } from "vitest";

import {
  AVATAR_MIN_VRAM_GB,
  assertAvatarAllowed,
  avatarAvailable,
} from "../../../../core/video/avatarGate.js";
import { buildAvatarProvenance, shortPayloadHash } from "../../../../core/video/avatarProvenance.js";

describe("assertAvatarAllowed", () => {
  const ok = {
    tierId: "diffusion-pro" as const,
    vramGB: 24,
    confirmed: true,
  };

  it("allows a confirmed diffusion-pro host at the VRAM floor", () => {
    expect(assertAvatarAllowed({ ...ok, vramGB: AVATAR_MIN_VRAM_GB })).toEqual({ ok: true });
  });

  it("refuses an unconfirmed request", () => {
    const r = assertAvatarAllowed({ ...ok, confirmed: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("avatar-unconfirmed");
  });

  it("refuses below diffusion-pro", () => {
    const r = assertAvatarAllowed({ ...ok, tierId: "diffusion-high" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("avatar-tier");
  });

  it("refuses a pro-tier host that is still under the VRAM floor", () => {
    const r = assertAvatarAllowed({ ...ok, vramGB: 16 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("avatar-vram");
  });

  it("refuses a community weight repo", () => {
    const r = assertAvatarAllowed({
      ...ok,
      weightRepo: "someone/LongCat-Video-FP8",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("avatar-unofficial");
  });

  it("refuses a non-catalog model id", () => {
    const r = assertAvatarAllowed({ ...ok, modelId: "ltx-video" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("avatar-model");
  });
});

describe("avatarAvailable", () => {
  it("is true only on diffusion-pro at the VRAM floor", () => {
    expect(avatarAvailable("diffusion-pro", 20)).toBe(true);
    expect(avatarAvailable("diffusion-pro", 19.9)).toBe(false);
    expect(avatarAvailable("diffusion-high", 24)).toBe(false);
  });
});

describe("buildAvatarProvenance", () => {
  it("marks output as local and hashes photo plus audio", () => {
    const provenance = buildAvatarProvenance({
      sourceImage: "data:image/png;base64,AAA",
      sourceAudio: "data:audio/wav;base64,BBB",
    });
    expect(provenance.generatedBy).toBe("nexus");
    expect(provenance.local).toBe(true);
    expect(provenance.neverLeftDevice).toBe(true);
    expect(provenance.weightVariant).toBe("int8");
    expect(provenance.weightRepo).toBe("meituan-longcat/LongCat-Video-Avatar-1.5");
    expect(provenance.sourcePhotoHash).toBe(shortPayloadHash("data:image/png;base64,AAA"));
    expect(provenance.sourceAudioHash).toBe(shortPayloadHash("data:audio/wav;base64,BBB"));
  });
});
