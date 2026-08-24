/**
 * v2.0.0 Phase 1 -- Node client for the local STT/TTS runtime.
 *
 * Mirrors `core/documents/OcrRuntimeClient` (line-delimited JSON-RPC over a
 * Python child) without job polling: transcribe and speak are request/response.
 * Weights come from the installer catalog path (`faster-whisper-large-v3`,
 * `kokoro-82m`). No outbound calls.
 */

import {
  type ChildProcessWithoutNullStreams,
  type SpawnOptions,
  spawn,
} from "node:child_process";
import { createInterface, type Interface } from "node:readline";

import { prepareSttTranscript, STT_TRANSCRIPT_ORIGIN } from "./transcript.js";

export interface AudioHealth {
  readonly ok: boolean;
  readonly stt: { readonly available: boolean; readonly reason: string };
  readonly tts: { readonly available: boolean; readonly reason: string };
  readonly platform: string;
}

export interface AudioTranscribeResult {
  readonly transcript: string;
  readonly origin: typeof STT_TRANSCRIPT_ORIGIN;
}

export interface AudioSpeakResult {
  readonly audioBase64: string;
  readonly mimeType: string;
}

export interface AudioRuntimeClient {
  health(): Promise<AudioHealth>;
  transcribe(input: { audioBase64: string; mimeType?: string }): Promise<AudioTranscribeResult>;
  speak(input: { text: string }): Promise<AudioSpeakResult>;
  shutdown(): Promise<void>;
}

const STUB_WAV_B64 =
  "UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=";

/**
 * In-memory client for tests and `NEXUS_AUDIO_INMEMORY=1`. Never spawns Python.
 */
export class InMemoryAudioRuntime implements AudioRuntimeClient {
  lastTranscribe: { audioBase64: string; mimeType?: string } | null = null;
  lastSpeak: { text: string } | null = null;
  sttAvailable = true;
  ttsAvailable = true;
  transcribeImpl: ((audioBase64: string) => string) | null = null;

  async health(): Promise<AudioHealth> {
    return {
      ok: this.sttAvailable || this.ttsAvailable,
      stt: {
        available: this.sttAvailable,
        reason: this.sttAvailable ? "in-memory" : "stt unavailable",
      },
      tts: {
        available: this.ttsAvailable,
        reason: this.ttsAvailable ? "in-memory" : "tts unavailable",
      },
      platform: "in-memory",
    };
  }

  async transcribe(input: { audioBase64: string; mimeType?: string }): Promise<AudioTranscribeResult> {
    this.lastTranscribe = input;
    if (!this.sttAvailable) {
      throw new Error("STT weights are not installed. Install faster-whisper-large-v3 from Settings > Models.");
    }
    const raw = this.transcribeImpl
      ? this.transcribeImpl(input.audioBase64)
      : "in-memory transcript";
    return prepareSttTranscript(raw);
  }

  async speak(input: { text: string }): Promise<AudioSpeakResult> {
    this.lastSpeak = input;
    if (!this.ttsAvailable) {
      throw new Error("TTS weights are not installed. Install kokoro-82m from Settings > Models.");
    }
    return { audioBase64: STUB_WAV_B64, mimeType: "audio/wav" };
  }

  async shutdown(): Promise<void> {
    this.lastTranscribe = null;
    this.lastSpeak = null;
  }
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

export interface AudioChildProcessOptions {
  readonly command?: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly spawnFn?: typeof spawn;
  readonly requestTimeoutMs?: number;
}

export class ChildProcessAudioRuntime implements AudioRuntimeClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private rl: Interface | null = null;
  private readonly pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private readonly requestTimeoutMs: number;

  constructor(private readonly options: AudioChildProcessOptions = {}) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? 120_000;
  }

  private ensureSpawned(): ChildProcessWithoutNullStreams {
    if (this.child) return this.child;
    const spawnFn = this.options.spawnFn ?? spawn;
    const command = this.options.command ?? "python";
    const args = [...(this.options.args ?? ["-m", "runtimes.audio.main"])];
    const spawnOpts: SpawnOptions = {
      cwd: this.options.cwd,
      env: this.options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
    };
    const child = spawnFn(command, args, spawnOpts) as ChildProcessWithoutNullStreams;
    this.child = child;
    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
    this.rl = rl;
    rl.on("line", (line: string) => this.handleLine(line));
    child.on("exit", () => {
      this.failPending(new Error("audio-runtime-exited"));
      this.child = null;
      this.rl = null;
    });
    child.on("error", (err: Error) => this.failPending(err));
    return child;
  }

  private failPending(err: Error): void {
    for (const [, p] of this.pending) p.reject(err);
    this.pending.clear();
  }

  private handleLine(line: string): void {
    if (!line.trim()) return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    if (typeof parsed.id !== "number") return;
    const entry = this.pending.get(parsed.id);
    if (!entry) return;
    this.pending.delete(parsed.id);
    if (parsed.error && typeof parsed.error === "object") {
      const errObj = parsed.error as { message?: string };
      entry.reject(new Error(errObj.message ?? "audio-runtime-error"));
    } else {
      entry.resolve(parsed.result ?? null);
    }
  }

  private call<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const child = this.ensureSpawned();
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) {
          reject(new Error(`audio.${method}: timeout after ${this.requestTimeoutMs}ms`));
        }
      }, this.requestTimeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value as T);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      child.stdin.write(payload + "\n");
    });
  }

  async health(): Promise<AudioHealth> {
    return this.call<AudioHealth>("health", {});
  }

  async transcribe(input: { audioBase64: string; mimeType?: string }): Promise<AudioTranscribeResult> {
    const raw = await this.call<{ transcript?: string }>("transcribe", {
      audioBase64: input.audioBase64,
      ...(input.mimeType ? { mimeType: input.mimeType } : {}),
    });
    return prepareSttTranscript(raw.transcript ?? "");
  }

  async speak(input: { text: string }): Promise<AudioSpeakResult> {
    return this.call<AudioSpeakResult>("speak", { text: input.text });
  }

  async shutdown(): Promise<void> {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
    if (this.child) {
      const child = this.child;
      this.child = null;
      try {
        child.stdin.end();
      } catch {
        // already closed
      }
      child.kill();
    }
    this.failPending(new Error("audio-runtime-shutdown"));
  }
}
