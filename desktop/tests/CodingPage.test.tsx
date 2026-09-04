import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CodingPage } from "../src/modules/coding/CodingPage";
import { clearInvokeOverride, setInvokeOverride } from "../src/lib/ipc";
import { createInMemoryDocumentClient } from "../src/modules/chat/documentClient";
import { PERSISTENCE_KEYS } from "../src/lib/persistence";
import { setWorkspaceDialogOverride } from "../src/lib/workspacePicker";

interface InvokeArgs {
  method: string;
  params: Record<string, unknown>;
}

function makeFakeInvoke() {
  const calls: InvokeArgs[] = [];
  const transcripts = new Map<
    string,
    { prompt: string; assistantText: string }[]
  >();
  const fakeSessions = [
    {
      sessionId: "prev-1",
      modelId: "qwen2.5-coder:7b",
      family: "qwen",
      title: "Prior session",
      createdAt: "2026-05-17T10:00:00Z",
      messageCount: 4,
      workspaceId: "ws-0123456789abcdef01234567",
      workspaceRoots: ["C:\\work\\project"],
      primaryRoot: "C:\\work\\project",
    },
    {
      sessionId: "missing-1",
      modelId: "qwen2.5-coder:7b",
      family: "qwen",
      title: "Missing session",
      createdAt: "2026-05-17T10:00:00Z",
      messageCount: 1,
      workspaceId: "ws-0123456789abcdef01234567",
      workspaceRoots: ["C:\\work\\project"],
      primaryRoot: "C:\\work\\project",
    },
  ];
  transcripts.set("prev-1", [{ prompt: "Hello agent", assistantText: "ok" }]);
  const invoke = vi.fn(
    async (_cmd: string, args?: Record<string, unknown>): Promise<unknown> => {
      const a = args as unknown as InvokeArgs;
      calls.push(a);
      switch (a.method) {
        case "coding.session.start": {
          const sessionId = "sess-1";
          transcripts.set(sessionId, []);
          if (
            !fakeSessions.some((session) => session.sessionId === sessionId)
          ) {
            fakeSessions.push({
              sessionId,
              modelId: (a.params.modelId as string) ?? "gemma4:e4b",
              family: "gemma",
              title: "Live session",
              createdAt: "2026-05-17T11:00:00Z",
              messageCount: 0,
              workspaceId: "ws-0123456789abcdef01234567",
              workspaceRoots: [
                ...((a.params.workspaceRoots as string[]) ?? [
                  String(a.params.workspacePath),
                ]),
              ],
              primaryRoot: String(
                a.params.primaryRoot ?? a.params.workspacePath,
              ),
            });
          }
          return {
            sessionId,
            modelId: (a.params.modelId as string) ?? "gemma4:e4b",
            family: "gemma",
            createdAt: "2026-05-17T11:00:00Z",
            workspaceId: "ws-0123456789abcdef01234567",
            workspaceRoots: [
              ...((a.params.workspaceRoots as string[]) ?? [
                String(a.params.workspacePath),
              ]),
            ],
            primaryRoot: String(a.params.primaryRoot ?? a.params.workspacePath),
          };
        }
        case "coding.session.sendMessage": {
          const sessionId = String(a.params.sessionId);
          const prompt = String(a.params.message);
          const turns = transcripts.get(sessionId) ?? [];
          turns.push({ prompt, assistantText: "ok" });
          transcripts.set(sessionId, turns);
          const listed = fakeSessions.find(
            (session) => session.sessionId === sessionId,
          );
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
          const session = fakeSessions.find(
            (item) => item.sessionId === sessionId,
          );
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
          const session = fakeSessions.find(
            (item) => item.sessionId === a.params.sessionId,
          );
          if (!session)
            throw new Error(`unknown sessionId: ${String(a.params.sessionId)}`);
          session.title = String(a.params.title);
          return { session };
        }
        case "coding.session.delete": {
          const sessionId = String(a.params.sessionId);
          const index = fakeSessions.findIndex(
            (item) => item.sessionId === sessionId,
          );
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
              {
                id: "t-1",
                timestamp: "2026-05-17T11:00:00Z",
                kind: "tool",
                summary: "trace-summary",
              },
            ],
          };
        case "coding.sessions.list":
          return { sessions: fakeSessions.map((session) => ({ ...session })) };
        case "models.list":
          return {
            selection: {
              schemaVersion: 1,
              orderedIds: ["gemma4:e4b", "qwen2.5-coder:7b"],
              recommendedByTask: { agentic: "gemma4:e4b" },
              downloadedSinceInstall: [],
            },
            models: [
              {
                id: "gemma4:e4b",
                displayName: "Gemma 4 E4B",
                type: "llm",
                task: "chat",
                agentic: true,
                installed: true,
                source: "registry",
              },
              {
                id: "qwen2.5-coder:7b",
                displayName: "Qwen 2.5 Coder 7B",
                type: "llm",
                task: "chat",
                agentic: true,
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
    },
  );
  return { invoke, calls };
}

describe("CodingPage", () => {
  let fake: ReturnType<typeof makeFakeInvoke>;

  beforeEach(() => {
    window.localStorage.setItem(
      PERSISTENCE_KEYS.codingWorkspacePath,
      "C:\\work\\project",
    );
    fake = makeFakeInvoke();
    setInvokeOverride(async (cmd, args) => {
      if (cmd === "canonicalize_workspace_roots") return args?.paths ?? [];
      if (cmd === "default_workspace_root") return "C:\\Users\\tester";
      return fake.invoke("ipc_call", args ?? {});
    });
  });

  afterEach(() => {
    clearInvokeOverride();
    setWorkspaceDialogOverride(null);
    window.localStorage.clear();
  });

  it("renders the model selector and the chat empty state after live model hydration", async () => {
    render(<CodingPage />);
    expect(
      await screen.findByTestId("coding-model-select"),
    ).toBeInTheDocument();
    expect(
      screen
        .getByTestId("composer-context-row")
        .querySelector('[data-testid="coding-model-select"]'),
    ).toBeTruthy();
    expect(screen.queryByTestId("context-usage-bar")).toBeNull();
    expect(screen.getByTestId("coding-chat")).toHaveTextContent(
      /Start by asking/,
    );
  });

  it("submitting a message starts a session and renders the rendered turn", async () => {
    render(<CodingPage />);
    await userEvent.type(
      screen.getByTestId("coding-input-textarea"),
      "Hello agent",
    );
    await userEvent.click(screen.getByTestId("coding-input-submit"));
    await waitFor(() => {
      expect(screen.getByTestId("coding-chat")).toHaveTextContent(
        "Hello agent",
      );
    });
    expect(
      screen.getAllByTestId(/^message-time-/).length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByTestId(/^message-tokens-/).length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      fake.calls.find((call) => call.method === "coding.session.start")?.params,
    ).toMatchObject({
      workspacePath: "C:\\work\\project",
      workspaceRoots: ["C:\\work\\project"],
      primaryRoot: "C:\\work\\project",
    });
  });

  it("defaults a first launch to the operating-system home directory", async () => {
    window.localStorage.removeItem(PERSISTENCE_KEYS.codingWorkspacePath);
    window.localStorage.removeItem(PERSISTENCE_KEYS.codingWorkspace);
    render(<CodingPage />);
    expect(
      await screen.findByTestId("coding-workspace-primary"),
    ).toHaveAttribute("title", "C:\\Users\\tester");
    await userEvent.type(
      screen.getByTestId("coding-input-textarea"),
      "Hello agent",
    );
    await userEvent.click(screen.getByTestId("coding-input-submit"));
    await waitFor(() =>
      expect(
        fake.calls.some((call) => call.method === "coding.session.start"),
      ).toBe(true),
    );
    expect(
      fake.calls.find((call) => call.method === "coding.session.start")?.params,
    ).toMatchObject({
      workspaceRoots: ["C:\\Users\\tester"],
      primaryRoot: "C:\\Users\\tester",
    });
  });

  it("replaces, adds, deduplicates, and persists folders selected through the native picker", async () => {
    const picks = [
      ["D:\\projects\\client"],
      ["D:\\projects\\client", "E:\\shared"],
    ];
    setWorkspaceDialogOverride(async () => picks.shift() ?? null);
    render(<CodingPage />);
    expect(screen.getByTestId("coding-workspace-primary")).toHaveAttribute(
      "title",
      "C:\\work\\project",
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Change primary folder/i }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("coding-workspace-primary")).toHaveAttribute(
        "title",
        "D:\\projects\\client",
      ),
    );
    await userEvent.click(screen.getByTestId("coding-workspace-add"));
    await waitFor(() =>
      expect(screen.getByTestId("coding-workspace-extra")).toHaveAttribute(
        "title",
        "E:\\shared",
      ),
    );
    expect(
      window.localStorage.getItem(PERSISTENCE_KEYS.codingWorkspacePath),
    ).toBe("D:\\projects\\client");
    expect(
      JSON.parse(
        window.localStorage.getItem(PERSISTENCE_KEYS.codingWorkspace) ?? "{}",
      ),
    ).toEqual({
      roots: ["D:\\projects\\client", "E:\\shared"],
      primaryRoot: "D:\\projects\\client",
    });
  });

  it("restores persisted roots after restart and removes an extra folder", async () => {
    window.localStorage.setItem(
      PERSISTENCE_KEYS.codingWorkspace,
      JSON.stringify({
        roots: ["C:\\work\\project", "E:\\shared"],
        primaryRoot: "C:\\work\\project",
      }),
    );
    const first = render(<CodingPage />);
    expect(await screen.findByTestId("coding-workspace-extra")).toHaveAttribute(
      "title",
      "E:\\shared",
    );
    first.unmount();
    render(<CodingPage />);
    expect(screen.getByTestId("coding-workspace-primary")).toHaveAttribute(
      "title",
      "C:\\work\\project",
    );
    expect(screen.getByTestId("coding-workspace-extra")).toHaveAttribute(
      "title",
      "E:\\shared",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Remove folder shared" }),
    );
    await waitFor(() =>
      expect(screen.queryByTestId("coding-workspace-extra")).toBeNull(),
    );
  });

  it("switches an idle session to a new workspace by resetting its transcript", async () => {
    setWorkspaceDialogOverride(async () => ["E:\\shared"]);
    render(<CodingPage />);
    await userEvent.type(
      screen.getByTestId("coding-input-textarea"),
      "Hello agent",
    );
    await userEvent.click(screen.getByTestId("coding-input-submit"));
    await waitFor(() =>
      expect(screen.getByTestId("coding-chat")).toHaveTextContent("ok"),
    );
    await userEvent.click(screen.getByTestId("coding-workspace-add"));
    await waitFor(() =>
      expect(screen.getByTestId("coding-workspace-extra")).toHaveAttribute(
        "title",
        "E:\\shared",
      ),
    );
    expect(screen.getByTestId("coding-chat")).toHaveTextContent(
      /Start by asking/,
    );
    expect(
      fake.calls.some((call) => call.method === "coding.session.cancel"),
    ).toBe(true);
  });

  it("keeps a busy session fixed to its roots unless stop and switch is confirmed", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    setInvokeOverride(async (cmd, args) => {
      if (cmd === "canonicalize_workspace_roots") return args?.paths ?? [];
      const input = args as unknown as InvokeArgs;
      if (input.method === "coding.session.sendMessage") await gate;
      return fake.invoke("ipc_call", args ?? {});
    });
    setWorkspaceDialogOverride(async () => ["E:\\busy"]);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<CodingPage />);
    await userEvent.type(
      screen.getByTestId("coding-input-textarea"),
      "Keep working",
    );
    await userEvent.click(screen.getByTestId("coding-input-submit"));
    await screen.findByRole("img", { name: "Generating reply" });
    await userEvent.click(screen.getByTestId("coding-workspace-add"));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(screen.queryByTestId("coding-workspace-extra")).toBeNull();
    confirm.mockReturnValue(true);
    await userEvent.click(screen.getByTestId("coding-workspace-add"));
    await waitFor(() =>
      expect(screen.getByTestId("coding-workspace-extra")).toHaveAttribute(
        "title",
        "E:\\busy",
      ),
    );
    release();
    confirm.mockRestore();
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
    await userEvent.type(
      screen.getByTestId("coding-input-textarea"),
      "Hello agent",
    );
    await userEvent.click(screen.getByTestId("coding-input-submit"));
    expect(
      await screen.findByTestId("coding-model-switch-dialog"),
    ).toBeInTheDocument();
    expect(
      fake.calls.some((call) => call.method === "coding.session.start"),
    ).toBe(false);
    expect(
      fake.calls.some((call) => call.method === "coding.session.sendMessage"),
    ).toBe(false);
    await userEvent.click(
      screen.getByTestId("coding-model-switch-dialog-switch"),
    );
    await waitFor(() =>
      expect(
        fake.calls.some((call) => call.method === "coding.session.sendMessage"),
      ).toBe(true),
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
    await userEvent.type(
      screen.getByTestId("coding-input-textarea"),
      "Hello agent",
    );
    await userEvent.click(screen.getByTestId("coding-input-submit"));
    // v2.2.9 T006: shared bubble pending path is the rotating pill with one
    // stable accessible name.
    const orb = await screen.findByRole("img", { name: "Generating reply" });
    expect(orb).toHaveAttribute("data-agent-activity", "coding-tool-use");
    expect(orb).toHaveAttribute("data-orb-size", "bubble");
    expect(orb).toHaveAttribute("data-orb-pill", "true");
    expect(screen.queryByText("Generating...")).toBeNull();
    expect(screen.getByTestId("coding-composer-beam")).toHaveAttribute(
      "data-beam-mode",
      "traveling",
    );
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
    await userEvent.type(
      screen.getByTestId("coding-input-textarea"),
      "Hello agent",
    );
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

  it("migrates the Trace deep link to the Activity panel", async () => {
    render(<CodingPage initialTab="trace" />);
    await waitFor(() => {
      expect(screen.getByTestId("trace-panel")).toHaveTextContent(
        "trace-summary",
      );
    });
  });

  it("migrates the removed Sessions deep link to Chat while keeping history available", async () => {
    render(<CodingPage initialTab="sessions" />);
    await waitFor(() => {
      expect(screen.getByTestId("tree-row-chat-prev-1")).toBeInTheDocument();
    });
    expect(screen.getByTestId("coding-history-pane")).toBeInTheDocument();
    expect(screen.getByTestId("coding-chat")).toBeInTheDocument();
    expect(screen.queryByTestId("coding-tab-sessions")).toBeNull();
  });

  it("retries a failed workspace history load in place", async () => {
    let failList = true;
    setInvokeOverride(async (cmd, args) => {
      if (cmd === "canonicalize_workspace_roots") return args?.paths ?? [];
      const input = args as unknown as InvokeArgs;
      if (input.method === "coding.sessions.list" && failList) {
        throw new Error("history unavailable");
      }
      return fake.invoke("ipc_call", args ?? {});
    });
    render(<CodingPage />);
    expect(await screen.findByTestId("folder-tree-error")).toHaveTextContent(
      "history unavailable",
    );
    failList = false;
    await userEvent.click(screen.getByTestId("folder-tree-retry"));
    expect(
      await screen.findByTestId("tree-row-chat-prev-1"),
    ).toBeInTheDocument();
  });

  it("model select changes the modelId before a session starts", async () => {
    const modelsClient = {
      lastSelection: {
        schemaVersion: 1 as const,
        orderedIds: ["gemma4:e4b", "qwen2.5-coder:7b"],
        recommendedByTask: { agentic: "qwen2.5-coder:7b" },
        downloadedSinceInstall: [],
      },
      async list() {
        return [
          {
            id: "gemma4:e4b",
            displayName: "Gemma 4 E4B",
            type: "llm" as const,
            installed: true,
            source: "registry" as const,
            contextWindow: 128000,
            task: "chat",
            agentic: true,
          },
          {
            id: "qwen2.5-coder:7b",
            displayName: "Qwen 2.5 Coder 7B",
            type: "llm" as const,
            installed: true,
            source: "registry" as const,
            contextWindow: 32768,
            task: "chat",
            agentic: true,
          },
        ];
      },
    };
    render(<CodingPage modelsClient={modelsClient} />);
    await waitFor(() => {
      const select = screen.getByTestId(
        "coding-model-select",
      ) as HTMLSelectElement;
      expect([...select.options].map((o) => o.value)).toContain(
        "qwen2.5-coder:7b",
      );
    });
    const select = screen.getByTestId(
      "coding-model-select",
    ) as HTMLSelectElement;
    expect(select.value).toBe("qwen2.5-coder:7b");
    expect(screen.getByTestId("context-usage-bar")).toBeInTheDocument();
    expect(
      screen
        .getByTestId("composer-context-row")
        .querySelector('[data-testid="coding-model-select"]'),
    ).toBeTruthy();
    await userEvent.selectOptions(select, "qwen2.5-coder:7b");
    expect(select.value).toBe("qwen2.5-coder:7b");
  });

  it("shows a loading placeholder until the installed model catalog resolves", async () => {
    let resolveModels!: (
      models: readonly {
        id: string;
        displayName: string;
        type: "llm";
        installed: boolean;
        source: "registry";
        task: "chat";
        agentic: boolean;
      }[],
    ) => void;
    const modelsClient = {
      lastSelection: {
        schemaVersion: 1 as const,
        orderedIds: ["gemma4:e4b"],
        recommendedByTask: { agentic: "gemma4:e4b" },
        downloadedSinceInstall: [] as string[],
      },
      list: () =>
        new Promise<
          readonly {
            id: string;
            displayName: string;
            type: "llm";
            installed: boolean;
            source: "registry";
            task: "chat";
            agentic: boolean;
          }[]
        >((resolve) => {
          resolveModels = resolve;
        }),
    };
    render(<CodingPage modelsClient={modelsClient} />);
    expect(screen.getByTestId("coding-model-loading")).toHaveTextContent(
      "Loading models",
    );
    expect(screen.queryByTestId("coding-model-select")).toBeNull();
    await act(async () => {
      resolveModels([
        {
          id: "gemma4:e4b",
          displayName: "Gemma 4 E4B",
          type: "llm",
          installed: true,
          source: "registry",
          task: "chat",
          agentic: true,
        },
      ]);
    });
    expect(await screen.findByTestId("coding-model-select")).toHaveValue(
      "gemma4:e4b",
    );
  });

  it("falls back to the first ready installer-ranked model when the recommendation is unavailable", async () => {
    const modelsClient = {
      lastSelection: {
        schemaVersion: 1 as const,
        orderedIds: ["qwen2.5-coder:7b", "gemma4:e4b"],
        recommendedByTask: { agentic: "missing:model" },
        downloadedSinceInstall: [],
      },
      async list() {
        return [
          {
            id: "gemma4:e4b",
            displayName: "Gemma 4 E4B",
            type: "llm" as const,
            installed: true,
            source: "registry" as const,
            task: "chat",
            agentic: true,
          },
          {
            id: "qwen2.5-coder:7b",
            displayName: "Qwen 2.5 Coder 7B",
            type: "llm" as const,
            installed: true,
            source: "registry" as const,
            task: "chat",
            agentic: true,
          },
        ];
      },
    };
    render(<CodingPage modelsClient={modelsClient} />);
    expect(await screen.findByTestId("coding-model-select")).toHaveValue(
      "qwen2.5-coder:7b",
    );
  });

  it("ignores leftover favorite on an empty session and protects a manual choice from a later catalog refresh", async () => {
    window.localStorage.setItem("nexus.ui.favoriteModel.agentic", "gemma4:e4b");
    const models = [
      {
        id: "qwen2.5-coder:7b",
        displayName: "Qwen 2.5 Coder 7B",
        type: "llm" as const,
        installed: true,
        source: "registry" as const,
        task: "chat",
        agentic: true,
      },
      {
        id: "gemma4:e4b",
        displayName: "Gemma 4 E4B",
        type: "llm" as const,
        installed: true,
        source: "registry" as const,
        task: "chat",
        agentic: true,
      },
    ];
    const selection = {
      schemaVersion: 1 as const,
      orderedIds: ["qwen2.5-coder:7b", "gemma4:e4b"],
      recommendedByTask: { agentic: "qwen2.5-coder:7b" },
      downloadedSinceInstall: [],
    };
    const firstClient = {
      lastSelection: selection,
      async list() {
        return models;
      },
    };
    const { rerender } = render(<CodingPage modelsClient={firstClient} />);
    const select = (await screen.findByTestId(
      "coding-model-select",
    )) as HTMLSelectElement;
    expect(select).toHaveValue("qwen2.5-coder:7b");
    await userEvent.selectOptions(select, "gemma4:e4b");
    const refreshedClient = {
      lastSelection: {
        ...selection,
        recommendedByTask: { agentic: "qwen2.5-coder:7b" },
      },
      async list() {
        return models;
      },
    };
    rerender(<CodingPage modelsClient={refreshedClient} />);
    expect(await screen.findByTestId("coding-model-select")).toHaveValue(
      "gemma4:e4b",
    );
    expect(window.localStorage.getItem("nexus.ui.favoriteModel.agentic")).toBe(
      "gemma4:e4b",
    );
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

  it("tab navigation switches between Chat, Memory, and Activity", async () => {
    render(<CodingPage />);
    await userEvent.click(screen.getByTestId("coding-tab-memory"));
    await waitFor(() =>
      expect(screen.getByTestId("memory-panel")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("coding-memory")).toHaveTextContent(
      "Knowledge saved or indexed for these workspace folders.",
    );
    await userEvent.click(screen.getByTestId("coding-tab-chat"));
    expect(screen.getByTestId("coding-chat")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("coding-tab-activity"));
    expect(await screen.findByTestId("coding-activity")).toHaveTextContent(
      "Tools, approvals, and runtime events for this workspace.",
    );
    expect(screen.queryByTestId("coding-tab-sessions")).toBeNull();
  });

  it("keeps workspace controls and tabs on one header row without an in-pane History band", async () => {
    render(<CodingPage />);
    const header = screen.getByTestId("coding-workspace-header");
    expect(header).toContainElement(
      screen.getByTestId("coding-workspace-controls"),
    );
    expect(header).toContainElement(screen.getByTestId("coding-tabs"));
    expect(screen.getByTestId("coding-history-pane")).toBeInTheDocument();
    expect(screen.queryByTestId("coding-history-collapse-toggle")).toBeNull();
    expect(screen.queryByTestId("coding-history-content")).toBeNull();
    expect(
      await screen.findByTestId("tree-row-chat-prev-1"),
    ).toBeInTheDocument();
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
    expect(screen.getByTestId("coding-chat")).toHaveTextContent(
      /is not installed/i,
    );
  });

  // v2.2.3 Phase 2: the MetalAccent ring was deliberately replaced by the
  // glass treatment -- no `-metal` wrapper remains around New session.
  it("shows a glass New session control after a session starts and clears the transcript", async () => {
    render(<CodingPage />);
    expect(screen.queryByTestId("coding-new-session")).toBeNull();
    await userEvent.type(
      screen.getByTestId("coding-input-textarea"),
      "Hello agent",
    );
    await userEvent.click(screen.getByTestId("coding-input-submit"));
    await waitFor(() => {
      expect(screen.getByTestId("coding-chat")).toHaveTextContent(
        "Hello agent",
      );
    });
    const neu = screen.getByTestId("coding-new-session");
    expect(neu.closest("[data-testid$='-metal']")).toBeNull();
    expect(
      screen.getByTestId("coding-cancel").closest("[data-testid$='-metal']"),
    ).toBeNull();
    await userEvent.click(neu);
    await waitFor(() => {
      expect(screen.queryByTestId("coding-new-session")).toBeNull();
      expect(screen.getByTestId("coding-chat")).toHaveTextContent(
        /Start by asking/,
      );
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
    await waitFor(() =>
      expect(screen.getByTestId("coding-input-doc-0")).toBeInTheDocument(),
    );
    await user.click(screen.getByTestId("coding-input-submit"));
    await waitFor(() =>
      expect(screen.getByText(/INVOICE 12345/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/Parsed with rapidocr/)).toBeInTheDocument();
    expect(
      fake.calls.filter((c) => c.method === "coding.session.sendMessage"),
    ).toHaveLength(0);
    expect(
      fake.calls.filter((c) => c.method === "coding.session.start"),
    ).toHaveLength(0);
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
    await waitFor(() =>
      expect(screen.getByText(/FROM WORD/)).toBeInTheDocument(),
    );
    expect(
      fake.calls.filter((c) => c.method === "coding.session.sendMessage"),
    ).toHaveLength(0);
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
    await user.type(
      screen.getByTestId("coding-input-textarea"),
      "summarize this",
    );
    await user.upload(
      screen.getByTestId("coding-input-file"),
      new File(["%PDF-1.7"], "doc.pdf", { type: "application/pdf" }),
    );
    await user.click(screen.getByTestId("coding-input-submit"));
    await waitFor(() =>
      expect(screen.getByText(/Ask a follow-up question/)).toBeInTheDocument(),
    );
    expect(
      fake.calls.filter((c) => c.method === "coding.session.sendMessage"),
    ).toHaveLength(0);
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
    await waitFor(() =>
      expect(screen.getByText(/parsed text/)).toBeInTheDocument(),
    );
    await user.type(
      screen.getByTestId("coding-input-textarea"),
      "what is the total",
    );
    await user.click(screen.getByTestId("coding-input-submit"));
    await waitFor(() =>
      expect(
        fake.calls.some((c) => c.method === "coding.session.sendMessage"),
      ).toBe(true),
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
    expect(
      await screen.findByTestId("coding-sidecar-down"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("coding-input")).toBeInTheDocument();
    expect(screen.getByTestId("coding-history-empty")).toBeInTheDocument();
    expect(screen.queryByText("Prior session")).toBeNull();
  });

  it("resuming a previous session restores user and assistant text without starting a new session", async () => {
    const { unmount } = render(<CodingPage />);
    await userEvent.type(
      screen.getByTestId("coding-input-textarea"),
      "Hello agent",
    );
    await userEvent.click(screen.getByTestId("coding-input-submit"));
    await waitFor(() => {
      expect(screen.getByTestId("coding-chat")).toHaveTextContent(
        "Hello agent",
      );
      expect(screen.getByTestId("coding-chat")).toHaveTextContent("ok");
    });
    unmount();
    render(<CodingPage initialTab="sessions" />);
    await userEvent.click(await screen.findByTestId("tree-row-chat-sess-1"));
    await waitFor(() => {
      expect(screen.getByTestId("coding-chat")).toHaveTextContent(
        "Hello agent",
      );
      expect(screen.getByTestId("coding-chat")).toHaveTextContent("ok");
    });
    expect(
      fake.calls.filter((call) => call.method === "coding.session.start"),
    ).toHaveLength(1);
    expect(
      fake.calls.some((call) => call.method === "coding.session.resume"),
    ).toBe(true);
  });

  it("unknown resume id shows a typed error and an empty transcript", async () => {
    render(<CodingPage initialTab="sessions" />);
    await userEvent.click(await screen.findByTestId("tree-row-chat-missing-1"));
    expect(await screen.findByTestId("coding-error")).toHaveTextContent(
      "Could not resume session",
    );
    expect(screen.getByTestId("coding-chat")).toHaveTextContent(
      /Start by asking a question/,
    );
    expect(
      fake.calls.some((call) => call.method === "coding.session.start"),
    ).toBe(false);
  });

  it("opening the Sessions tab does not start a session or send a turn", async () => {
    render(<CodingPage initialTab="sessions" />);
    expect(
      await screen.findByTestId("tree-row-chat-prev-1"),
    ).toBeInTheDocument();
    expect(
      fake.calls.some((call) => call.method === "coding.session.start"),
    ).toBe(false);
    expect(
      fake.calls.some((call) => call.method === "coding.session.sendMessage"),
    ).toBe(false);
  });

  it("renames and deletes a listed Agents session", async () => {
    render(<CodingPage initialTab="sessions" />);
    await userEvent.click(await screen.findByTestId("tree-rename-prev-1"));
    const input = await screen.findByTestId("tree-rename-input-prev-1");
    await userEvent.clear(input);
    await userEvent.type(input, "Renamed agents{Enter}");
    await waitFor(() => {
      expect(
        fake.calls.some((call) => call.method === "coding.session.rename"),
      ).toBe(true);
    });
    await waitFor(() => {
      expect(screen.getByTestId("tree-row-chat-prev-1")).toHaveTextContent(
        "Renamed agents",
      );
    });
    await userEvent.click(screen.getByTestId("tree-delete-prev-1"));
    await userEvent.click(screen.getByTestId("confirm-delete-ok"));
    await waitFor(() => {
      expect(screen.queryByTestId("tree-row-chat-prev-1")).toBeNull();
    });
  });
});
