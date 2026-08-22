/**
 * v1.0.0 Phase 7.2 -- Video Lab prompt form (left sidebar).
 *
 * Houses every parameter the user can tune for both text2video and
 * image2video modes: prompt + negative, model, mode toggle, duration,
 * fps, resolution, steps, CFG, seed, sampler. Keeps its own controlled
 * state so the page only sees the final `VideoFormValues` snapshot when
 * the user clicks Generate.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Select } from "../../components/ui/Select";
import { planVideoContinuation } from "../../../../core/video/continuation";
import type { DiffusionTierId } from "../../../../core/config/DiffusionTier";
import { defaultMemoryBudget, validateMemoryBudget } from "../../../../core/config/diffusionBudget";
import type { VideoMode } from "./videoClient";

export interface VideoFormValues {
  readonly prompt: string;
  readonly negativePrompt: string;
  readonly modelId: string;
  readonly mode: VideoMode;
  readonly durationSeconds: number;
  readonly fps: 12 | 16 | 24;
  readonly width: 854 | 1280;
  readonly height: 480 | 720;
  readonly steps: number;
  readonly cfgScale: number;
  readonly sampler: string;
  readonly seed: number;
  /** Per-tier clip length used to split continuation chains. */
  readonly clipSeconds: number;
  /** Explicit local-generation consent for talking-head output. */
  readonly confirmLocalAvatar: boolean;
  readonly maxCacheVramGB: number;
  readonly maxCacheRamGB: number;
  readonly workingMemReserveGB: number;
  readonly layerStreaming: boolean;
}

export interface VideoPromptFormProps {
  readonly initial?: Partial<VideoFormValues>;
  readonly availableModels: readonly { id: string; displayName: string; mode: VideoMode }[];
  readonly disabled?: boolean;
  readonly onChange?: (values: VideoFormValues) => void;
  /**
   * v1.15.0 Phase 6 -- hide the Mode select. In the chat Video Lab the mode is
   * inferred from whether the user attached an image (`inferVideoIntent`), so a
   * manual control would be vestigial and misleading. Defaults to false so any
   * other consumer keeps the original form.
   */
  readonly hideMode?: boolean;
  /** v2.0.0 Phase 3 -- show the talking-head confirm checkbox and mode. */
  readonly avatarAvailable?: boolean;
  readonly diffusionTier?: DiffusionTierId;
}

const SAMPLERS = ["euler", "euler_a", "dpmpp_2m", "dpmpp_sde", "ddim", "lms", "flow-dpm-solver"];
const LOW_BUDGET = defaultMemoryBudget("diffusion-low");
const FPS_VALUES: Array<12 | 16 | 24> = [12, 16, 24];
const RESOLUTIONS: Array<{
  label: string;
  width: 854 | 1280;
  height: 480 | 720;
}> = [
  { label: "480p (854x480)", width: 854, height: 480 },
  { label: "720p (1280x720)", width: 1280, height: 720 },
];

export const DEFAULT_VIDEO_FORM_VALUES: VideoFormValues = {
  prompt: "",
  negativePrompt: "",
  modelId: "wan2.1-t2v-1.3b",
  mode: "text2video",
  durationSeconds: 4,
  fps: 24,
  width: 854,
  height: 480,
  steps: 30,
  cfgScale: 3.5,
  sampler: "euler_a",
  seed: 0,
  clipSeconds: 4,
  confirmLocalAvatar: false,
  maxCacheVramGB: LOW_BUDGET.maxCacheVramGB,
  maxCacheRamGB: LOW_BUDGET.maxCacheRamGB,
  workingMemReserveGB: LOW_BUDGET.workingMemReserveGB,
  layerStreaming: LOW_BUDGET.layerStreaming,
};

/**
 * v1.1.0 Phase 13.1 -- Video Lab preset bundles. Each preset binds a
 * named tier (e.g. "Fast 720p") to a partial `VideoFormValues` patch the
 * preset selector applies to the form on selection. The Fast 720p preset
 * targets SANA-Video 2B (catalog entry from Phase 12.1) at 1280x720,
 * 24 fps, 4 s, flow-dpm-solver.
 */
export interface VideoPreset {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly values: Partial<VideoFormValues>;
}

export const VIDEO_PRESETS: readonly VideoPreset[] = [
  {
    id: "custom",
    label: "Custom",
    description: "Hand-tuned values; the preset selector stays out of the way.",
    values: {},
  },
  {
    id: "fast-720p",
    label: "Fast 720p (SANA-Video 2B)",
    description:
      "SANA-Video 2B at 720p, 4 s, 24 fps, flow-dpm-solver. Target <=60 s on RTX 4070 with offload.",
    values: {
      modelId: "sana-video-2b-720p",
      mode: "text2video",
      width: 1280,
      height: 720,
      durationSeconds: 4,
      fps: 24,
      sampler: "flow-dpm-solver",
    },
  },
];

