import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CodingPage } from "../src/modules/coding/CodingPage";
import {
  clearInvokeOverride,
  setInvokeOverride,
} from "../src/lib/ipc";
import { createInMemoryDocumentClient } from "../src/modules/chat/documentClient";
import { PERSISTENCE_KEYS } from "../src/lib/persistence";

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
      case "models.list":
        return {
          models: [
            {
              id: "gemma4:e4b",
              displayName: "Gemma 4 E4B",
              type: "llm",
              installed: true,
              source: "registry",
            },
            {
              id: "qwen2.5-coder:7b",
              displayName: "Qwen 2.5 Coder 7B",
              type: "llm",
              installed: true,
              source: "registry",
            },
            {
              id: "ltx-video",
              displayName: "LTX-Video",
              type: "video",
              installed: false,
              source: "catalog-only",
            },
          ],
        };
      default:
        throw new Error(`Unexpected method: ${a.method}`);
    }
  });
  return { invoke, calls };
}

describe("CodingPage", () => {
  let fake: ReturnType<typeof makeFakeInvoke>;

  beforeEach(() => {
    window.localStorage.setItem(PERSISTENCE_KEYS.codingWorkspacePath, "C:\\work\\project");
    fake = makeFakeInvoke();
    setInvokeOverride(async (_cmd, args) => fake.invoke("ipc_call", args ?? {}));
  });

  afterEach(() => {
    clearInvokeOverride();
    window.localStorage.clear();
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
    expect(fake.calls.find((call) => call.method === "coding.session.start")?.params).toMatchObject({
      workspacePath: "C:\\work\\project",
    });
  });

  it("refuses to start a session until a workspace is supplied", async () => {
    window.localStorage.removeItem(PERSISTENCE_KEYS.codingWorkspacePath);
    render(<CodingPage />);
    await userEvent.type(screen.getByTestId("coding-input-textarea"), "Hello agent");
    await userEvent.click(screen.getByTestId("coding-input-submit"));
    expect(await screen.findByTestId("coding-error")).toHaveTextContent(
      "Choose a workspace folder",
    );
    expect(fake.calls.some((call) => call.method === "coding.session.start")).toBe(false);
  });

  it("persists and displays the selected workspace in the coding header", async () => {
    render(<CodingPage />);
    const input = screen.getByTestId("coding-workspace-path") as HTMLInputElement;
    expect(input.value).toBe("C:\\work\\project");
    await userEvent.clear(input);
    await userEvent.type(input, "D:\\projects\\client");
    expect(window.localStorage.getItem(PERSISTENCE_KEYS.codingWorkspacePath)).toBe(
      "D:\\projects\\client",
    );
  });

  it("does not start or send until a conflicting active model switch is approved", async () => {
    render(
      <CodingPage
        hostVramFreeGB={1}
        activeSchedulerJob={{
          id: "video-job",
          moduleId: "video",
          jobType: "text2video",
          modelId: "wan2.1-t2v-1.3b",
          estimatedVramGB: 5.5,
          startedAt: 1,
        }}
      />,
    );
    await userEvent.type(screen.getByTestId("coding-input-textarea"), "Hello agent");
    await userEvent.click(screen.getByTestId("coding-input-submit"));
    expect(await screen.findByTestId("coding-model-switch-dialog")).toBeInTheDocument();
    expect(fake.calls.some((call) => call.method === "coding.session.start")).toBe(false);
    expect(fake.calls.some((call) => call.method === "coding.session.sendMessage")).toBe(false);
    await userEvent.click(screen.getByTestId("coding-model-switch-dialog-switch"));
    await waitFor(() =>
      expect(fake.calls.some((call) => call.method === "coding.session.sendMessage")).toBe(true),
    );
    expect(screen.getByTestId("coding-chat")).toHaveTextContent("Hello agent");
  });

  it("shows the working orb while a coding turn is in flight", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fake = makeFakeInvoke();
    setInvokeOverride(async (_cmd, args) => {
      const a = args as unknown as InvokeArgs;
      if (a.method === "coding.session.sendMessage") {
        await gate;
      }
      return fake.invoke("ipc_call", args ?? {});
    });
    render(<CodingPage />);
    await userEvent.type(screen.getByTestId("coding-input-textarea"), "Hello agent");
    await userEvent.click(screen.getByTestId("coding-input-submit"));
    const orb = await screen.findByRole("img", { name: /agent working/i });
    expect(orb).toHaveAttribute("data-agent-activity", "coding-tool-use");
    expect(screen.queryByText("Generating...")).toBeNull();
    expect(screen.getByTestId("coding-composer-beam")).toHaveAttribute("data-beam-mode", "traveling");
    release();
    await waitFor(() => {
      expect(screen.queryByTestId("message-pending-coding-pending")).toBeNull();
    });
    expect(screen.getByTestId("coding-chat")).toHaveTextContent("Hello agent");
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

  it("shows the auto-selected harness badge next to the model switcher", async () => {
    render(<CodingPage />);
    await waitFor(() => {
      expect(screen.getByTestId("coding-model-select-harness")).toHaveTextContent(
        "balanced-scaffold",
      );
    });
  });

  // v2.2.3 Phase 2: the MetalAccent ring was deliberately replaced by the
  // glass treatment -- no `-metal` wrapper remains around New session.
  it("shows a glass New session control after a session starts and clears the transcript", async () => {
    render(<CodingPage />);
    expect(screen.queryByTestId("coding-new-session")).toBeNull();
    await userEvent.type(screen.getByTestId("coding-input-textarea"), "Hello agent");
    await userEvent.click(screen.getByTestId("coding-input-submit"));
    await waitFor(() => {
      expect(screen.getByTestId("coding-chat")).toHaveTextContent("Hello agent");
    });
    const neu = screen.getByTestId("coding-new-session");
    expect(neu.closest("[data-testid$='-metal']")).toBeNull();
    expect(screen.getByTestId("coding-cancel").closest("[data-testid$='-metal']")).toBeNull();
    await userEvent.click(neu);
    await waitFor(() => {
      expect(screen.queryByTestId("coding-new-session")).toBeNull();
      expect(screen.getByTestId("coding-chat")).toHaveTextContent(/Start by asking/);
    });
  });

  it("parses an attached PDF without invoking the coding model", async () => {
    const user = userEvent.setup();
    render(
      <CodingPage
        documentClient={createInMemoryDocumentClient({
          result: {
            engine: "rapidocr",
            text: "INVOICE 12345",
            markdown: null,
            pageCount: 1,
            pages: [{ index: 0, text: "INVOICE 12345" }],
          },
        })}
      />,
    );
    await user.upload(
      screen.getByTestId("coding-input-file"),
      new File(["%PDF-1.7"], "doc.pdf", { type: "application/pdf" }),
    );
    await waitFor(() => expect(screen.getByTestId("coding-input-doc-0")).toBeInTheDocument());
    await user.click(screen.getByTestId("coding-input-submit"));
    await waitFor(() => expect(screen.getByText(/INVOICE 12345/)).toBeInTheDocument());
    expect(screen.getByText(/Parsed with rapidocr/)).toBeInTheDocument();
    expect(fake.calls.filter((c) => c.method === "coding.session.sendMessage")).toHaveLength(0);
    expect(fake.calls.filter((c) => c.method === "coding.session.start")).toHaveLength(0);
  });

  it("parses a dropped Word file without invoking the coding model", async () => {
    const user = userEvent.setup();
    render(
      <CodingPage
        documentClient={createInMemoryDocumentClient({
          result: {
            engine: "docx",
            text: "FROM WORD",
            markdown: "FROM WORD",
            pageCount: 1,
            pages: [{ index: 0, text: "FROM WORD" }],
          },
        })}
      />,
    );
    await user.upload(
      screen.getByTestId("coding-input-file"),
      new File(["PK"], "notes.docx", {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    );
    await user.click(screen.getByTestId("coding-input-submit"));
    await waitFor(() => expect(screen.getByText(/FROM WORD/)).toBeInTheDocument());
    expect(fake.calls.filter((c) => c.method === "coding.session.sendMessage")).toHaveLength(0);
  });

  it("keeps a typed question as a follow-up hint instead of sending it with the parse", async () => {
    const user = userEvent.setup();
    render(
      <CodingPage
        documentClient={createInMemoryDocumentClient({
          result: {
            engine: "stub",
            text: "parsed text",
            markdown: null,
            pageCount: 1,
            pages: [{ index: 0, text: "parsed text" }],
          },
        })}
      />,
    );
    await user.type(screen.getByTestId("coding-input-textarea"), "summarize this");
    await user.upload(
      screen.getByTestId("coding-input-file"),
      new File(["%PDF-1.7"], "doc.pdf", { type: "application/pdf" }),
    );
    await user.click(screen.getByTestId("coding-input-submit"));
    await waitFor(() =>
      expect(screen.getByText(/Ask a follow-up question/)).toBeInTheDocument(),
    );
    expect(fake.calls.filter((c) => c.method === "coding.session.sendMessage")).toHaveLength(0);
  });

  it("sends a follow-up text turn to the coding model after a parse", async () => {
    const user = userEvent.setup();
    render(
      <CodingPage
        documentClient={createInMemoryDocumentClient({
          result: {
            engine: "stub",
            text: "parsed text",
            markdown: null,
            pageCount: 1,
            pages: [{ index: 0, text: "parsed text" }],
          },
        })}
      />,
    );
    await user.upload(
      screen.getByTestId("coding-input-file"),
      new File(["%PDF-1.7"], "doc.pdf", { type: "application/pdf" }),
    );
    await user.click(screen.getByTestId("coding-input-submit"));
    await waitFor(() => expect(screen.getByText(/parsed text/)).toBeInTheDocument());
    await user.type(screen.getByTestId("coding-input-textarea"), "what is the total");
    await user.click(screen.getByTestId("coding-input-submit"));
    await waitFor(() =>
      expect(fake.calls.some((c) => c.method === "coding.session.sendMessage")).toBe(true),
    );
  });

  it("shows SidecarDownBanner when the sidecar is down and keeps the composer", async () => {
    render(
      <CodingPage
        sidecarStatus={{
          pollMs: 0,
          debounceMs: 1,
          fetchFn: async () => ({
            running: false,
            nodePath: "C:/Nexus/runtime/node/node.exe",
            nodeSource: "runtime-config",
            scriptPath: "C:/Nexus/sidecar/dist/main.js",
            failure: "sidecar-exited:-1073741510",
            stderrTail: [],
            candidatesRejected: [],
          }),
        }}
      />,
    );
    expect(await screen.findByTestId("coding-sidecar-down")).toBeInTheDocument();
    expect(screen.getByTestId("coding-input")).toBeInTheDocument();
  });
});
