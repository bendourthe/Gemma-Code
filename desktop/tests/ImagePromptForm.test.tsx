import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

import type { DiffusionTierId } from "../../core/config/DiffusionTier";
import {
  DEFAULT_FORM_VALUES,
  FAST_PREVIEW_MODEL_ID,
  ImagePromptForm,
  type PromptFormValues,
  tierMeets,
  valuesToBaseRequest,
  visibleResolutions,
} from "../src/modules/image/ImagePromptForm";

function renderForm(
  onChange = vi.fn(),
  initial?: Partial<PromptFormValues>,
  diffusionTier: DiffusionTierId = "diffusion-low",
) {
  render(
    <ImagePromptForm
      onChange={onChange}
      initial={initial}
      diffusionTier={diffusionTier}
      availableModels={[
        { id: "sana-1.6b-1024", displayName: "SANA 1.5 1.6B 1024px" },
        { id: "sdxl-turbo", displayName: "SDXL Turbo" },
      ]}
      availableLoras={[{ id: "lora:a", displayName: "LoRA A" }]}
      availableControlNets={[{ id: "cn:a", displayName: "ControlNet A" }]}
    />,
  );
  return { onChange };
}

describe("ImagePromptForm", () => {
  it("renders all baseline fields", () => {
    renderForm();
    expect(screen.getByTestId("image-prompt")).toBeInTheDocument();
    expect(screen.getByTestId("image-negative-prompt")).toBeInTheDocument();
    expect(screen.getByTestId("image-model")).toBeInTheDocument();
    expect(screen.getByTestId("image-width")).toHaveValue(1024);
    expect(screen.getByTestId("image-height")).toHaveValue(1024);
    expect(screen.getByTestId("image-cfg")).toHaveValue(DEFAULT_FORM_VALUES.cfgScale);
  });

  it("emits onChange when prompt changes", () => {
    const { onChange } = renderForm();
    fireEvent.change(screen.getByTestId("image-prompt"), { target: { value: "a fox" } });
    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as PromptFormValues;
    expect(last.prompt).toBe("a fox");
  });

  it("adds and removes LoRA rows", () => {
    renderForm();
    fireEvent.click(screen.getByTestId("image-advanced"));
    fireEvent.click(screen.getByTestId("image-add-lora"));
    expect(screen.getByTestId("image-lora-0")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("image-lora-remove-0"));
    expect(screen.queryByTestId("image-lora-0")).not.toBeInTheDocument();
  });

  it("toggles ControlNet fields", () => {
    renderForm();
    fireEvent.click(screen.getByTestId("image-advanced"));
    fireEvent.click(screen.getByTestId("image-controlnet-toggle"));
    expect(screen.getByTestId("image-controlnet-fields")).toBeInTheDocument();
    const selectModel = within(screen.getByTestId("image-controlnet-fields")).getByTestId(
      "image-controlnet-model",
    );
    expect(selectModel).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("image-controlnet-toggle"));
    expect(screen.queryByTestId("image-controlnet-fields")).not.toBeInTheDocument();
  });

  it("valuesToBaseRequest forwards numeric + array fields", () => {
    const values: PromptFormValues = {
      ...DEFAULT_FORM_VALUES,
      prompt: "p",
      width: 512,
      height: 512,
      steps: 8,
      cfgScale: 7,
      sampler: "ddim",
      seed: 99,
      loras: [{ id: "lora:a", weight: 0.4 }],
      controlNet: {
        modelId: "cn:a",
        conditionImage: "data:image/png;base64,AAA",
        weight: 0.7,
        preprocessor: "canny",
      },
    };
    const out = valuesToBaseRequest(values);
    expect(out.prompt).toBe("p");
    expect(out.cfgScale).toBe(7);
    expect((out.loras as Array<{ id: string }>)[0]?.id).toBe("lora:a");
    expect((out.controlNet as { preprocessor: string }).preprocessor).toBe("canny");
  });

  // v1.1.0 Phase 12.7 -- Fast Preview / multi-lang hint / Flow-DPM-Solver / 2K-4K tier gating.

  it("exposes the multi-lang hint tooltip on the prompt", () => {
    renderForm();
    const hint = screen.getByTestId("image-prompt-multilang-hint");
    expect(hint).toBeInTheDocument();
    expect(hint.getAttribute("aria-label")).toMatch(/English, Chinese, and Emoji/i);
  });

  it("lists Flow-DPM-Solver as a sampler option", () => {
    renderForm();
    const sampler = screen.getByTestId("image-sampler");
    expect(within(sampler as HTMLElement).getByRole("option", { name: "flow-dpm-solver" })).toBeInTheDocument();
  });

  it("Fast Preview toggle defaults off and persists in onChange", () => {
    const { onChange } = renderForm();
    const toggle = screen.getByTestId("image-fast-preview-toggle") as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    fireEvent.click(toggle);
    const last = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as PromptFormValues;
    expect(last.fastPreview).toBe(true);
    expect(screen.getByTestId("image-fast-preview-model")).toHaveTextContent(FAST_PREVIEW_MODEL_ID);
  });

  it("valuesToBaseRequest swaps modelId + steps + sampler when fastPreview is on", () => {
    const values: PromptFormValues = {
      ...DEFAULT_FORM_VALUES,
      modelId: "sana-1.6b-1024",
      steps: 14,
      sampler: "euler_a",
      fastPreview: true,
    };
    const out = valuesToBaseRequest(values);
    expect(out.modelId).toBe(FAST_PREVIEW_MODEL_ID);
    expect(out.steps).toBe(1);
    expect(out.sampler).toBe("flow-dpm-solver");
  });

  it("valuesToBaseRequest leaves modelId alone when fastPreview is off", () => {
    const values: PromptFormValues = {
      ...DEFAULT_FORM_VALUES,
      modelId: "sana-1.6b-1024",
      steps: 14,
      sampler: "flow-dpm-solver",
      fastPreview: false,
    };
    const out = valuesToBaseRequest(values);
    expect(out.modelId).toBe("sana-1.6b-1024");
    expect(out.steps).toBe(14);
    expect(out.sampler).toBe("flow-dpm-solver");
  });

  it("visibleResolutions filters 2K / 4K by tier", () => {
    expect(visibleResolutions("diffusion-low").some((r) => r.value === "2048x2048")).toBe(false);
    expect(visibleResolutions("diffusion-low").some((r) => r.value === "4096x4096")).toBe(false);
    expect(visibleResolutions("diffusion-mid").some((r) => r.value === "2048x2048")).toBe(true);
    expect(visibleResolutions("diffusion-mid").some((r) => r.value === "4096x4096")).toBe(false);
    expect(visibleResolutions("diffusion-high").some((r) => r.value === "4096x4096")).toBe(true);
    expect(visibleResolutions("diffusion-pro").some((r) => r.value === "4096x4096")).toBe(true);
  });

  it("tierMeets returns true at or above the threshold", () => {
    expect(tierMeets("diffusion-low", "diffusion-low")).toBe(true);
    expect(tierMeets("diffusion-low", "diffusion-mid")).toBe(false);
    expect(tierMeets("diffusion-mid", "diffusion-mid")).toBe(true);
    expect(tierMeets("diffusion-high", "diffusion-mid")).toBe(true);
    expect(tierMeets("diffusion-pro", "diffusion-high")).toBe(true);
  });

  it("resolution dropdown hides 2K on diffusion-low", () => {
    renderForm(vi.fn(), undefined, "diffusion-low");
    const dropdown = screen.getByTestId("image-resolution") as HTMLSelectElement;
    const options = Array.from(dropdown.options).map((o) => o.value);
    expect(options).not.toContain("2048x2048");
    expect(options).not.toContain("4096x4096");
  });

  it("shows the tier hint tooltip when the form has a too-high resolution preset", () => {
    renderForm(vi.fn(), { width: 4096, height: 4096 }, "diffusion-low");
    expect(screen.getByTestId("image-resolution-tier-hint")).toHaveTextContent(
      /diffusion-high/,
    );
  });

  it("surfaces VRAM budget knobs in Advanced and forwards them", () => {
    renderForm();
    fireEvent.click(screen.getByText("Advanced (LoRAs, ControlNet)"));
    expect(screen.getByTestId("image-memory-budget")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("image-max-cache-vram"), { target: { value: "2" } });
    fireEvent.click(screen.getByTestId("image-layer-streaming"));
    const out = valuesToBaseRequest({
      ...DEFAULT_FORM_VALUES,
      maxCacheVramGB: 2,
      workingMemReserveGB: 1,
      layerStreaming: true,
    });
    expect(out.maxCacheVramGB).toBe(2);
    expect(out.layerStreaming).toBe(true);
  });
});
