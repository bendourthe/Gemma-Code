// Nexus sidecar entry point. Reads JSON-RPC 2.0 messages from stdin, one per
// line, dispatches to the handler registry, writes responses to stdout. The
// Rust core (desktop/src-tauri/src/sidecar.rs) owns the lifecycle.

import { createInterface } from "node:readline";
import { join } from "node:path";
import { CodingSessionManager } from "./coding/sessionManager.js";
import { JsonFileSessionStore } from "./coding/sessionStore.js";
import { createHeadlessAgentRunner } from "./coding/headlessAgentRunner.js";
import { createScheduledHeadlessRunner } from "./coding/scheduledHeadlessRunner.js";
import {
  SkillOptimizerManager,
  createHeadlessOptimizePreviewRunner,
} from "./coding/skillOptimizerManager.js";
import { createHeadlessOllamaClient } from "../../../modules/coding/llm/headlessOllamaClient.js";
import { AskInbox } from "../../../modules/coding/autonomy/AskInbox.js";
import { AgentRunScheduler } from "../../../modules/coding/autonomy/AgentRunScheduler.js";
import { ChatSessionManager } from "./chat/sessionManager.js";
import { createChatMessageHandler } from "./chat/chatMessageHandler.js";
import {
  createDiffusionRuntime,
  MediaRuntimeService,
} from "./diffusion/runtimeFactory.js";
import { createHandlerContext, dispatch } from "./handlers.js";
import {
  beginStudioRuntimeShutdown,
  closeStudioRuntime,
  createStudioRuntime,
} from "./generations/studioRuntime.js";
import { resolveStudioDbPath } from "../../../core/generations/paths.js";
import { createServingRuntime } from "./serving/servingRuntime.js";
import { createJsonCliRoute } from "./controlSurface/jsonCliRoutes.js";
import { createAuditRuntime } from "./audit/runtime.js";
import { InProcessTelemetryBus } from "../../../core/telemetry/TelemetryBus.js";
import { createHookBus } from "../../../core/lifecycle/HookBus.js";
import { SIDECAR_MODELS } from "./coding/models.js";
import { warmUpTreeSitter } from "./treeSitterWarmup.js";
import { applyRuntimeConfigEnv } from "./runtimeConfig.js";
import { existsSync } from "node:fs";
import { NexusHubSyncer } from "../../../core/skills/NexusHubSyncer.js";
import { migrateLegacyCatalogCleanup } from "../../../core/skills/migrateLegacyCatalog.js";
import {
  nexusHome,
  catalogRoot,
  hubLayoutDir,
} from "../../../core/storage/paths.js";
import { resolveHubLayout } from "../../../core/storage/hubVersionManifest.js";
import { WorkspaceScopeStore } from "../../../core/project/WorkspaceScopeStore.js";

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: number;
  method?: string;
  params?: unknown;
}

interface JsonRpcResponseOk {
  jsonrpc: "2.0";
  id: number;
  result: unknown;
}

interface JsonRpcResponseErr {
  jsonrpc: "2.0";
  id: number | null;
  error: { code: number; message: string };
}

// v2.2.0 Phase 1 (1.3): apply the installer-written runtime contract BEFORE
// any runtime construction below reads process.env. Explicit env always wins;
// a missing runtime.json (dev checkout) is a silent no-op.
const appliedRuntimeEnv = applyRuntimeConfigEnv(process.env);
if (appliedRuntimeEnv.length > 0) {
  process.stderr.write(
    `[nexus-sidecar] runtime.json applied: ${appliedRuntimeEnv.join(", ")}\n`,
  );
}

