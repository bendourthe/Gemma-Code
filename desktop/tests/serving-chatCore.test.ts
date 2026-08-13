/**
 * v1.16.0 Phase 1.6 (adoption item A1) -- shared completion plumbing.
 *
 * The pure translation helpers both wire dialects depend on. Tested directly
 * (rather than only through the gateway's socket-level tests) because their edge
 * cases -- structured content parts, unusual roles, absent sampling options --
 * are cheap to enumerate here and expensive to enumerate over HTTP.
 */

import { describe, expect, it } from "vitest";

import {
  buildChatRequest,
  flattenContent,
  normalizeRole,
  toLlmOptions,
} from "../sidecar/src/serving/chatCore";
import { ServingHttpError } from "../sidecar/src/serving/errors";

describe("flattenContent", () => {
  it("passes a plain string through", () => {
    expect(flattenContent("hello")).toEqual({ text: "hello", images: [] });
  });

  it("joins multiple text parts with newlines", () => {
    expect(
      flattenContent([
        { type: "text", text: "one" },
        { type: "text", text: "two" },
      ]),
    ).toEqual({ text: "one\ntwo", images: [] });
  });

  it("strips the data-URL prefix from an OpenAI image part", () => {
    expect(
      flattenContent([{ type: "image_url", image_url: { url: "data:image/png;base64,QUJD" } }]),
    ).toEqual({ text: "", images: ["QUJD"] });
  });

  it("keeps a bare base64 image_url unchanged", () => {
    expect(flattenContent([{ type: "image_url", image_url: { url: "QUJD" } }]).images).toEqual([
      "QUJD",
    ]);
  });

  it("reads an Anthropic structured image block", () => {
    expect(
      flattenContent([{ type: "image", source: { type: "base64", data: "WFla" } }]).images,
    ).toEqual(["WFla"]);
  });

  it("ignores an Anthropic image block with no data", () => {
    expect(flattenContent([{ type: "image", source: { type: "url" } }]).images).toEqual([]);
  });

  it("handles a mixed text + image transcript", () => {
    const out = flattenContent([
      { type: "text", text: "describe this" },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,SU1H" } },
    ]);
    expect(out).toEqual({ text: "describe this", images: ["SU1H"] });
  });

  it("returns empty text for an empty parts array", () => {
    expect(flattenContent([])).toEqual({ text: "", images: [] });
  });
});

describe("normalizeRole", () => {
  it.each([
    ["system", "system"],
    ["developer", "system"],
    ["assistant", "assistant"],
    ["user", "user"],
    ["tool", "user"],
    ["something-unexpected", "user"],
  ])("maps %s to %s", (input, expected) => {
    expect(normalizeRole(input)).toBe(expected);
  });
});

describe("toLlmOptions", () => {
  it("returns undefined when no knob is set, so no options key is sent", () => {
    expect(toLlmOptions({})).toBeUndefined();
  });

  it("maps only the knobs that are present", () => {
    expect(toLlmOptions({ temperature: 0.3 })).toEqual({ temperature: 0.3 });
  });

  it("maps every supported knob", () => {
    expect(toLlmOptions({ temperature: 0.1, top_p: 0.2, top_k: 3, num_ctx: 4 })).toEqual({
      temperature: 0.1,
      top_p: 0.2,
      top_k: 3,
      num_ctx: 4,
    });
  });

  it("preserves an explicit zero temperature", () => {
    expect(toLlmOptions({ temperature: 0 })).toEqual({ temperature: 0 });
  });
});

describe("buildChatRequest", () => {
  it("builds a port request from the resolved runtime model name", () => {
    expect(
      buildChatRequest({
        modelName: "gemma4:12b",
        messages: [{ role: "user", content: "hi" }],
        stream: true,
      }),
    ).toEqual({
      model: "gemma4:12b",
      messages: [{ role: "user", content: "hi" }],
      stream: true,
    });
  });

  it("omits the options key entirely when none are given", () => {
    const req = buildChatRequest({
      modelName: "m",
      messages: [{ role: "user", content: "hi" }],
      stream: false,
    });
    expect("options" in req).toBe(false);
  });

  it("includes options when supplied", () => {
    const req = buildChatRequest({
      modelName: "m",
      messages: [{ role: "user", content: "hi" }],
      stream: false,
      options: { temperature: 0.5 },
    });
    expect(req.options).toEqual({ temperature: 0.5 });
  });

  it("rejects an empty transcript as a 400, not an upstream failure", () => {
    try {
      buildChatRequest({ modelName: "m", messages: [], stream: false });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ServingHttpError);
      expect((err as ServingHttpError).status).toBe(400);
    }
  });
});