export function VideoPromptForm({
  initial,
  availableModels,
  disabled,
  onChange,
  hideMode = false,
  avatarAvailable = false,
  diffusionTier = "diffusion-low",
}: VideoPromptFormProps): JSX.Element {
  const [values, setValues] = useState<VideoFormValues>({
    ...DEFAULT_VIDEO_FORM_VALUES,
    ...initial,
  });
  const skipFirstEffect = useRef(true);
  useEffect(() => {
    if (skipFirstEffect.current) {
      skipFirstEffect.current = false;
      return;
    }
    onChange?.(values);
  }, [values, onChange]);

  const [presetId, setPresetId] = useState<string>("custom");

  function update<K extends keyof VideoFormValues>(
    key: K,
    value: VideoFormValues[K],
  ): void {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function applyPreset(id: string): void {
    setPresetId(id);
    const preset = VIDEO_PRESETS.find((p) => p.id === id);
    if (!preset || Object.keys(preset.values).length === 0) return;
    setValues((prev) => ({ ...prev, ...preset.values }));
  }

  function updateMode(mode: VideoMode): void {
    setValues((prev) => {
      const first = availableModels.find((m) => m.mode === mode);
      const modelId =
        first && first.id !== prev.modelId ? first.id : prev.modelId;
      return { ...prev, mode, modelId };
    });
  }

  function updateResolution(width: 854 | 1280, height: 480 | 720): void {
    setValues((prev) => ({ ...prev, width, height }));
  }

  const modelsForMode = availableModels.filter((m) => m.mode === values.mode);
  const continuation = useMemo(
    () => planVideoContinuation(values.durationSeconds, values.clipSeconds),
    [values.durationSeconds, values.clipSeconds],
  );
  const budgetCheck = useMemo(
    () =>
      validateMemoryBudget({
        budget: {
          maxCacheVramGB: values.maxCacheVramGB,
          maxCacheRamGB: values.maxCacheRamGB,
          workingMemReserveGB: values.workingMemReserveGB,
          layerStreaming: values.layerStreaming,
        },
        modelMinVramGB: diffusionTier === "diffusion-low" ? 4 : 6,
      }),
    [
      values.maxCacheVramGB,
      values.maxCacheRamGB,
      values.workingMemReserveGB,
      values.layerStreaming,
      diffusionTier,
    ],
  );

  return (
    <div
      data-testid="video-prompt-form"
      style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}
    >
      <label>
        Preset
        <Select
          data-testid="video-preset"
          value={presetId}
          disabled={disabled}
          onChange={(e) => applyPreset(e.target.value)}
        >
          {VIDEO_PRESETS.map((p) => (
            <option key={p.id} value={p.id} title={p.description}>
              {p.label}
            </option>
          ))}
        </Select>
      </label>

      {!hideMode && (
        <label>
          Mode
          <Select
            data-testid="video-mode"
            value={values.mode}
            disabled={disabled}
            onChange={(e) => updateMode(e.target.value as VideoMode)}
          >
            <option value="text2video">Text -&gt; Video</option>
            <option value="image2video">Image -&gt; Video</option>
            {avatarAvailable ? (
              <option value="audio2video">Photo + audio -&gt; Avatar</option>
            ) : null}
          </Select>
        </label>
      )}

      <label>
        Prompt
        <textarea
          data-testid="video-prompt"
          value={values.prompt}
          disabled={disabled}
          rows={3}
          onChange={(e) => update("prompt", e.target.value)}
        />
      </label>

      <label>
        Negative Prompt
        <textarea
          data-testid="video-negative-prompt"
          value={values.negativePrompt}
          disabled={disabled}
          rows={2}
          onChange={(e) => update("negativePrompt", e.target.value)}
        />
      </label>

      <label>
        Model
        <Select
          data-testid="video-model"
          value={values.modelId}
          disabled={disabled || modelsForMode.length === 0}
          onChange={(e) => update("modelId", e.target.value)}
        >
          {modelsForMode.map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName}
            </option>
          ))}
        </Select>
      </label>

      <label>
        Duration (s)
        <input
          data-testid="video-duration"
          type="number"
          min={1}
          max={120}
          value={values.durationSeconds}
          disabled={disabled}
          onChange={(e) =>
            update("durationSeconds", clamp(Number(e.target.value), 1, 120))
          }
        />
        {continuation.length > 1 ? (
          <span data-testid="video-continuation-hint">
            {continuation.length} segments of up to {values.clipSeconds}s (prototype seams)
          </span>
        ) : null}
      </label>

      <label>
        FPS
        <Select
          data-testid="video-fps"
          value={values.fps}
          disabled={disabled}
          onChange={(e) => update("fps", Number(e.target.value) as 12 | 16 | 24)}
        >
          {FPS_VALUES.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </Select>
      </label>

      <label>
        Resolution
        <Select
          data-testid="video-resolution"
          value={`${values.width}x${values.height}`}
          disabled={disabled}
          onChange={(e) => {
            const found = RESOLUTIONS.find(
              (r) => `${r.width}x${r.height}` === e.target.value,
            );
            if (!found) return;
            updateResolution(found.width, found.height);
          }}
        >
          {RESOLUTIONS.map((r) => (
            <option key={r.label} value={`${r.width}x${r.height}`}>
              {r.label}
            </option>
          ))}
        </Select>
      </label>

      <label>
        Steps
        <input
          data-testid="video-steps"
          type="number"
          min={1}
          max={150}
          value={values.steps}
          disabled={disabled}
          onChange={(e) =>
            update("steps", clamp(Number(e.target.value), 1, 150))
          }
        />
      </label>

      <label>
        CFG Scale
        <input
          data-testid="video-cfg"
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
        Seed
        <input
          data-testid="video-seed"
          type="number"
          min={0}
          value={values.seed}
          disabled={disabled}
          onChange={(e) => update("seed", Number(e.target.value))}
        />
      </label>

      {avatarAvailable ? (
        <label>
          <input
            data-testid="video-avatar-confirm"
            type="checkbox"
            checked={values.confirmLocalAvatar}
            disabled={disabled}
            onChange={(e) => update("confirmLocalAvatar", e.target.checked)}
          />
          Generate talking-head locally. Photo and audio never leave this device.
        </label>
      ) : null}

      <details>
        <summary>Advanced</summary>
        <label>
          Sampler
          <Select
            data-testid="video-sampler"
            value={values.sampler}
            disabled={disabled}
            onChange={(e) => update("sampler", e.target.value)}
          >
            {SAMPLERS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </label>
        <div data-testid="video-memory-budget" style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <strong>VRAM budget</strong>
          <label>
            max cache VRAM (GB)
            <input
              data-testid="video-max-cache-vram"
              type="number"
              min={0.5}
              step={0.5}
              value={values.maxCacheVramGB}
              disabled={disabled}
              onChange={(e) => update("maxCacheVramGB", Number(e.target.value))}
            />
          </label>
          <label>
            max cache RAM (GB)
            <input
              data-testid="video-max-cache-ram"
              type="number"
              min={1}
              step={1}
              value={values.maxCacheRamGB}
              disabled={disabled}
              onChange={(e) => update("maxCacheRamGB", Number(e.target.value))}
            />
          </label>
          <label>
            working reserve (GB)
            <input
              data-testid="video-working-reserve"
              type="number"
              min={0}
              step={0.5}
              value={values.workingMemReserveGB}
              disabled={disabled}
              onChange={(e) => update("workingMemReserveGB", Number(e.target.value))}
            />
          </label>
          <label>
            <input
              data-testid="video-layer-streaming"
              type="checkbox"
              checked={values.layerStreaming}
              disabled={disabled}
              onChange={(e) => update("layerStreaming", e.target.checked)}
            />
            Layer streaming (complete a previously too-small VRAM load)
          </label>
          {!budgetCheck.ok ? (
            <p data-testid="video-budget-error" style={{ color: "var(--accent-danger, #f87171)", margin: 0 }}>
              {budgetCheck.errors.join(" ")}
            </p>
          ) : null}
          {budgetCheck.warnings.map((warning) => (
            <p key={warning} data-testid="video-budget-warning" style={{ color: "var(--fg-muted)", margin: 0 }}>
              {warning}
            </p>
          ))}
        </div>
      </details>
    </div>
  );
}

export function videoFormToRequest(
  values: VideoFormValues,
): Omit<import("./videoClient").VideoBaseRequest, "sourceImage"> {
  return {
    modelId: values.modelId,
    prompt: values.prompt,
    negativePrompt: values.negativePrompt || undefined,
    width: values.width,
    height: values.height,
    durationSeconds: values.durationSeconds,
    fps: values.fps,
    steps: values.steps,
    cfgScale: values.cfgScale,
    sampler: values.sampler,
    seed: values.seed,
    latentPreview: true,
    maxCacheVramGB: values.maxCacheVramGB,
    maxCacheRamGB: values.maxCacheRamGB,
    workingMemReserveGB: values.workingMemReserveGB,
    layerStreaming: values.layerStreaming,
  };
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}