// v1.7.0: drive the Coding pillar with the real headless agent runtime (the
// agent's tools are scoped to the session's workspacePath, or NEXUS_WORKSPACE.
// Tests and bare `createHandlerContext()` callers keep the placeholder.
const telemetry = new InProcessTelemetryBus();
const hookBus = createHookBus(telemetry);
const sessions = new CodingSessionManager({
  agentRunner: createHeadlessAgentRunner({ hookBus }),
  store: new JsonFileSessionStore(),
});
const workspaceStore = new WorkspaceScopeStore();
// v1.7.0: route Image Studio + Video Lab to the real Python diffusion runtime
// (set NEXUS_DIFFUSION_INMEMORY=1 for a no-GPU dev/test host).
const mediaRuntime = new MediaRuntimeService();
const diffusion = createDiffusionRuntime(process.env, { mediaRuntimeService: mediaRuntime });
// v1.7.0: drive the Local Chatbot Explorer with a real local-model chat stream.
const chat = new ChatSessionManager({
  runner: createChatMessageHandler(),
  retrieveMemory: async ({ query, limit }) => {
    const { chatMemoryRuntime } = await import("./chat/memoryRuntime.js");
    const result = await chatMemoryRuntime().search({ query, limit });
    return result.hits.map((hit) => hit.content);
  },
});
// v1.12.0 EM.P2.A: the skill-optimizer preview/apply manager. The preview runner
// needs the golden task corpus + a local model, so it is wired only when the
// golden tasks dir is resolvable (NEXUS_GOLDEN_TASKS_DIR); otherwise the manager
// is left unconfigured and `skills.optimize.preview` reports "not configured"
// (never crashes). Skill files resolve under the Nexus-Hub catalog layout. This
// live path is verified with the running app + a local model, not in CI.
const goldenTasksDir = process.env.NEXUS_GOLDEN_TASKS_DIR;
const skillOptimizer = goldenTasksDir
  ? new SkillOptimizerManager({
      runner: createHeadlessOptimizePreviewRunner({
        llm: createHeadlessOllamaClient(),
        defaultModel: process.env.NEXUS_OPTIMIZER_MODEL ?? "gemma4:e4b",
        snapshotRoot:
          process.env.NEXUS_GOLDEN_SNAPSHOT_DIR ??
          join(goldenTasksDir, "..", "snapshots"),
        tasksDir: goldenTasksDir,
        artifactsDir: join(nexusHome(), "skilloptimizer", "artifacts"),
        resolveSkillPath: (id) =>
          join(catalogRoot(), "skills", id.split("/").pop() ?? id, "SKILL.md"),
      }),
    })
  : new SkillOptimizerManager();
// v1.16.0 Phase 1 (adoption item A1): the loopback serving gateway. Constructed
// eagerly so the same instance backs both the `serving.*` IPC and the startup
// reconcile below. OpenAI `/v1` stays off until `nexus.serving.enabled` is
// true; JSON CLI still binds the listener.
const askInbox = new AskInbox({
  filePath: join(nexusHome(), "ask-inbox.json"),
});
const serving = createServingRuntime({ askInbox });
const scheduler = new AgentRunScheduler({
  inbox: askInbox,
  workspacePath: process.env.NEXUS_WORKSPACE ?? process.cwd(),
  workspaceRoots: [process.env.NEXUS_WORKSPACE ?? process.cwd()],
  primaryRoot: process.env.NEXUS_WORKSPACE ?? process.cwd(),
  filePath: join(nexusHome(), "agent-schedules.json"),
  runHeadless: createScheduledHeadlessRunner({ hookBus }),
});
scheduler.start();
const ctx = createHandlerContext(
  { pid: process.pid, platform: process.platform },
  sessions,
  diffusion,
  undefined,
  undefined,
  chat,
  skillOptimizer,
  serving,
);
ctx.askInbox = askInbox;
ctx.mediaRuntime = mediaRuntime;
ctx.workspaceStore = workspaceStore;
ctx.scheduler = scheduler;
ctx.telemetry = telemetry;
const studio = createStudioRuntime({
  dbPath: resolveStudioDbPath(),
  telemetry,
});
ctx.studio = studio;
ctx.audit = createAuditRuntime({ credentials: ctx.credentials, telemetry }).log;
let rpcReader: ReturnType<typeof createInterface> | null = null;
let acceptingRequests = true;
let shutdownPromise: Promise<void> | null = null;
serving.gateway.surface.mount(
  createJsonCliRoute({
    sessions,
    studio,
    workspaceStore,
    listModels: async () =>
      SIDECAR_MODELS.map((m) => ({ id: m.id, displayName: m.displayName })),
  }),
);

function write(payload: JsonRpcResponseOk | JsonRpcResponseErr): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

async function handleLine(line: string): Promise<void> {
  let req: JsonRpcRequest;
  try {
    req = JSON.parse(line) as JsonRpcRequest;
  } catch {
    write({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "ParseError" },
    });
    return;
  }
  const id = typeof req.id === "number" ? req.id : null;
  const method = req.method;
  if (typeof method !== "string") {
    write({
      jsonrpc: "2.0",
      id,
      error: { code: -32600, message: "InvalidRequest" },
    });
    return;
  }
  try {
    const result = await dispatch(method, req.params, ctx);
    if (id !== null) {
      write({ jsonrpc: "2.0", id, result });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code =
      err instanceof Error &&
      "code" in err &&
      typeof (err as { code?: unknown }).code === "number"
        ? (err as { code: number }).code
        : -32603;
    write({ jsonrpc: "2.0", id, error: { code, message } });
  }
}

