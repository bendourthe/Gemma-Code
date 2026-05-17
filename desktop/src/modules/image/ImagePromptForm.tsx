/**
 * v1.0.0 Phase 6.5 -- forms-driven prompt sidebar.
 *
 * Houses every parameter the user can tune: prompt + negative, model,
 * width / height, steps, CFG, sampler, seed, plus the collapsible
 * "Advanced" panel for LoRAs and ControlNet. Keeps its own controlled
 * state so the page only sees the final `PromptFormValues` snapshot
 * when the user clicks Generate.
 */

import { useState } from "react";
import type { ControlNetRef, LoraRef } from "./diffusionClient";

export interface PromptFormValues {
  readonly prompt: string;
  readonly negativePrompt: string;
  readonly modelId: string;
  readonly width: number;
  readonly height: number;
  readonly steps: number;
  readonly cfgScale: number;
  readonly sampler: string;
  readonly seed: number;
  readonly loras: readonly LoraRef[];
  readonly controlNet?: ControlNetRef;
}

export interface ImagePromptFormProps {
  readonly initial?: Partial<PromptFormValues>;
  readonly availableModels: readonly { id: string; displayName: string }[];
  readonly availableLoras: readonly { id: string; displayName: string }[];
  readonly availableControlNets: readonly { id: string; displayName: string }[];
  readonly disabled?: boolean;
  readonly onChange?: (values: PromptFormValues) => void;
}

const SAMPLERS = ["euler", "euler_a", "dpmpp_2m", "dpmpp_sde", "ddim", "lms"];

export const DEFAULT_FORM_VALUES: PromptFormValues = {
  prompt: "",
  negativePrompt: "",
  modelId: "sdxl-turbo",
  width: 1024,
  height: 1024,
  steps: 4,
  cfgScale: 1.5,
  sampler: "euler_a",
  seed: 0,
  loras: [],
};

