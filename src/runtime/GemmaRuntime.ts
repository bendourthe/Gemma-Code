import { Tracer } from "../observability/Tracer.js";
import { getSettings, onSettingsChange, type GemmaCodeSettings } from "../config/settings.js";
import { createOllamaClient } from "../llm/OllamaClient.js";
import type { LLMClient } from "../llm/types.js";

/**
 * Composition root for the extension. Owns the singleton-like cross-cutting
 * concerns (Tracer, settings snapshot + change subscription, LLM port) so
 * individual subsystems no longer reach into shared static state. The
 * runtime is created once in `extension.ts` activation and threaded into
 * every consumer.
 *
 * This is the v0.4.0 starting point for the panel-split work. The full
 * `ChatController` / `ChatWebviewHost` extraction (Phase 6 sub-task 6.2) is
 * deferred — `GemmaCodePanel` continues to host the agent loop wiring for
 * now, but it now receives `GemmaRuntime` rather than reaching for shared
 * statics. Subsequent versions can extract Controller and Host without
 * disturbing the contract this class exposes.
 */
export class GemmaRuntime {
  readonly tracer: Tracer;
  private _settings: GemmaCodeSettings;
  private readonly _settingsListeners: Array<(s: GemmaCodeSettings) => void> = [];
  private readonly _settingsSubscription: { dispose(): void };
  private _llmClient: LLMClient | null = null;
  private _llmClientKey: string | null = null;

  constructor() {
    this.tracer = new Tracer();
    this._settings = getSettings();
    this._settingsSubscription = onSettingsChange((next) => {
      const prev = this._settings;
      this._settings = next;
      // Invalidate the cached LLM client when its inputs change so the next
      // `getOllamaClient` call picks up the new URL or timeout.
      if (
        prev.ollamaUrl !== next.ollamaUrl ||
        prev.requestTimeout !== next.requestTimeout
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
   * Vendor-neutral LLM port. Caches a single instance per `(ollamaUrl,
   * requestTimeout)` pair so subsystems do not allocate one per use; the
   * cache is invalidated automatically when either input changes via
   * `onSettingsChange`. Phase 4 (v0.6.0) sub-task 4.3.
   */
  getOllamaClient(): LLMClient {
    const s = this._settings;
    const key = `${s.ollamaUrl}|${s.requestTimeout}`;
    if (this._llmClient && this._llmClientKey === key) {
      return this._llmClient;
    }
    this._llmClient = createOllamaClient({
      baseUrl: s.ollamaUrl,
      timeoutMs: s.requestTimeout,
    });
    this._llmClientKey = key;
    return this._llmClient;
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
