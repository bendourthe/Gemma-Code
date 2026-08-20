import { describe, expect, it } from "vitest";

import {
  INITIAL_VOICE_LOOP,
  isMicOpen,
  reduceVoiceLoop,
  shouldStopTts,
} from "../src/modules/chat/voiceLoop";

describe("voiceLoop state machine", () => {
  it("shows the capture indicator while push-to-talk is held", () => {
    const recording = reduceVoiceLoop(INITIAL_VOICE_LOOP, { type: "ptt-down" });
    expect(recording.phase).toBe("recording");
    expect(recording.captureVisible).toBe(true);
    expect(isMicOpen(recording)).toBe(true);
    const transcribing = reduceVoiceLoop(recording, { type: "ptt-up" });
    expect(transcribing.phase).toBe("transcribing");
    expect(transcribing.captureVisible).toBe(false);
  });

  it("runs VAD start / silence into transcribing", () => {
    const armed = reduceVoiceLoop(INITIAL_VOICE_LOOP, { type: "set-mode", mode: "vad" });
    const recording = reduceVoiceLoop(armed, { type: "vad-start" });
    expect(isMicOpen(recording)).toBe(true);
    const next = reduceVoiceLoop(recording, { type: "silence" });
    expect(next.phase).toBe("transcribing");
  });

  it("barge-in stops TTS and re-opens the mic", () => {
    let state = reduceVoiceLoop(INITIAL_VOICE_LOOP, { type: "ptt-down" });
    state = reduceVoiceLoop(state, { type: "ptt-up" });
    state = reduceVoiceLoop(state, { type: "transcript-ready" });
    state = reduceVoiceLoop(state, { type: "reply-ready" });
    expect(state.phase).toBe("speaking");
    const barged = reduceVoiceLoop(state, { type: "barge-in" });
    expect(shouldStopTts(state, barged)).toBe(true);
    expect(barged.phase).toBe("recording");
    expect(barged.captureVisible).toBe(true);
  });

  it("ptt-down during speaking is barge-in", () => {
    let state = reduceVoiceLoop(INITIAL_VOICE_LOOP, { type: "ptt-down" });
    state = reduceVoiceLoop(state, { type: "ptt-up" });
    state = reduceVoiceLoop(state, { type: "transcript-ready" });
    state = reduceVoiceLoop(state, { type: "tts-started" });
    const next = reduceVoiceLoop(state, { type: "ptt-down" });
    expect(next.phase).toBe("recording");
  });
});
