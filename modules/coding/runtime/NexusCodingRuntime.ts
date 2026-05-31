import { Tracer } from "../observability/Tracer.js";
import { TraceFile } from "../observability/TraceFile.js";
import {
  getSettings,
  onSettingsChange,
  type GemmaCodeSettings,
} from "../config/settings.js";
import { createOllamaClient } from "../llm/OllamaClient.js";
import { createLmStudioClient } from "../llm/LmStudioClient.js";
import type { LLMClient } from "../llm/types.js";
import { configureDeniedDestinations } from "../utils/ssrf.js";

/**
 * Composition root for the extension. Owns the singleton-like cross-cutting
 * concerns (Tracer, TraceFile, settings snapshot + change subscription, LLM
 * port) so individual subsystems no longer reach into shared static state.
 * The runtime is created once in `extension.ts` activation and threaded into
 * every consumer.
 */
export class NexusCodingRuntime {
  readonly tracer: Tracer;
  readonly traceFile: TraceFile;
  private _settings: GemmaCodeSettings;
  private readonly _settingsListeners: Array<(s: GemmaCodeSettings) => void> = [];
  private readonly _settingsSubscription: { dispose(): void };
  private _llmClient: LLMClient | null = null;
  private _llmClientKey: string | null = null;

  constructor() {
    this.tracer = new Tracer();
    this.traceFile = new TraceFile();
    this._settings = getSettings();
    if (this._settings.traceAutoEnable) {
      try {
        this.traceFile.enable();
      } catch {
        /* non-fatal */
      }
    }
    // v1.4.0 Phase 2 (A4): seed the SSRF egress denylist with the user's extra
    // destinations. `?? []` tolerates partial settings snapshots from tests.
    configureDeniedDestinations(this._settings.egressDenyExtra ?? []);
    this._settingsSubscription = onSettingsChange((next) => {
      const prev = this._settings;
      this._settings = next;
      configureDeniedDestinations(next.egressDenyExtra ?? []);
      if (
        prev.ollamaUrl !== next.ollamaUrl ||
        prev.requestTimeout !== next.requestTimeout ||
        prev.llmBackend !== next.llmBackend ||
        prev.lmStudioBaseUrl !== next.lmStudioBaseUrl
      ) {
        this._llmClient = null;
        this._llmClientKey = null;
      }
      for (const listener of this._settingsListeners) {
        listener(next);
      }
    });
  }

  /**
   * Vendor-neutral LLM port. Returns either the Ollama or LM Studio adapter
   * per `llmBackend`. The `auto` mode probes LM Studio first on macOS only
   * (the runtime cannot reliably detect macOS from a webview-only context, so
   * we use `process.platform`); other platforms default to Ollama unless
   * `lmstudio` is selected explicitly.
   *
   * v0.8.0 Phase 4 sub-task 4.2 (item F1).
   */
  getOllamaClient(): LLMClient {
    const s = this._settings;
    const backend = this._resolveBackend(s);
    const key = `${backend}|${s.ollamaUrl}|${s.lmStudioBaseUrl}|${s.requestTimeout}`;
    if (this._llmClient && this._llmClientKey === key) {
      return this._llmClient;
    }
    this._llmClient =
      backend === "lmstudio"
        ? createLmStudioClient({
            baseUrl: s.lmStudioBaseUrl,
            timeoutMs: s.requestTimeout,
          })
        : createOllamaClient({
            baseUrl: s.ollamaUrl,
            timeoutMs: s.requestTimeout,
          });
    this._llmClientKey = key;
    return this._llmClient;
  }

  /**
   * Resolve `llm.backend` to a concrete adapter id. `auto` becomes `lmstudio`
   * on macOS only -- this matches LM Studio's primary distribution; on
   * Windows / Linux we keep Ollama as the default. The auto probe is
   * synchronous-best-effort: a live `/v1/models` ping happens lazily inside
   * the LmStudio client itself, so a wrong guess degrades to a clear error
   * rather than silently hanging.
   */
  private _resolveBackend(s: GemmaCodeSettings): "ollama" | "lmstudio" {
    if (s.llmBackend === "ollama") return "ollama";
    if (s.llmBackend === "lmstudio") return "lmstudio";
    if (process.platform === "darwin") return "lmstudio";
    return "ollama";
  }

  /** Current settings snapshot. Always returns the latest known value. */
  get settings(): GemmaCodeSettings {
    return this._settings;
  }

  /**
   * Subscribe to settings changes. Returns a disposer that removes the
   * listener. The runtime delivers updates synchronously when VS Code's
   * configuration change event fires.
   */
  onSettingsChange(listener: (settings: GemmaCodeSettings) => void): { dispose: () => void } {
    this._settingsListeners.push(listener);
    return {
      dispose: () => {
        const i = this._settingsListeners.indexOf(listener);
        if (i >= 0) this._settingsListeners.splice(i, 1);
      },
    };
  }

  dispose(): void {
    this._settingsSubscription.dispose();
    this._settingsListeners.length = 0;
  }
}
