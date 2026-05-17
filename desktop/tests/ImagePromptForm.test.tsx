import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

import {
  DEFAULT_FORM_VALUES,
  ImagePromptForm,
  type PromptFormValues,
  valuesToBaseRequest,
} from "../src/modules/image/ImagePromptForm";

function renderForm(onChange = vi.fn(), initial?: Partial<PromptFormValues>) {
  render(
    <ImagePromptForm
      onChange={onChange}
      initial={initial}
      availableModels={[{ id: "sdxl-turbo", displayName: "SDXL Turbo" }]}
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
    expect(screen.getByTestId("image-cfg")).toHaveValue(1.5);
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
    expect((out.loras as Array<{ id: string }>)[0].id).toBe("lora:a");
    expect((out.controlNet as { preprocessor: string }).preprocessor).toBe("canny");
  });
});
