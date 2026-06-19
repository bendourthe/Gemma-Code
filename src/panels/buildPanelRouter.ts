/**
 * buildPanelRouter -- factory for the opt-in budget-panel router (OF011).
 *
 * v1.6.0 adoption-openrouter-fusion Phase 5. Extracted from `ChatPanelBootstrap`
 * so the construction + its fail-safe degrade behavior are unit-testable in
 * isolation (the bootstrap construction graph is far too large to exercise this
 * one path through). Behavior is identical to the previous inline block.
 *
 * OPT-IN / DEFAULT-OFF: returns `{ router: null }` when `enabled` is false (the
 * default), so the chat turn is byte-identical to the pre-OF011 path. When
 * enabled it wires `InProcessTelemetryBus` -> `GpuScheduler` (free-VRAM-gated
 * Phase 3 co-residency backend) -> `FusionAgent` judge -> `ModelPinRegistry`
 * keep-alive -> `PanelExecutor` -> `PanelRouter`, inside a fail-safe try/catch
 * that returns `{ router: null }` on ANY failure (e.g. a mis-wired catalog so
 * `loadFusePrompt` throws), so panel routing degrading never breaks chat startup.
 */
import { PanelExecutor } from "../../modules/coding/orchestration/PanelExecutor.js";
import { FusionAgent, loadFusePrompt } from "../../modules/coding/orchestration/FusionAgent.js";
import { PanelRouter } from "../../modules/coding/llm/PanelRouter.js";
import { GpuScheduler } from "../../core/scheduler/GpuScheduler.js";
import { InProcessTelemetryBus } from "../../core/telemetry/TelemetryBus.js";
import { ModelPinRegistry } from "../../core/registry/ModelPinRegistry.js";
import { getGpuDetector } from "../../modules/coding/config/GpuDetector.js";
import { getLogger } from "../../modules/coding/utils/logger.js";
import type { LLMClient, OllamaOptions } from "../../modules/coding/llm/types.js";

/** 6 GB per-model estimate -- a safe default for the small panelists. */
const PANEL_MEMBER_VRAM_GB = 6;

export interface PanelRouterBuildOptions {
  /** The opt-in master switch (`settings.panelRoutingEnabled`). */
  readonly enabled: boolean;
  /** Resolves the active LLM client (`runtime.getOllamaClient`). */
  readonly getClient: () => LLMClient;
  /** The primary model id (judge model + excluded from the panel spec). */
  readonly modelName: string;
  /** Sampling options forwarded to the judge. */
  readonly ollamaOptions: OllamaOptions;
  /** Absolute path to the skill catalog (for the F1 `fuse` prompt). */
  readonly catalogDir: string;
  /**
   * Free-VRAM provider override (GB). Defaults to a `GpuDetector`-backed reader.
   * Injectable so tests need not shell out to `nvidia-smi`.
   */
  readonly vramProvider?: () => number | Promise<number>;
}

export interface PanelRouterBuildResult {
  /** The router, or `null` when disabled or construction failed (degrade-safe). */
  readonly router: PanelRouter | null;
  /**
   * Lists distinct installed models other than the primary (the panel spec the
   * executor de-dupes + caps). `null` when there is no router.
   */
  readonly panelSpecProvider: (() => Promise<readonly string[]>) | null;
}

/**
 * Free VRAM in GB from the GPU detector; degrades safely to total VRAM, then 0,
 * when the detector cannot read a free-VRAM figure (e.g. Windows WMI / Apple).
 * Exported so it is unit-testable without constructing the whole router.
 */
export async function defaultFreeVramGB(): Promise<number> {
  const d = await getGpuDetector().detect();
  const free = d.primaryGpu?.freeVramMb ?? 0;
  return free > 0 ? free / 1024 : (d.primaryGpu?.totalVramMb ?? 0) / 1024;
}

export function buildPanelRouter(opts: PanelRouterBuildOptions): PanelRouterBuildResult {
  if (!opts.enabled) {
    return { router: null, panelSpecProvider: null };
  }
  try {
    const telemetry = new InProcessTelemetryBus();
    const scheduler = new GpuScheduler({
      telemetry,
      vramProvider: opts.vramProvider ?? defaultFreeVramGB,
    });
    const judge = new FusionAgent(
      opts.getClient(),
      opts.modelName,
      opts.ollamaOptions,
      loadFusePrompt(opts.catalogDir),
    );
    const keepAlive = new ModelPinRegistry();
    const executor = new PanelExecutor({
      clientFactory: () => opts.getClient(),
      judge,
      concurrency: { scheduler, vramFor: () => PANEL_MEMBER_VRAM_GB, keepAlive },
    });
    const router = new PanelRouter({ executor, config: { enabled: true } });
    const panelSpecProvider = async (): Promise<readonly string[]> => {
      const models = await opts.getClient().listModels();
      return models.map((m) => m.name).filter((n) => n && n !== opts.modelName);
    };
    return { router, panelSpecProvider };
  } catch (err) {
    getLogger().warn(
      "[PanelRouter] Construction failed; panel routing disabled for this session:",
      err,
    );
    return { router: null, panelSpecProvider: null };
  }
}
