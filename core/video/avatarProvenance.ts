/**
 * v2.0.0 Phase 3 -- provenance blob embedded in avatar MP4 workflow JSON.
 *
 * Talking-head output is deepfake-adjacent, so saved files must say they
 * were generated locally and that the source photo/audio never left the
 * device. Hashes are short identifiers, not the raw payloads.
 */

import { createHash } from "node:crypto";

import {
  OFFICIAL_AVATAR_MODEL_ID,
  OFFICIAL_AVATAR_REPO,
} from "./avatarGate.js";

export interface AvatarProvenance {
  readonly generatedBy: "nexus";
  readonly local: true;
  readonly neverLeftDevice: true;
  readonly weightRepo: string;
  readonly weightVariant: "int8";
  readonly modelId: string;
  readonly sourcePhotoHash: string;
  readonly sourceAudioHash: string;
}

export function shortPayloadHash(payload: string): string {
  return createHash("sha256").update(payload, "utf8").digest("hex").slice(0, 16);
}

export function buildAvatarProvenance(input: {
  readonly sourceImage: string;
  readonly sourceAudio: string;
  readonly weightRepo?: string;
  readonly modelId?: string;
}): AvatarProvenance {
  return {
    generatedBy: "nexus",
    local: true,
    neverLeftDevice: true,
    weightRepo: input.weightRepo ?? OFFICIAL_AVATAR_REPO,
    weightVariant: "int8",
    modelId: input.modelId ?? OFFICIAL_AVATAR_MODEL_ID,
    sourcePhotoHash: shortPayloadHash(input.sourceImage),
    sourceAudioHash: shortPayloadHash(input.sourceAudio),
  };
}
