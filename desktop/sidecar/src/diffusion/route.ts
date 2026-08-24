/**
 * v2.2.5 Phase 2 -- map Image Studio / Video Lab picker ids onto the Python
 * JSON-RPC method the runtime actually registered.
 *
 * Catalog ids (sana-1.6b-int4, sana-sprint-1.6b, ltx-video, ...) are folded
 * through the Phase 1 alias table, then routed. Generic `txt2img` is the
 * SDXL-shaped fallback; SANA weights never go through that stub.
 */

import { foldModelId } from "../../../../core/registry/modelAliases";

export type ImageDispatchMode = "txt2img" | "img2img" | "inpaint" | "outpaint";
export type VideoDispatchMode = "text2video" | "image2video" | "audio2video";

const VIDEO_METHOD: Record<VideoDispatchMode, string> = {
  text2video: "diffusion.video.text2video",
  image2video: "diffusion.video.image2video",
  audio2video: "diffusion.video.audio2video",
};

export function foldRequestModelId(
  request: Record<string, unknown>,
): Record<string, unknown> {
  const modelId = request["modelId"];
  if (typeof modelId !== "string" || modelId.length === 0) return request;
  const folded = foldModelId(modelId);
  if (folded === modelId) return request;
  return { ...request, modelId: folded };
}

function normalizedModelId(modelId: unknown): string {
  if (typeof modelId !== "string") return "";
  return foldModelId(modelId).toLowerCase();
}

export function isSanaInt4(modelId: unknown): boolean {
  const id = normalizedModelId(modelId);
  return id.includes("sana") && id.endsWith("-int4");
}

export function resolveImageMethod(
  mode: ImageDispatchMode,
  modelId: unknown,
): string {
  const id = normalizedModelId(modelId);
  if (isSanaInt4(id)) {
    if (mode !== "txt2img") {
      throw new Error("img2img is not supported for INT4 SANA weights");
    }
    return "sana_int4.txt2img";
  }
  if (id.startsWith("sana-sprint")) {
    if (mode === "txt2img") return "sana_sprint.txt2img";
    if (mode === "img2img") return "sana.img2img";
  }
  if (id.startsWith("sana") && !id.startsWith("sana-video")) {
    if (mode === "txt2img") return "sana.txt2img";
    if (mode === "img2img") return "sana.img2img";
  }
  return mode;
}

export function resolveVideoMethod(
  mode: VideoDispatchMode,
  modelId: unknown,
): string {
  const id = normalizedModelId(modelId);
  if (id.startsWith("sana-video") || id.includes("sana-video")) {
    if (mode === "text2video") return "diffusion.video.sana.text2video";
    if (mode === "image2video") return "diffusion.video.sana.image2video";
  }
  return VIDEO_METHOD[mode];
}

export function requireSourceImageBytes(
  mode: ImageDispatchMode,
  request: Record<string, unknown>,
): void {
  if (mode !== "img2img" && mode !== "inpaint" && mode !== "outpaint") return;
  const src = request["sourceImage"];
  if (typeof src !== "string" || src.trim().length === 0) {
    throw new Error(`${mode} requires source image bytes`);
  }
}
