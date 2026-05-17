import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CodingPage } from "../src/modules/coding/CodingPage";
import {
  clearInvokeOverride,
  setInvokeOverride,
} from "../src/lib/ipc";

interface InvokeArgs {
  method: string;
  params: Record<string, unknown>;
}

function makeFakeInvoke() {
  const calls: InvokeArgs[] = [];
  const fakeSessions = [
    {
      sessionId: "prev-1",
      modelId: "qwen2.5-coder:7b",
      family: "qwen",
      title: "Prior session",
      createdAt: "2026-05-17T10:00:00Z",
      messageCount: 4,
    },
  ];
  const invoke = vi.fn(async (_cmd: string, args?: Record<string, unknown>): Promise<unknown> => {
    const a = args as unknown as InvokeArgs;
    calls.push(a);
    switch (a.method) {
      case "coding.session.start":
        return {
          sessionId: "sess-1",
          modelId: (a.params.modelId as string) ?? "gemma4:e4b",
          family: "gemma",
          createdAt: "2026-05-17T11:00:00Z",
        };
      case "coding.session.sendMessage":
        return {
          sessionId: a.params.sessionId,
          events: [
            { kind: "token", text: "ok" },
            { kind: "done", finishReason: "stop" },
          ],
        };
      case "coding.session.cancel":
        return { sessionId: a.params.sessionId, cancelled: true };
      case "coding.memory.snapshot":
        return {
          snapshot: {
            layers: { core: ["c1"], recent: [], working: [], project: [] },
            anticipated: ["anticipated-1"],
            proposedSkills: [],
          },
        };
      case "coding.trace.subscribe":
        return {
          events: [
            { id: "t-1", timestamp: "2026-05-17T11:00:00Z", kind: "tool", summary: "trace-summary" },
          ],
        };
      case "coding.sessions.list":
        return { sessions: fakeSessions };
      default:
        throw new Error(`Unexpected method: ${a.method}`);
    }
  });
  return { invoke, calls };
}

describe("CodingPage", () => {
  beforeEach(() => {
    const fake = makeFakeInvoke();
    setInvokeOverride(async (_cmd, args) => fake.invoke("ipc_call", args ?? {}));
  });

  afterEach(() => {
    clearInvokeOverride();
  });

  it("renders the model selector and the chat empty state by default", () => {
    render(<CodingPage />);
    expect(screen.getByTestId("coding-model-select")).toBeInTheDocument();
    expect(screen.getByTestId("coding-chat")).toHaveTextContent(/Start by asking/);
  });

  it("submitting a message starts a session and renders the rendered turn", async () => {
    render(<CodingPage />);
    await userEvent.type(screen.getByTestId("coding-input-textarea"), "Hello agent");
    await userEvent.click(screen.getByTestId("coding-input-submit"));
    await waitFor(() => {
      expect(screen.getByTestId("coding-chat")).toHaveTextContent("Hello agent");
    });
  });

  it("renders the Memory panel when the Memory tab is selected", async () => {
    render(<CodingPage initialTab="memory" />);
    await waitFor(() => {
      expect(screen.getByTestId("memory-panel")).toHaveTextContent("c1");
    });
  });

  it("renders the Trace panel when the Trace tab is selected", async () => {
    render(<CodingPage initialTab="trace" />);
    await waitFor(() => {
      expect(screen.getByTestId("trace-panel")).toHaveTextContent("trace-summary");
    });
  });

  it("renders the Sessions panel when the Sessions tab is selected", async () => {
    render(<CodingPage initialTab="sessions" />);
    await waitFor(() => {
      expect(screen.getByTestId("session-prev-1")).toBeInTheDocument();
    });
  });

  it("model select changes the modelId before a session starts", async () => {
    render(<CodingPage />);
    const select = screen.getByTestId("coding-model-select") as HTMLSelectElement;
    await userEvent.selectOptions(select, "qwen2.5-coder:7b");
    expect(select.value).toBe("qwen2.5-coder:7b");
  });

  it("shows an error banner when the IPC layer is unavailable", async () => {
    clearInvokeOverride();
    render(<CodingPage />);
    await userEvent.type(screen.getByTestId("coding-input-textarea"), "hi");
    await userEvent.click(screen.getByTestId("coding-input-submit"));
    await waitFor(() => {
      expect(screen.getByTestId("coding-error")).toBeInTheDocument();
    });
  });

  it("tab navigation switches between Chat / Memory / Trace / Sessions", async () => {
    render(<CodingPage />);
    await userEvent.click(screen.getByTestId("coding-tab-memory"));
    await waitFor(() => expect(screen.getByTestId("memory-panel")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("coding-tab-chat"));
    expect(screen.getByTestId("coding-chat")).toBeInTheDocument();
  });
});
