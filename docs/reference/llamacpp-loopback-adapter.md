# llama.cpp loopback adapter (large-MoE / patient-tier recipe)

*v1.18.0 Phase 1 (LG-A5). Promotes the user-registered llama.cpp adapter that [EM.P4.A](../v1/v1.12/known-gaps.md) already names into a first-class, loopback-only recipe. This page does **not** open the EM.P4 patient-tier gate, does not add a catalog entry, and does not bundle, download, or auto-install llama.cpp.*

Nexus talks to local runtimes through [`LocalAdapterRegistry`](../../modules/coding/llm/LocalAdapterRegistry.ts). Ollama and LM Studio ship as built-in manifests. Any other OpenAI-compatible or Ollama-native server on **this machine** is a user-registered `nexus.llm.localAdapters` entry. llama-server is that third runtime: you start it, you register it, Nexus never ships the binary.

The same loopback guard used by the MLX how-to ([`loopback.ts`](../../modules/coding/llm/loopback.ts)) rejects any non-loopback `endpoint` with an error that cites the AGENTS.md MCP Registry Policy. A LAN or cloud llama.cpp host is not a Nexus adapter.

**Support tier**: the adapter registry is `supported`. A live chat against llama-server is `internal-compatible` until you run it on your host (not proven here). See [evidence-and-support-tiers.md](../v1/v1.4/development/evidence-and-support-tiers.md). Source comparison: [Laguna-S-2.1 A5](../v1/v1.18/comparisons/v1.18.2-comparison-laguna-s-2-1.md).

## What this recipe is not

- **Not a bundled runtime.** There is no llama.cpp in the installer, no auto-download, no `llama-server` on PATH from Nexus.
- **Not an EM.P4 enablement.** [`patientTier.ts`](../../core/registry/patientTier.ts) stays off (`nexus.llm.patientTier.enabled` default false). Registering this adapter does not surface `patient-tier`-tagged catalog rows and does not add a Laguna / GLM-5.2 entry ([EM.P4.A](../v1/v1.12/known-gaps.md) remains open).
- **Not an outbound path.** `--host 0.0.0.0` (or any non-loopback bind) is a llama.cpp choice that Nexus will refuse at registration. Bind loopback only.

The MLX sibling of this page is [mlx-via-local-adapters.md](../v1/v1.16/guides/mlx-via-local-adapters.md). ADR: [0019-local-adapter-registry.md](../adr/0019-local-adapter-registry.md). Canonical example file: [examples/llamacpp-loopback-adapter.json](./examples/llamacpp-loopback-adapter.json).

## 1. Start llama-server on loopback (you own this process)

Install llama.cpp from its own project. Nexus does not pin a version. Consult the current [llama.cpp server README](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md) if a flag below has been renamed.

llama-server already defaults `--host` to `127.0.0.1` and `--port` to `8080`, and it speaks OpenAI-compatible `/v1/chat/completions`. Keep the bind on loopback.

Interactive / GPU-resident MoE (experts that do not fit in VRAM, attention on GPU):

```bash
llama-server \
  -m /path/to/your-moe.gguf \
  --host 127.0.0.1 \
  --port 8080 \
  -ngl 99 \
  --n-cpu-moe 20
```

- `--host 127.0.0.1` is required for Nexus. Do not pass `0.0.0.0`.
- `-ngl 99` (or `-ngl all` on builds that accept it) keeps attention layers on the GPU. Lowering `-ngl` to free VRAM sends attention to the CPU; prefer raising `--n-cpu-moe` instead.
- `--n-cpu-moe N` keeps MoE expert weights of the first N layers in system RAM (`-ncmoe`). `--cpu-moe` (`-cmoe`) keeps **all** expert weights on CPU.
- If port 8080 is already used (for example by an MLX server), pick another loopback port and match it in the manifest below.

Disk-streamed "patient" path (weights paged from disk; sub-1 tok/s; minutes-to-hours). This is the operator-side half of EM.P4.A. Enabling `nexus.llm.patientTier.enabled` is a **separate** settings change and still does not add a catalog entry:

```bash
llama-server \
  -m /path/to/large-moe.gguf \
  --host 127.0.0.1 \
  --port 8080 \
  --load-mode mmap \
  --cpu-moe \
  -ngl 99
```

`--load-mode mmap` is the current replacement for the deprecated `--mmap` flag. Confirm the spelling against your llama.cpp build. Optional: `--jinja` when the GGUF needs a Jinja chat template; `--flash-attn on` when your build and GPU support it.

Confirm the server before registering it: `GET http://127.0.0.1:8080/v1/models` should list the loaded model.

## 2. Register the adapter (manifest lives in settings)

The registry consumes `{ name, protocol, endpoint, label?, capabilities? }`. `protocol` must be `openai` for llama-server. `endpoint` is the **base URL without a trailing `/v1`**: the OpenAI client appends `/v1/chat/completions`.

Canonical example (also at [examples/llamacpp-loopback-adapter.json](./examples/llamacpp-loopback-adapter.json)):

```json
{
  "name": "llamacpp",
  "label": "llama.cpp (llama-server)",
  "protocol": "openai",
  "endpoint": "http://127.0.0.1:8080",
  "capabilities": { "chat": true }
}
```

### Desktop (`~/.nexus/settings.json`)

Merge the array and point `nexus.llm.backend` at the manifest `name`. Invalid or non-loopback entries are skipped with a warning; they never abort startup.

```json
{
  "nexus.llm.backend": "llamacpp",
  "nexus.llm.localAdapters": [
    {
      "name": "llamacpp",
      "label": "llama.cpp (llama-server)",
      "protocol": "openai",
      "endpoint": "http://127.0.0.1:8080",
      "capabilities": { "chat": true }
    }
  ]
}
```

### VS Code / Cursor (`nexus.llm.localAdapters`)

The same object goes in the contributed setting. `nexus.llm.backend` is the selector.

Restart the desktop sidecar (or reload the VS Code window) so the registry rebuilds.

## 3. What Nexus rejects

These endpoints fail `validateLocalAdapterManifest` (the same predicate as [`isLoopbackEndpoint`](../../modules/coding/llm/loopback.ts)):

- `http://192.168.1.10:8080` -- LAN, rejected.
- `http://10.0.0.5:8080` -- LAN, rejected.
- `https://api.example.com` -- remote, rejected.
- `http://0.0.0.0:8080` -- not loopback, rejected.

The rejection text cites the AGENTS.md MCP Registry Policy. There is no settings override that loosens this.

## 4. Patient tier (still gated)

[`patientTier.ts`](../../core/registry/patientTier.ts) is the timeout + visibility plumbing for disk-offload runs. It is **off by default**. This recipe does not flip `nexus.llm.patientTier.enabled`, does not add a `patient-tier` catalog tag, and does not populate GLM-5.2 / Laguna. Those remain [EM.P4.A](../v1/v1.12/known-gaps.md) enablement steps after runtime support and an independent benchmark. The Laguna catalog entry itself is a gated v1.18 item (LG-A1), not this page.

If you *already* run a slow disk-offload llama-server and you accept non-interactive latency, you may enable the patient timeout so the interactive 60s default does not abort the stream. That is an operator choice on an existing flag, not an opened gate.

## Why this is documentation, not a runtime

Nexus's shipped LLM path is Ollama plus LM Studio. llama.cpp is a different binary the user already chose to run. Bundling it would add a third inference engine, a supply-chain surface, and an auto-install path the local-first thesis does not want. The adapter registry exists so a user-started llama-server on loopback is selectable by name, with the same hard non-loopback reject as every other custom runtime.