// v1.10.0 Phase 6 (T031): on sidecar startup, run the one-shot legacy-cache
// cleanup (removes ~/.nexus/skills/devai-hub) and, if the Nexus-Hub catalog is
// not yet populated at ~/.nexus-ai/catalog/, fetch it. Best-effort + non-fatal:
// an offline host stays in the "catalog not yet synced" state until the next
// successful sync. Fire-and-forget, so it never blocks JSON-RPC handling.
async function firstLaunchCatalog(): Promise<void> {
  try {
    migrateLegacyCatalogCleanup(nexusHome());
  } catch {
    // Cleanup is best-effort; never block startup.
  }
  const root = catalogRoot();
  const skillsDir = hubLayoutDir(root, "skills", resolveHubLayout(root));
  if (existsSync(skillsDir)) return; // already synced
  try {
    const result = await new NexusHubSyncer({}).sync({ apply: true });
    process.stderr.write(
      `[nexus-sidecar] Nexus-Hub catalog: fetched ${result.tag}${result.applied ? "" : " (not applied)"}\n`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `[nexus-sidecar] Nexus-Hub catalog: not yet synced (${msg})\n`,
    );
  }
}

/**
 * v1.16.0 Phase 1: close the serving-gateway listener before exiting. Bounded by
 * a short timer because the Rust supervisor (`desktop/src-tauri/src/sidecar.rs`)
 * may hard-kill us anyway -- a hung close must never wedge shutdown.
 */
function shutdown(): Promise<void> {
  if (shutdownPromise) return shutdownPromise;
  acceptingRequests = false;
  const reader = rpcReader;
  shutdownPromise = Promise.resolve().then(async () => {
    reader?.removeAllListeners("line");
    reader?.removeAllListeners("close");
    reader?.close();
    scheduler.stop();
    beginStudioRuntimeShutdown(studio);
    await ctx.videoEnhancement?.stopActive();
    await ctx.videoEnhancement?.cleanupMedia();
    await closeStudioRuntime(studio);
    try {
      await Promise.race([
        serving.gateway.stop(),
        new Promise<void>((resolve) => setTimeout(resolve, 2_000).unref()),
      ]);
    } catch {
      // Best-effort: exit regardless.
    }
    process.exit(0);
  });
  return shutdownPromise;
}

function main(): void {
  // v1.5.0 Phase 6 (T022.P3.A): warm up the Tree-sitter codegraph scanner from
  // the bundled wasm dir so codegraph scans use the parse path, not the regex
  // fallback. Fire-and-forget; logs to stderr (stdout is the JSON-RPC channel)
  // and never blocks message handling -- initTreeSitter is graceful.
  void warmUpTreeSitter().then((ready) => {
    process.stderr.write(
      `[nexus-sidecar] tree-sitter codegraph scanner: ${ready ? "ready" : "unavailable (regex fallback)"}\n`,
    );
  });

  // v1.10.0 Phase 6: best-effort Nexus-Hub catalog cleanup + first-launch fetch.
  void firstLaunchCatalog();

  // v1.16.0 Phase 1: reconcile the serving gateway with its persisted opt-in, so
  // a user who left it enabled gets the listener back on relaunch. Best-effort
  // and non-fatal -- a bad host or a taken port must not stop the sidecar.
  void serving.sync().then(
    (status) => {
      if (!status.running) return;
      process.stderr.write(
        `[nexus-sidecar] local serving gateway: ${status.enabled ? "routes on" : "JSON CLI on"} ${status.running ? "listening" : "not listening"}\n`,
      );
    },
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `[nexus-sidecar] local serving gateway not started: ${msg}\n`,
      );
    },
  );

  rpcReader = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rpcReader.on("line", (line) => {
    if (!acceptingRequests || !line.trim()) return;
    void handleLine(line);
  });
  rpcReader.on("close", () => {
    void shutdown();
  });
  // v2.2.1: the shell waits for this line (or 500ms of liveness) before the
  // first JSON-RPC write. Import-time crashes never reach here; try_wait
  // then reports sidecar-exited instead of Windows 232.
  process.stderr.write("[nexus-sidecar] ready\n");
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

main();
