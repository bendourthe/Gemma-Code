// Nexus sidecar entry point. Reads JSON-RPC 2.0 messages from stdin, one per
// line, dispatches to the handler registry, writes responses to stdout. The
// Rust core (desktop/src-tauri/src/sidecar.rs) owns the lifecycle.

import { createInterface } from "node:readline";
import { createHandlerContext, dispatch } from "./handlers.js";
import { warmUpTreeSitter } from "./treeSitterWarmup.js";

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

const ctx = createHandlerContext({ pid: process.pid, platform: process.platform });

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
