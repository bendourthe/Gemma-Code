import { describe, expect, it } from "vitest";

import { isSttTranscript, labelSttTranscript } from "../src/modules/chat/transcriptProvenance";

describe("transcriptProvenance", () => {
  it("labels a transcript with the stt origin class", () => {
    const labelled = labelSttTranscript("hello there");
    expect(labelled).toContain("[origin:stt_transcript]");
    expect(labelled).toContain("hello there");
    expect(isSttTranscript(labelled)).toBe(true);
  });

  it("does not double-wrap an already labelled transcript", () => {
    const once = labelSttTranscript("hi");
    expect(labelSttTranscript(once)).toBe(once);
  });
});
