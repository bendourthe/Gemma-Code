import { describe, expect, it } from "vitest";

import { classifyDataUrl, partitionAttachments } from "../src/shared/chat/classifyAttachment";
import { mimeFromDataUrl, stripDataUrlPrefix } from "../src/shared/chat/dataUrl";

describe("classifyAttachment", () => {
  it("splits images, audio, and documents", () => {
    const groups = partitionAttachments([
      "data:image/png;base64,AAA",
      "data:audio/webm;base64,BBB",
      "data:application/pdf;base64,CCC",
    ]);
    expect(groups.images).toHaveLength(1);
    expect(groups.audio).toHaveLength(1);
    expect(groups.documents).toHaveLength(1);
    expect(classifyDataUrl("data:audio/wav;base64,x")).toBe("audio");
    expect(classifyDataUrl("data:video/mp4;base64,x")).toBe("video");
    expect(partitionAttachments(["data:video/webm;base64,x"]).video).toHaveLength(1);
  });
});

describe("dataUrl", () => {
  it("strips a data URL prefix and passes raw base64 through", () => {
    expect(stripDataUrlPrefix("data:image/png;base64,QUJD")).toBe("QUJD");
    expect(stripDataUrlPrefix("QUJD")).toBe("QUJD");
    expect(mimeFromDataUrl("data:audio/webm;base64,xx")).toBe("audio/webm");
  });
});
