/**
 * v2.0.0 Phase 1 -- process-wide STT/TTS runtime for the sidecar.
 *
 * Chat `audio.*` IPC must share one Python child. Tests inject `ctx.audio`
 * and never touch this.
 */

import { createAudioRuntime, type AudioRuntime } from "../../../../core/audio/audioRuntimeFactory.js";

let _audioRuntime: AudioRuntime | null = null;

export function getSharedAudioRuntime(override?: AudioRuntime): AudioRuntime {
  if (override) return override;
  if (!_audioRuntime) _audioRuntime = createAudioRuntime();
  return _audioRuntime;
}

/** Test seam: drop the memoized client so the next call rebuilds. */
export function resetSharedAudioRuntime(): void {
  _audioRuntime = null;
}
