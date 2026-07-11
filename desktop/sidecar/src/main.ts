// Nexus sidecar entry point. Reads JSON-RPC 2.0 messages from stdin, one per
// line, dispatches to the handler registry, writes responses to stdout. The
// Rust core (desktop/src-tauri/src/sidecar.rs) owns the lifecycle.

import { createInterface } from "node:readline";
import { CodingSessionManager } from "./coding/sessionManager.js";
import { createHeadlessAgentRunner } from "./coding/headlessAgentRunner.js";
import { ChatSessionManager } from "./chat/sessionManager.js";
import { createChatMessageHandler } from "./chat/chatMessageHandler.js";
import { createDiffusionRuntime } from "./diffusion/runtimeFactory.js";
import { createHandlerContext, dispatch } from "./handlers.js";
import { warmUpTreeSitter } from "./treeSitterWarmup.js";
import { existsSync } from "node:fs";
import { NexusHubSyncer } from "../../../core/skills/NexusHubSyncer.js";
import { migrateLegacyCatalogCleanup } from "../../../core/skills/migrateLegacyCatalog.js";
import { nexusHome, catalogRoot, hubLayoutDir } from "../../../core/storage/paths.js";
import { resolveHubLayout } from "../../../core/storage/hubVersionManifest.js";

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

// v1.7.0: drive the Coding pillar with the real headless agent runtime (the
// agent's tools are scoped to the session's workspacePath, or NEXUS_WORKSPACE /
// cwd). Tests and bare `createHandlerContext()` callers keep the placeholder.
const sessions = new CodingSessionManager({ agentRunner: createHeadlessAgentRunner() });
// v1.7.0: route Image Studio + Video Lab to the real Python diffusion runtime
// (set NEXUS_DIFFUSION_INMEMORY=1 for a no-GPU dev/test host).
const diffusion = createDiffusionRuntime(process.env);
// v1.7.0: drive the Local Chatbot Explorer with a real local-model chat stream.
const chat = new ChatSessionManager({ runner: createChatMessageHandler() });
const ctx = createHandlerContext(
  { pid: process.pid, platform: process.platform },
  sessions,
  diffusion,
  undefined,
  undefined,
  chat,
);

function write(payload: JsonRpcResponseOk | JsonRpcResponseErr): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

async function handleLine(line: string): Promise<void> {
  let req: JsonRpcRequest;
  try {
    req = JSON.parse(line) as JsonRpcRequest;
  } catch {
    write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "ParseError" } });
    return;
  }
  const id = typeof req.id === "number" ? req.id : null;
  const method = req.method;
  if (typeof method !== "string") {
    write({ jsonrpc: "2.0", id, error: { code: -32600, message: "InvalidRequest" } });
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
      err instanceof Error && "code" in err && typeof (err as { code?: unknown }).code === "number"
        ? ((err as { code: number }).code)
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
    process.stderr.write(`[nexus-sidecar] Nexus-Hub catalog: not yet synced (${msg})\n`);
  }
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

  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    void handleLine(line);
  });
  rl.on("close", () => {
    process.exit(0);
  });
  process.on("SIGTERM", () => process.exit(0));
  process.on("SIGINT", () => process.exit(0));
}

main();
