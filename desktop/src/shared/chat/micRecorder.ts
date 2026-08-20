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

export function createBrowserMicRecorder(
  deps: {
    getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
    MediaRecorderImpl?: typeof MediaRecorder;
  } = {},
): MicRecorder {
  let recorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let stream: MediaStream | null = null;

  return {
    async start() {
      const gum =
        deps.getUserMedia ??
        ((constraints: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(constraints));
      stream = await gum({ audio: true });
      const Ctor = deps.MediaRecorderImpl ?? MediaRecorder;
      chunks = [];
      recorder = new Ctor(stream);
      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.start();
    },
    async stop() {
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
