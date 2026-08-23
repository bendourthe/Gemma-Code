/**
 * v2.1.0 Phase 3 -- recall actions for generated Studio media.
 * v2.2.3 Phase 2 (2.3) -- icon-only glass buttons (`nx-icon-btn`): the
 * accessible name lives on aria-label + title, never a visible caption.
 */

import { FileJson, Hash, Layers, Shuffle, Type } from "lucide-react";

export type RecallMode = "prompt" | "seed" | "all" | "remix";

export interface ImageRecallTarget {
  prompt: string;
  negativePrompt: string;
  modelId: string;
  width: number;
  height: number;
  steps: number;
  cfgScale: number;
  sampler: string;
  seed: number;
}

export function applyImageRecall(
  current: ImageRecallTarget,
  workflow: Record<string, unknown>,
  mode: RecallMode,
): ImageRecallTarget {
  const prompt = typeof workflow.prompt === "string" ? workflow.prompt : current.prompt;
  const seed = typeof workflow.seed === "number" ? workflow.seed : current.seed;
  if (mode === "prompt") return { ...current, prompt };
  if (mode === "seed") return { ...current, seed };
  const next: ImageRecallTarget = {
    prompt,
    negativePrompt:
      typeof workflow.negativePrompt === "string"
        ? workflow.negativePrompt
        : current.negativePrompt,
    modelId: typeof workflow.modelId === "string" ? workflow.modelId : current.modelId,
    width: typeof workflow.width === "number" ? workflow.width : current.width,
    height: typeof workflow.height === "number" ? workflow.height : current.height,
    steps: typeof workflow.steps === "number" ? workflow.steps : current.steps,
    cfgScale: typeof workflow.cfgScale === "number" ? workflow.cfgScale : current.cfgScale,
    sampler: typeof workflow.sampler === "string" ? workflow.sampler : current.sampler,
    seed,
  };
  if (mode === "remix") {
    next.seed = Math.floor(Math.random() * 1_000_000_000);
  }
  return next;
}

export function applyVideoRecall(
  current: ImageRecallTarget,
  workflow: Record<string, unknown>,
  mode: RecallMode,
): ImageRecallTarget {
  return applyImageRecall(current, workflow, mode);
}

export interface RecallActionsProps {
  readonly messageId: string;
  readonly testIdPrefix: string;
  readonly hasWorkflow: boolean;
  readonly onRecall: (mode: RecallMode) => void;
  readonly onCopyWorkflow?: () => void;
}

export function RecallActions({
  messageId,
  testIdPrefix,
  hasWorkflow,
  onRecall,
  onCopyWorkflow,
}: RecallActionsProps): JSX.Element | null {
  if (!hasWorkflow) return null;
  return (
    <>
      {onCopyWorkflow ? (
        <button
          type="button"
          className="nx-icon-btn"
          aria-label="Copy Workflow"
          title="Copy Workflow"
          data-testid={`${testIdPrefix}-copyworkflow-${messageId}`}
          onClick={onCopyWorkflow}
        >
          <FileJson size={16} aria-hidden="true" />
        </button>
      ) : null}
      <button
        type="button"
        className="nx-icon-btn"
        aria-label="Use Prompt"
        title="Use Prompt"
        data-testid={`${testIdPrefix}-use-prompt-${messageId}`}
        onClick={() => onRecall("prompt")}
      >
        <Type size={16} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="nx-icon-btn"
        aria-label="Use Seed"
        title="Use Seed"
        data-testid={`${testIdPrefix}-use-seed-${messageId}`}
        onClick={() => onRecall("seed")}
      >
        <Hash size={16} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="nx-icon-btn"
        aria-label="Use All"
        title="Use All"
        data-testid={`${testIdPrefix}-use-all-${messageId}`}
        onClick={() => onRecall("all")}
      >
        <Layers size={16} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="nx-icon-btn"
        aria-label="Remix"
        title="Remix"
        data-testid={`${testIdPrefix}-remix-${messageId}`}
        onClick={() => onRecall("remix")}
      >
        <Shuffle size={16} aria-hidden="true" />
      </button>
    </>
  );
}
