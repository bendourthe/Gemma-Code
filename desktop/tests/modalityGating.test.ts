import { describe, expect, it } from "vitest";

import {
  audioAttachmentCopy,
  chatComposerAccept,
  imageAttachmentAffordance,
  modelHasModality,
} from "../src/shared/chat/modalityGating";

describe("modality gating", () => {
  it("enables image attach only when the catalog lists image", () => {
    expect(imageAttachmentAffordance({ modalities: ["text", "image"] }).enabled).toBe(true);
    expect(imageAttachmentAffordance({ modalities: ["text"] }).enabled).toBe(false);
    expect(imageAttachmentAffordance(undefined).enabled).toBe(false);
    expect(imageAttachmentAffordance({ modalities: ["text"] }).tooltip).toMatch(/cannot see images/i);
  });

  it("keeps audio attach copy for any text model", () => {
    expect(audioAttachmentCopy({ modalities: ["text"] })).toMatch(/transcribed on-device/i);
    expect(audioAttachmentCopy({ modalities: ["text", "audio"] })).toMatch(/Native audio-token/i);
  });

  it("builds a chat accept list without images when vision is off", () => {
    const blocked = chatComposerAccept({ allowImages: false, allowAudio: true });
    expect(blocked).toContain("application/pdf");
    expect(blocked).toContain("audio/*");
    expect(blocked).not.toContain("image/*");
    const open = chatComposerAccept({ allowImages: true, allowAudio: true });
    expect(open).toContain("image/*");
    expect(open).toContain("video/*");
  });

  it("modelHasModality is false when modalities are omitted", () => {
    expect(modelHasModality({ id: "x" }, "image")).toBe(false);
    expect(modelHasModality({ modalities: ["audio"] }, "audio")).toBe(true);
  });
});
