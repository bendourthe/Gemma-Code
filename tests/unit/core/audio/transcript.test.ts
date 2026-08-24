import { describe, expect, it } from "vitest";

import { REDACTED } from "../../../../core/observability/redactSecrets.js";
import { prepareSttTranscript } from "../../../../core/audio/transcript.js";
import { InMemoryAudioRuntime } from "../../../../core/audio/AudioRuntimeClient.js";
import { createAudioRuntime } from "../../../../core/audio/audioRuntimeFactory.js";

describe("prepareSttTranscript", () => {
  it("redacts secrets and labels the origin class", () => {
    const out = prepareSttTranscript("token ghp_abcdefghijklmnopqrstuvwxyz0123456789ABCD");
    expect(out.origin).toBe("stt_transcript");
    expect(out.transcript).toContain("[origin:stt_transcript]");
    expect(out.transcript).toContain(REDACTED);
    expect(out.transcript).not.toMatch(/ghp_/);
  });

  it("labels an empty body and is idempotent on an already-labelled transcript", () => {
    expect(prepareSttTranscript("   ").transcript).toBe("[origin:stt_transcript]\n(empty transcript)");
    const labelled = "[origin:stt_transcript]\nalready labelled";
    expect(prepareSttTranscript(labelled).transcript).toBe(labelled);
  });
});

describe("InMemoryAudioRuntime", () => {
  it("transcribes and speaks without a Python child", async () => {
    const runtime = new InMemoryAudioRuntime();
    const health = await runtime.health();
    expect(health.stt.available).toBe(true);
    const text = await runtime.transcribe({ audioBase64: "AAAA" });
    expect(text.origin).toBe("stt_transcript");
    const spoken = await runtime.speak({ text: "hi" });
    expect(spoken.mimeType).toBe("audio/wav");
  });
});

describe("createAudioRuntime", () => {
  it("uses the in-memory client when NEXUS_AUDIO_INMEMORY is set", () => {
    const runtime = createAudioRuntime({ NEXUS_AUDIO_INMEMORY: "1" });
    expect(runtime).toBeInstanceOf(InMemoryAudioRuntime);
  });
});
