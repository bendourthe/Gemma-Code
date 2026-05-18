import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  Tracer,
  skillContextAttributes,
  readSkillContextFromAttributes,
} from "../../../src/observability/Tracer.js";
import { TraceStore } from "../../../src/observability/TraceStore.js";

describe("Tracer skill provenance (Phase 10.5)", () => {
  let tracer: Tracer;
  let store: TraceStore;

  beforeEach(() => {
    tracer = new Tracer();
    store = new TraceStore(":memory:");
    tracer.init(store);
  });

  afterEach(() => {
    store.close();
  });

  it("flattens SkillSpanContext to skill.* attributes", () => {
    const flat = skillContextAttributes({
      id: "devai-hub/code-quality",
      namespace: "devai-hub",
      tag: "v1.3.2",
      contentHash: "abcd1234",
    });
    expect(flat).toEqual({
      "skill.id": "devai-hub/code-quality",
      "skill.namespace": "devai-hub",
      "skill.tag": "v1.3.2",
      "skill.contentHash": "abcd1234",
    });
  });

  it("flattening omits tag and contentHash when absent", () => {
    const flat = skillContextAttributes({
      id: "writing-editing",
      namespace: "builtin",
    });
    expect(flat).toEqual({
      "skill.id": "writing-editing",
      "skill.namespace": "builtin",
    });
  });

  it("readSkillContextFromAttributes round-trips", () => {
    const ctx = {
      id: "devai-hub/code-quality",
      namespace: "devai-hub" as const,
      tag: "v1.3.2",
      contentHash: "abcd1234",
    };
    const back = readSkillContextFromAttributes(skillContextAttributes(ctx));
    expect(back).toEqual(ctx);
  });

  it("readSkillContextFromAttributes returns null when no skill.* keys", () => {
    expect(readSkillContextFromAttributes({})).toBeNull();
    expect(readSkillContextFromAttributes({ other: "x" })).toBeNull();
  });

  it("readSkillContextFromAttributes rejects an unknown namespace", () => {
    expect(
      readSkillContextFromAttributes({
        "skill.id": "x",
        "skill.namespace": "rogue",
      }),
    ).toBeNull();
  });

  it("startSpan(tool_call) folds skill context into attributes", () => {
    const traceId = tracer.startTrace("session-1");
    tracer.setCurrentSkill({
      id: "devai-hub/code-quality",
      namespace: "devai-hub",
      tag: "v1.3.2",
      contentHash: "abcd1234",
    });
    const spanId = tracer.startSpan(traceId, "tool_grep", "tool_call", undefined, {
      toolName: "grep",
    });
    tracer.endSpan(spanId, "ok");
    store.flush();
    const span = store.getSpan(spanId)!;
    expect(span.attributes["skill.id"]).toBe("devai-hub/code-quality");
    expect(span.attributes["skill.namespace"]).toBe("devai-hub");
    expect(span.attributes["skill.tag"]).toBe("v1.3.2");
    expect(span.attributes["toolName"]).toBe("grep");
  });

  it("does NOT fold skill context into non-tool-call spans", () => {
    const traceId = tracer.startTrace("session-1");
    tracer.setCurrentSkill({
      id: "devai-hub/code-quality",
      namespace: "devai-hub",
      tag: "v1.3.2",
    });
    const spanId = tracer.startSpan(traceId, "llm-call", "llm_call");
    tracer.endSpan(spanId, "ok");
    store.flush();
    const span = store.getSpan(spanId)!;
    expect(span.attributes["skill.id"]).toBeUndefined();
  });

  it("clears the skill context when setCurrentSkill(null) is called", () => {
    const traceId = tracer.startTrace("session-1");
    tracer.setCurrentSkill({ id: "x", namespace: "builtin" });
    expect(tracer.currentSkill).not.toBeNull();
    tracer.setCurrentSkill(null);
    expect(tracer.currentSkill).toBeNull();
    const spanId = tracer.startSpan(traceId, "tool_x", "tool_call");
    tracer.endSpan(spanId, "ok");
    store.flush();
    const span = store.getSpan(spanId)!;
    expect(span.attributes["skill.id"]).toBeUndefined();
  });

  it("folds skill context into sub_agent spans too", () => {
    const traceId = tracer.startTrace("session-1");
    tracer.setCurrentSkill({ id: "devai-hub/code-quality", namespace: "devai-hub" });
    const spanId = tracer.startSpan(traceId, "sub", "sub_agent");
    tracer.endSpan(spanId, "ok");
    store.flush();
    const span = store.getSpan(spanId)!;
    expect(span.attributes["skill.namespace"]).toBe("devai-hub");
  });
});
