import { Tracer } from "../observability/Tracer.js";
import { getSettings, onSettingsChange, type GemmaCodeSettings } from "../config/settings.js";

/**
 * Composition root for the extension. Owns the singleton-like cross-cutting
 * concerns (Tracer, settings snapshot + change subscription) so individual
 * subsystems no longer reach into shared static state. The runtime is created
 * once in `extension.ts` activation and threaded into every consumer.
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

  constructor() {
    this.tracer = new Tracer();
    this._settings = getSettings();
    this._settingsSubscription = onSettingsChange((next) => {
      this._settings = next;
      for (const listener of this._settingsListeners) {
        listener(next);
      }
    });
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
