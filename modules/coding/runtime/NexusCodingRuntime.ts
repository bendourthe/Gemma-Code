import { Tracer } from "../observability/Tracer.js";
import { TraceFile } from "../observability/TraceFile.js";
import {
  getSettings,
  onSettingsChange,
  type GemmaCodeSettings,
} from "../config/settings.js";
import type { LLMClient } from "../llm/types.js";
import {
  LocalAdapterRegistry,
  createDefaultLocalAdapterRegistry,
  LMSTUDIO_ADAPTER_NAME,
  OLLAMA_ADAPTER_NAME,
} from "../llm/LocalAdapterRegistry.js";
import { configureDeniedDestinations } from "../utils/ssrf.js";
import { getLogger } from "../utils/logger.js";

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
  private _adapterRegistry: LocalAdapterRegistry;

  constructor() {
    this.tracer = new Tracer();
    this.traceFile = new TraceFile();
    this._settings = getSettings();
    this._adapterRegistry = this._buildAdapterRegistry(this._settings);
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
      const adaptersChanged =
        JSON.stringify(prev.localAdapters ?? []) !==
        JSON.stringify(next.localAdapters ?? []);
      if (adaptersChanged) {
        this._adapterRegistry = this._buildAdapterRegistry(next);
      }
      if (
        prev.ollamaUrl !== next.ollamaUrl ||
        prev.requestTimeout !== next.requestTimeout ||
        prev.llmBackend !== next.llmBackend ||
        prev.lmStudioBaseUrl !== next.lmStudioBaseUrl ||
        adaptersChanged
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
   * Build the local-adapter registry: the two built-ins (Ollama, LM Studio)
   * plus any user-supplied manifests from `nexus.llm.localAdapters`. Invalid or
   * non-local manifests are skipped with a warning rather than aborting startup,
   * so one bad config entry never blocks the whole pillar.
   */
  private _buildAdapterRegistry(s: GemmaCodeSettings): LocalAdapterRegistry {
    const registry = createDefaultLocalAdapterRegistry();
    for (const raw of s.localAdapters ?? []) {
      const result = registry.tryRegister(raw);
      if (!result.ok) {
        getLogger().warn(
          `[NexusCodingRuntime] skipping invalid local adapter manifest: ${result.error}`,
        );
      }
    }
    return registry;
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
    // Built-ins draw their live base URL from settings; a custom (user-manifest)
    // adapter falls back to its manifest endpoint (override left undefined).
    const baseUrl =
      backend === LMSTUDIO_ADAPTER_NAME
        ? s.lmStudioBaseUrl
        : backend === OLLAMA_ADAPTER_NAME
          ? s.ollamaUrl
          : undefined;
    const key = `${backend}|${s.ollamaUrl}|${s.lmStudioBaseUrl}|${s.requestTimeout}|${baseUrl ?? ""}`;
    if (this._llmClient && this._llmClientKey === key) {
      return this._llmClient;
    }
    this._llmClient = this._adapterRegistry.createClient(backend, {
      baseUrl,
      timeoutMs: s.requestTimeout,
    });
    this._llmClientKey = key;
    return this._llmClient;
  }

  /**
   * Resolve `llm.backend` to a registered adapter name. A user-registered
   * custom adapter is selectable by its manifest name. `auto` (or an
   * unregistered name) becomes `lmstudio` on macOS only -- this matches LM
   * Studio's primary distribution; on Windows / Linux we keep Ollama as the
   * default. The auto probe is synchronous-best-effort: a live `/v1/models`
   * ping happens lazily inside the LmStudio client itself, so a wrong guess
   * degrades to a clear error rather than silently hanging.
   */
  private _resolveBackend(s: GemmaCodeSettings): string {
    const backend = s.llmBackend;
    if (backend && backend !== "auto" && this._adapterRegistry.has(backend)) {
      return backend;
    }
    if (
      process.platform === "darwin" &&
      this._adapterRegistry.has(LMSTUDIO_ADAPTER_NAME)
    ) {
      return LMSTUDIO_ADAPTER_NAME;
    }
    return OLLAMA_ADAPTER_NAME;
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
