/**
 * v2.0.0 Phase 1 -- provenance wrapper for STT transcripts.
 *
 * Transcripts enter the prompt as labelled data, never as instructions.
 * Secret scrubbing happens on the sidecar transcribe path (`redactSecrets`)
 * before this wrapper is shown; the renderer only attaches the origin class
 * from v1.19.1 Phase 2.6.
 *
 * Native audio-token reasoning is out of scope until a fitting local model
 * exists (plan Phase 1.2 known-gap).
 */

export const STT_TRANSCRIPT_ORIGIN = "stt_transcript" as const;

export type SttTranscriptOrigin = typeof STT_TRANSCRIPT_ORIGIN;

const ORIGIN_HEADER = `[origin:${STT_TRANSCRIPT_ORIGIN}]`;

export function labelSttTranscript(transcript: string): string {
  const body = transcript.trim();
  if (!body) return `${ORIGIN_HEADER}\n(empty transcript)`;
  if (body.startsWith(ORIGIN_HEADER)) return body;
  return `${ORIGIN_HEADER}\n${body}`;
}

export function isSttTranscript(text: string): boolean {
  return text.startsWith(ORIGIN_HEADER);
}
