/**
 * v2.0.0 Phase 1 -- injectable mic recorder for MediaComposer.
 *
 * Production uses getUserMedia + MediaRecorder. Tests inject a fake so jsdom
 * never needs audio hardware. Capture is always behind an explicit click.
 */

export interface MicRecorder {
  start(): Promise<void>;
  stop(): Promise<string>;
}

export interface MicRecorderDeps {
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  MediaRecorderImpl?: typeof MediaRecorder;
  onSpeechStart?: () => void;
  onSilence?: () => void;
  rmsThreshold?: number;
  silenceMs?: number;
}

export function attachRmsVad(
  stream: MediaStream,
  opts: {
    onSpeechStart?: () => void;
    onSilence?: () => void;
    rmsThreshold?: number;
    silenceMs?: number;
    AudioContextImpl?: typeof AudioContext;
  },
): () => void {
  const AudioCtx = opts.AudioContextImpl ?? (typeof AudioContext !== "undefined" ? AudioContext : undefined);
  if (!AudioCtx) return () => undefined;
  const ctx = new AudioCtx();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  const data = new Uint8Array(analyser.fftSize);
  const threshold = opts.rmsThreshold ?? 0.02;
  const silenceMs = opts.silenceMs ?? 800;
  let lastSpeech = Date.now();
  let speaking = false;
  const timer = setInterval(() => {
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (const v of data) {
      const n = (v - 128) / 128;
      sum += n * n;
    }
    const rms = Math.sqrt(sum / data.length);
    if (rms >= threshold) {
      lastSpeech = Date.now();
      if (!speaking) {
        speaking = true;
        opts.onSpeechStart?.();
      }
    } else if (speaking && Date.now() - lastSpeech >= silenceMs) {
      speaking = false;
      opts.onSilence?.();
    }
  }, 80);
  return () => {
    clearInterval(timer);
    void ctx.close();
  };
}

export function createBrowserMicRecorder(deps: MicRecorderDeps = {}): MicRecorder {
  let recorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let stream: MediaStream | null = null;
  let stopVad: (() => void) | null = null;

  return {
    async start() {
      const gum =
        deps.getUserMedia ??
        ((constraints: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(constraints));
      stream = await gum({ audio: true });
      if (deps.onSpeechStart || deps.onSilence) {
        stopVad = attachRmsVad(stream, {
          onSpeechStart: deps.onSpeechStart,
          onSilence: deps.onSilence,
          rmsThreshold: deps.rmsThreshold,
          silenceMs: deps.silenceMs,
        });
      }
      const Ctor = deps.MediaRecorderImpl ?? MediaRecorder;
      chunks = [];
      recorder = new Ctor(stream);
      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.start();
    },
    async stop() {
      stopVad?.();
      stopVad = null;
      const rec = recorder;
      const live = stream;
      recorder = null;
      stream = null;
      if (!rec) return "";
      const blob = await new Promise<Blob>((resolve) => {
        rec.onstop = () => resolve(new Blob(chunks, { type: rec.mimeType || "audio/webm" }));
        rec.stop();
      });
      live?.getTracks().forEach((t) => t.stop());
      return readBlobAsDataUrl(blob);
    },
  };
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}
