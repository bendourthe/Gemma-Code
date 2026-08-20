import { describe, expect, it } from "vitest";

import { CodingSessionManager } from "../sidecar/src/coding/sessionManager";
import { createHandlerContext, dispatch } from "../sidecar/src/handlers";
import {
  AudioHealthResponse,
  AudioSpeakResponse,
  AudioTranscribeResponse,
  type AudioHealthResponseT,
} from "../sidecar/src/protocol";
import { InMemoryAudioRuntime } from "../../core/audio/AudioRuntimeClient";
import { REDACTED } from "../../core/observability/redactSecrets";

function ctx(runtime: InMemoryAudioRuntime) {
  return {
    ...createHandlerContext(
      { pid: 1, platform: process.platform },
      new CodingSessionManager(),
    ),
    audio: runtime,
  };
}

describe("audio.health", () => {
  it("reports STT/TTS availability from the injected runtime", async () => {
    const runtime = new InMemoryAudioRuntime();
    const reply = (await dispatch("audio.health", {}, ctx(runtime))) as AudioHealthResponseT;
    expect(AudioHealthResponse.parse(reply).ok).toBe(true);
    expect(reply.stt.available).toBe(true);
    expect(reply.tts.available).toBe(true);
  });
});

describe("audio.transcribe", () => {
  it("returns a provenance-labelled, secret-scrubbed transcript", async () => {
    const runtime = new InMemoryAudioRuntime();
    runtime.transcribeImpl = () => "leak ghp_abcdefghijklmnopqrstuvwxyz0123456789ABCD";
    const reply = await dispatch(
      "audio.transcribe",
      { audioBase64: "AAAA" },
      ctx(runtime),
    );
    const parsed = AudioTranscribeResponse.parse(reply);
    expect(parsed.origin).toBe("stt_transcript");
    expect(parsed.transcript).toContain("[origin:stt_transcript]");
    expect(parsed.transcript).toContain(REDACTED);
    expect(parsed.transcript).not.toMatch(/ghp_/);
  });

  it("rejects a missing payload", async () => {
    await expect(dispatch("audio.transcribe", {}, ctx(new InMemoryAudioRuntime()))).rejects.toThrow();
  });
});

describe("audio.speak", () => {
  it("returns local wav bytes", async () => {
    const reply = await dispatch(
      "audio.speak",
      { text: "hello" },
      ctx(new InMemoryAudioRuntime()),
    );
    const parsed = AudioSpeakResponse.parse(reply);
    expect(parsed.mimeType).toBe("audio/wav");
    expect(parsed.audioBase64.length).toBeGreaterThan(8);
  });
});