export function ImagePromptForm({
  initial,
  availableModels,
  availableLoras,
  availableControlNets,
  disabled,
  onChange,
}: ImagePromptFormProps): JSX.Element {
  const [values, setValues] = useState<PromptFormValues>({
    ...DEFAULT_FORM_VALUES,
    ...initial,
  });
  const [advancedOpen, setAdvancedOpen] = useState(false);

  function update<K extends keyof PromptFormValues>(key: K, value: PromptFormValues[K]): void {
    setValues((prev) => {
      const next = { ...prev, [key]: value };
      onChange?.(next);
      return next;
    });
  }

  function addLora(): void {
    const next = [...values.loras, { id: availableLoras[0]?.id ?? "", weight: 1.0 }];
    update("loras", next);
  }

  function updateLora(index: number, patch: Partial<LoraRef>): void {
    const next = values.loras.map((entry, i) => (i === index ? { ...entry, ...patch } : entry));
    update("loras", next);
  }

  function removeLora(index: number): void {
    update("loras", values.loras.filter((_, i) => i !== index));
  }

  function toggleControlNet(enabled: boolean): void {
    if (!enabled) {
      update("controlNet", undefined);
    } else {
      update("controlNet", {
        modelId: availableControlNets[0]?.id ?? "",
        conditionImage: "",
        weight: 1.0,
        preprocessor: "canny",
      });
    }
  }

  return (
    <form
      data-testid="image-prompt-form"
      onSubmit={(e) => e.preventDefault()}
      style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}
    >
      <label>
        <span style={{ display: "block", fontSize: "var(--text-xs)", color: "var(--fg-muted)" }}>Prompt</span>
        <textarea
          data-testid="image-prompt"
          rows={4}
          value={values.prompt}
          disabled={disabled}
          onChange={(e) => update("prompt", e.target.value)}
          style={{ width: "100%" }}
        />
      </label>
      <label>
        <span style={{ display: "block", fontSize: "var(--text-xs)", color: "var(--fg-muted)" }}>Negative Prompt</span>
        <textarea
          data-testid="image-negative-prompt"
          rows={2}
          value={values.negativePrompt}
          disabled={disabled}
          onChange={(e) => update("negativePrompt", e.target.value)}
          style={{ width: "100%" }}
        />
      </label>
      <label>
        <span style={{ display: "block", fontSize: "var(--text-xs)", color: "var(--fg-muted)" }}>Model</span>
        <select
          data-testid="image-model"
          value={values.modelId}
          disabled={disabled}
          onChange={(e) => update("modelId", e.target.value)}
        >
          {availableModels.map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName}
            </option>
          ))}
        </select>
      </label>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-2)" }}>
        <label>
          Width
          <input
            data-testid="image-width"
            type="number"
            min={64}
            max={2048}
            step={8}
            value={values.width}
            disabled={disabled}
            onChange={(e) => update("width", Number(e.target.value))}
          />
        </label>
        <label>
          Height
          <input
            data-testid="image-height"
            type="number"
            min={64}
            max={2048}
            step={8}
            value={values.height}
            disabled={disabled}
            onChange={(e) => update("height", Number(e.target.value))}
          />
        </label>
        <label>
          Steps
          <input
            data-testid="image-steps"
            type="number"
            min={1}
            max={150}
            value={values.steps}
            disabled={disabled}
            onChange={(e) => update("steps", Number(e.target.value))}
          />
        </label>
        <label>
          CFG
          <input
            data-testid="image-cfg"
            type="number"
            min={0}
            max={30}
            step={0.1}
            value={values.cfgScale}
            disabled={disabled}
            onChange={(e) => update("cfgScale", Number(e.target.value))}
          />
        </label>
        <label>
          Sampler
          <select
            data-testid="image-sampler"
            value={values.sampler}
            disabled={disabled}
            onChange={(e) => update("sampler", e.target.value)}
          >
            {SAMPLERS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          Seed
          <input
            data-testid="image-seed"
            type="number"
            min={0}
            value={values.seed}
            disabled={disabled}
            onChange={(e) => update("seed", Number(e.target.value))}
          />
        </label>
      </div>
      <details
        data-testid="image-advanced"
        open={advancedOpen}
        onToggle={(e) => setAdvancedOpen((e.target as HTMLDetailsElement).open)}
      >
        <summary>Advanced (LoRAs, ControlNet)</summary>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", marginTop: "var(--space-2)" }}>
          <div>
            <button data-testid="image-add-lora" type="button" onClick={addLora} disabled={disabled}>
              + LoRA
            </button>
            {values.loras.map((lora, i) => (
              <div key={`lora-${i}`} data-testid={`image-lora-${i}`} style={{ display: "flex", gap: "var(--space-2)" }}>
                <select
                  data-testid={`image-lora-id-${i}`}
                  value={lora.id}
                  onChange={(e) => updateLora(i, { id: e.target.value })}
                >
                  {availableLoras.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.displayName}
                    </option>
                  ))}
                </select>
                <input
                  data-testid={`image-lora-weight-${i}`}
                  type="number"
                  step={0.05}
                  min={-2}
                  max={2}
                  value={lora.weight}
                  onChange={(e) => updateLora(i, { weight: Number(e.target.value) })}
                />
                <button
                  type="button"
                  data-testid={`image-lora-remove-${i}`}
                  onClick={() => removeLora(i)}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          <label>
            <input
              data-testid="image-controlnet-toggle"
              type="checkbox"
              checked={Boolean(values.controlNet)}
              onChange={(e) => toggleControlNet(e.target.checked)}
            />
            Enable ControlNet
          </label>
          {values.controlNet && (
            <div data-testid="image-controlnet-fields" style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              <select
                data-testid="image-controlnet-model"
                value={values.controlNet.modelId}
                onChange={(e) =>
                  update("controlNet", { ...values.controlNet!, modelId: e.target.value })
                }
              >
                {availableControlNets.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.displayName}
                  </option>
                ))}
              </select>
              <select
                data-testid="image-controlnet-preprocessor"
                value={values.controlNet.preprocessor}
                onChange={(e) =>
                  update("controlNet", {
                    ...values.controlNet!,
                    preprocessor: e.target.value as ControlNetRef["preprocessor"],
                  })
                }
              >
                <option value="canny">Canny</option>
                <option value="pose">Pose</option>
                <option value="depth">Depth</option>
                <option value="none">None</option>
              </select>
            </div>
          )}
        </div>
      </details>
    </form>
  );
}

export function valuesToBaseRequest(
  values: PromptFormValues,
  overrides: Partial<PromptFormValues> = {},
): Record<string, unknown> {
  const merged = { ...values, ...overrides };
  const out: Record<string, unknown> = {
    modelId: merged.modelId,
    prompt: merged.prompt,
    negativePrompt: merged.negativePrompt || undefined,
    width: merged.width,
    height: merged.height,
    steps: merged.steps,
    cfgScale: merged.cfgScale,
    sampler: merged.sampler,
    seed: merged.seed,
    batchSize: 1,
    latentPreview: true,
    loras: [...merged.loras],
  };
  if (merged.controlNet) {
    out.controlNet = { ...merged.controlNet };
  }
  return out;
}
