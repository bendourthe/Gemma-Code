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
  const transcripts = new Map<string, { prompt: string; assistantText: string }[]>();
  const fakeSessions = [
    {
      sessionId: "prev-1",
      modelId: "qwen2.5-coder:7b",
      family: "qwen",
      title: "Prior session",
      createdAt: "2026-05-17T10:00:00Z",
      messageCount: 4,
    },
    {
      sessionId: "missing-1",
      modelId: "qwen2.5-coder:7b",
      family: "qwen",
      title: "Missing session",
      createdAt: "2026-05-17T10:00:00Z",
      messageCount: 1,
    },
  ];
  transcripts.set("prev-1", [{ prompt: "Hello agent", assistantText: "ok" }]);
  const invoke = vi.fn(async (_cmd: string, args?: Record<string, unknown>): Promise<unknown> => {
    const a = args as unknown as InvokeArgs;
    calls.push(a);
    switch (a.method) {
      case "coding.session.start": {
        const sessionId = "sess-1";
        transcripts.set(sessionId, []);
        if (!fakeSessions.some((session) => session.sessionId === sessionId)) {
          fakeSessions.push({
            sessionId,
            modelId: (a.params.modelId as string) ?? "gemma4:e4b",
            family: "gemma",
            title: "Live session",
            createdAt: "2026-05-17T11:00:00Z",
            messageCount: 0,
          });
        }
        return {
          sessionId,
          modelId: (a.params.modelId as string) ?? "gemma4:e4b",
          family: "gemma",
          createdAt: "2026-05-17T11:00:00Z",
        };
      }
      case "coding.session.sendMessage": {
        const sessionId = String(a.params.sessionId);
        const prompt = String(a.params.message);
        const turns = transcripts.get(sessionId) ?? [];
        turns.push({ prompt, assistantText: "ok" });
        transcripts.set(sessionId, turns);
        const listed = fakeSessions.find((session) => session.sessionId === sessionId);
        if (listed) listed.messageCount = turns.length;
        return {
          sessionId,
          events: [
            { kind: "token", text: "ok" },
            { kind: "done", finishReason: "stop" },
          ],
        };
      }
      case "coding.session.resume": {
        const sessionId = String(a.params.sessionId);
        if (sessionId === "missing-1") {
          throw new Error(`unknown sessionId: ${sessionId}`);
        }
        const session = fakeSessions.find((item) => item.sessionId === sessionId);
        const turns = transcripts.get(sessionId);
        if (!session || !turns) {
          throw new Error(`unknown sessionId: ${sessionId}`);
        }
        return {
          session,
          messages: turns.map((turn) => turn.prompt),
          turns,
        };
      }
      case "coding.session.rename": {
        const session = fakeSessions.find((item) => item.sessionId === a.params.sessionId);
        if (!session) throw new Error(`unknown sessionId: ${String(a.params.sessionId)}`);
        session.title = String(a.params.title);
        return { session };
      }
      case "coding.session.delete": {
        const sessionId = String(a.params.sessionId);
        const index = fakeSessions.findIndex((item) => item.sessionId === sessionId);
        if (index < 0) throw new Error(`unknown sessionId: ${sessionId}`);
        fakeSessions.splice(index, 1);
        transcripts.delete(sessionId);
        return { sessionId, deleted: true };
      }
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
        return { sessions: fakeSessions.map((session) => ({ ...session })) };
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
    expect(screen.getByTestId("composer-context-row").querySelector('[data-testid="coding-model-select"]')).toBeTruthy();
    expect(screen.queryByTestId("context-usage-bar")).toBeNull();
    expect(screen.getByTestId("coding-chat")).toHaveTextContent(/Start by asking/);
  });

  it("submitting a message starts a session and renders the rendered turn", async () => {
    render(<CodingPage />);
    await userEvent.type(screen.getByTestId("coding-input-textarea"), "Hello agent");
    await userEvent.click(screen.getByTestId("coding-input-submit"));
    await waitFor(() => {
      expect(screen.getByTestId("coding-chat")).toHaveTextContent("Hello agent");
    });
    expect(screen.getAllByTestId(/^message-time-/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByTestId(/^message-tokens-/).length).toBeGreaterThanOrEqual(1);
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

  it("rewrites sidecar response timeout on send into typed local-model copy", async () => {
    const fake = makeFakeInvoke();
    setInvokeOverride(async (_cmd, args) => {
      const a = args as unknown as InvokeArgs;
      if (a.method === "coding.session.sendMessage") {
        throw new Error("sidecar response timeout");
      }
      return fake.invoke("ipc_call", args ?? {});
    });
    render(<CodingPage />);
    await userEvent.type(screen.getByTestId("coding-input-textarea"), "Hello agent");
    await userEvent.click(screen.getByTestId("coding-input-submit"));
    const alert = await screen.findByTestId("coding-error");
    expect(alert.textContent ?? "").toMatch(/Check Ollama is running/);
    expect(alert.textContent ?? "").not.toMatch(/sidecar response timeout/i);
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
      expect(screen.getByTestId("tree-row-chat-prev-1")).toBeInTheDocument();
    });
    expect(screen.getByTestId("coding-history-pane")).toBeInTheDocument();
    expect(screen.getByTestId("sessions-panel")).toBeInTheDocument();
  });

  it("model select changes the modelId before a session starts", async () => {
    const modelsClient = {
      async list() {
        return [
          {
            id: "gemma4:e4b",
            displayName: "Gemma 4 E4B",
            type: "llm" as const,
            installed: true,
            source: "registry" as const,
            contextWindow: 128000,
          },
          {
            id: "qwen2.5-coder:7b",
            displayName: "Qwen 2.5 Coder 7B",
            type: "llm" as const,
            installed: true,
            source: "registry" as const,
            contextWindow: 32768,
          },
        ];
      },
    };
    render(<CodingPage modelsClient={modelsClient} />);
    const select = screen.getByTestId("coding-model-select") as HTMLSelectElement;
    await waitFor(() => {
      expect([...select.options].map((o) => o.value)).toContain("qwen2.5-coder:7b");
    });
    expect(screen.getByTestId("context-usage-bar")).toBeInTheDocument();
    expect(screen.getByTestId("composer-context-row").querySelector('[data-testid="coding-model-select"]')).toBeTruthy();
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

  it("does not show a pink Agentic AI Coding heading or harness badges", async () => {
    render(<CodingPage />);
    expect(screen.queryByText("Agentic AI Coding")).toBeNull();
    expect(screen.queryByTestId("coding-model-select-harness")).toBeNull();
    expect(screen.queryByTestId("coding-model-select-tool-calling")).toBeNull();
  });

  it("still shows the user prompt when the selected model is not installed", async () => {
    fake = makeFakeInvoke();
    setInvokeOverride(async (_cmd, args) => {
      const a = args as { method?: string; params?: Record<string, unknown> };
      if (a.method === "models.list") {
        return { models: [] };
      }
      return fake.invoke("ipc_call", args ?? {});
    });
    render(<CodingPage />);
    await userEvent.type(screen.getByTestId("coding-input-textarea"), "Hi");
    await userEvent.click(screen.getByTestId("coding-input-submit"));
    await waitFor(() => {
      expect(screen.getByTestId("coding-chat")).toHaveTextContent("Hi");
    });
    expect(screen.getByTestId("coding-chat")).toHaveTextContent(/is not installed/i);
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
    expect(screen.getByTestId("coding-history-empty")).toBeInTheDocument();
    expect(screen.queryByText("Prior session")).toBeNull();
  });

  it("resuming a previous session restores user and assistant text without starting a new session", async () => {
    const { unmount } = render(<CodingPage />);
    await userEvent.type(screen.getByTestId("coding-input-textarea"), "Hello agent");
    await userEvent.click(screen.getByTestId("coding-input-submit"));
    await waitFor(() => {
      expect(screen.getByTestId("coding-chat")).toHaveTextContent("Hello agent");
      expect(screen.getByTestId("coding-chat")).toHaveTextContent("ok");
    });
    unmount();
    render(<CodingPage initialTab="sessions" />);
    await userEvent.click(await screen.findByTestId("tree-row-chat-sess-1"));
    await waitFor(() => {
      expect(screen.getByTestId("coding-chat")).toHaveTextContent("Hello agent");
      expect(screen.getByTestId("coding-chat")).toHaveTextContent("ok");
    });
    expect(fake.calls.filter((call) => call.method === "coding.session.start")).toHaveLength(1);
    expect(fake.calls.some((call) => call.method === "coding.session.resume")).toBe(true);
  });

  it("unknown resume id shows a typed error and an empty transcript", async () => {
    render(<CodingPage initialTab="sessions" />);
    await userEvent.click(await screen.findByTestId("tree-row-chat-missing-1"));
    expect(await screen.findByTestId("coding-error")).toHaveTextContent(
      "Could not resume session",
    );
    expect(screen.getByTestId("coding-chat")).toHaveTextContent(/Start by asking a question/);
    expect(fake.calls.some((call) => call.method === "coding.session.start")).toBe(false);
  });

  it("opening the Sessions tab does not start a session or send a turn", async () => {
    render(<CodingPage initialTab="sessions" />);
    expect(await screen.findByTestId("tree-row-chat-prev-1")).toBeInTheDocument();
    expect(fake.calls.some((call) => call.method === "coding.session.start")).toBe(false);
    expect(fake.calls.some((call) => call.method === "coding.session.sendMessage")).toBe(false);
  });

  it("renames and deletes a listed Agents session", async () => {
    render(<CodingPage initialTab="sessions" />);
    await userEvent.click(await screen.findByTestId("tree-rename-prev-1"));
    const input = await screen.findByTestId("tree-rename-input-prev-1");
    await userEvent.clear(input);
    await userEvent.type(input, "Renamed agents{Enter}");
    await waitFor(() => {
      expect(fake.calls.some((call) => call.method === "coding.session.rename")).toBe(true);
    });
    await waitFor(() => {
      expect(screen.getByTestId("tree-row-chat-prev-1")).toHaveTextContent("Renamed agents");
    });
    await userEvent.click(screen.getByTestId("tree-delete-prev-1"));
    await userEvent.click(screen.getByTestId("confirm-delete-ok"));
    await waitFor(() => {
      expect(screen.queryByTestId("tree-row-chat-prev-1")).toBeNull();
    });
  });
});
