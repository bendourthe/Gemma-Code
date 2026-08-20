/**
 * v2.0.0 Phase 1 -- sidecar STT transcript prep.
 *
 * Secret-scrub before the transcript is returned to Chat or indexed.
 * Native audio-token reasoning stays out of scope (plan Phase 1.2).
 */

import { redactSecrets } from "../observability/redactSecrets.js";

export const STT_TRANSCRIPT_ORIGIN = "stt_transcript" as const;

const ORIGIN_HEADER = `[origin:${STT_TRANSCRIPT_ORIGIN}]`;

export function prepareSttTranscript(raw: string): {
  readonly transcript: string;
  readonly origin: typeof STT_TRANSCRIPT_ORIGIN;
} {
  const scrubbed = redactSecrets(raw ?? "").trim();
  const body = scrubbed.length > 0 ? scrubbed : "(empty transcript)";
  const labelled = body.startsWith(ORIGIN_HEADER) ? body : `${ORIGIN_HEADER}\n${body}`;
  return { transcript: labelled, origin: STT_TRANSCRIPT_ORIGIN };
}
