import { describe, it, expect } from "vitest";
import { toLlmMessages } from "../../../modules/coding/chat/llmMessages.js";
import type { Message } from "../../../modules/coding/chat/types.js";

function msg(partial: Partial<Message> & Pick<Message, "role" | "content">): Message {
  return { id: "id", timestamp: 0, ...partial };
}

describe("toLlmMessages", () => {
  const history: readonly Message[] = [
    msg({ role: "system", content: "sys" }),
    msg({ role: "user", content: "look at this", images: ["BASE64IMG"] }),
    msg({ role: "assistant", content: "ok" }),
  ];

  it("forwards images when the model is vision-capable", () => {
    const out = toLlmMessages(history, true);
    expect(out).toHaveLength(3);
    expect(out[1]).toEqual({ role: "user", content: "look at this", images: ["BASE64IMG"] });
  });

  it("drops images when the model is text-only", () => {
    const out = toLlmMessages(history, false);
    expect(out[1]).toEqual({ role: "user", content: "look at this" });
    expect(out[1]).not.toHaveProperty("images");
  });

  it("omits the images field entirely for messages without attachments", () => {
    const out = toLlmMessages(history, true);
    expect(out[0]).toEqual({ role: "system", content: "sys" });
    expect(out[0]).not.toHaveProperty("images");
    expect(out[2]).not.toHaveProperty("images");
  });

  it("treats an empty images array as no attachment", () => {
    const out = toLlmMessages([msg({ role: "user", content: "hi", images: [] })], true);
    expect(out[0]).toEqual({ role: "user", content: "hi" });
    expect(out[0]).not.toHaveProperty("images");
  });
});
