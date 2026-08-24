import { afterEach, describe, expect, it } from "vitest";

import { createInMemoryAudioClient, createIpcAudioClient } from "../src/modules/chat/audioClient";
import { clearInvokeOverride, setInvokeOverride } from "../src/lib/ipc";

afterEach(() => {
  clearInvokeOverride();
});

describe("createInMemoryAudioClient", () => {
  it("reports health and refuses transcribe when STT is missing", async () => {
    const client = createInMemoryAudioClient({ sttInstalled: false, ttsInstalled: true });
    const health = await client.health();
    expect(health.sttInstalled).toBe(false);
    expect(health.ttsInstalled).toBe(true);
    await expect(client.transcribe("AAAA")).rejects.toThrow(/STT weights/);
  });
});

describe("createIpcAudioClient", () => {
  it("maps sidecar health and transcribe replies", async () => {
    setInvokeOverride(async (_cmd, args) => {
      const method = (args as { method: string }).method;
      if (method === "audio.health") {
        return {
          ok: true,
          stt: { available: true, reason: "ok" },
          tts: { available: false, reason: "missing" },
          platform: "test",
        };
      }
      if (method === "audio.transcribe") {
        return { transcript: "[origin:stt_transcript]\nhi", origin: "stt_transcript" };
      }
      if (method === "audio.speak") {
        return { audioBase64: "QQ==", mimeType: "audio/wav" };
      }
      throw new Error(`unexpected ${method}`);
    });
    const client = createIpcAudioClient();
    const health = await client.health();
    expect(health.sttInstalled).toBe(true);
    expect(health.ttsInstalled).toBe(false);
    const text = await client.transcribe("AAAA", "audio/wav");
    expect(text.origin).toBe("stt_transcript");
    const spoken = await client.speak("hello");
    expect(spoken.mimeType).toBe("audio/wav");
  });

  it("surfaces ipc-unavailable as a health miss rather than throwing", async () => {
    setInvokeOverride(null);
    const client = createIpcAudioClient();
    const health = await client.health();
    expect(health.sttInstalled).toBe(false);
    await expect(client.transcribe("AAAA")).rejects.toThrow(/ipc-unavailable/);
  });
});
