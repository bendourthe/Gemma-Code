# Drive an MLX model through Nexus (Apple Silicon)

Nexus does not bundle an MLX runtime. A dedicated MLX engine was rejected in the [v1.12 comparison (D4)](../../v1.12/comparison-ecosystem-2026-07.md) as irrelevant to an Ollama/GGUF product, and again in the [v1.16 comparison (N3)](../comparisons/v1.16.0-comparison-local-serving-and-ocr.md) as a supply-chain and OS-parity miss. Apple Silicon users who already run an OpenAI-compatible MLX server (mlx-vlm, LM Studio in MLX mode, or nativ) can still consume it from Nexus by registering that server as a loopback `nexus.llm.localAdapters` manifest. No new Nexus code, no outbound endpoint, no third runtime in the installer.

This is the same mechanism that already routes Ollama and LM Studio: [`LocalAdapterRegistry`](../../../../modules/coding/llm/LocalAdapterRegistry.ts) (the VS Code / coding-runtime path) and the sidecar serving gateway's vscode-free twin ([`desktop/sidecar/src/serving/adapters.ts`](../../../../desktop/sidecar/src/serving/adapters.ts)). Both enforce the loopback-only guard from [`modules/coding/llm/loopback.ts`](../../../../modules/coding/llm/loopback.ts). A non-loopback `endpoint` is rejected with an error that cites the AGENTS.md MCP Registry Policy.

**Support tier**: the adapter registry itself is `supported`. An on-device chat against a live MLX server is `internal-compatible` until the [macOS Apple-Silicon smoke checklist](../testing/macos-mlx-smoke.md) is filled in on hardware (the Windows dev host cannot virtualize macOS). See [evidence-and-support-tiers.md](../../v1.4/development/evidence-and-support-tiers.md).

## What you need

- A Mac with Apple Silicon (M1 or later). Intel Macs can still register a loopback adapter, but MLX itself targets Apple Silicon.
- An OpenAI-compatible server already running on loopback. Nexus never starts this process. Typical options:
  - **mlx-vlm** -- a local OpenAI-shaped HTTP server in front of an MLX vision-language (or text) model. Consult mlx-vlm's own README for the current serve command; Nexus only cares that `GET /v1/models` and `POST /v1/chat/completions` answer on a `127.0.0.1` port.
  - **LM Studio, MLX mode** -- LM Studio already speaks OpenAI on `http://127.0.0.1:1234`. If you are only using LM Studio, set `nexus.llm.backend` to `lmstudio` and skip the custom manifest; the built-in adapter is enough.
  - **nativ** -- nativ's loopback server (default `http://127.0.0.1:8080`) is the same OpenAI/Anthropic shape. Register it as a user adapter if you want Nexus (rather than nativ) to be the client.
- Nexus desktop (settings live in `~/.nexus/settings.json`) or the Nexus Code VS Code extension (the `nexus.llm.localAdapters` contributed setting).

The OpenAI client Nexus uses appends `/v1/chat/completions` to the manifest `endpoint`. Do **not** put a trailing `/v1` on the URL.

## Register the adapter

### Desktop (`~/.nexus/settings.json`)

Merge the `nexus.llm.localAdapters` array and point `nexus.llm.backend` at the manifest `name`. Invalid or non-loopback entries are skipped with a warning; they never abort startup.

```json
{
  "nexus.llm.backend": "mlx",
  "nexus.llm.localAdapters": [
    {
      "name": "mlx",
      "label": "MLX (mlx-vlm)",
      "protocol": "openai",
      "endpoint": "http://127.0.0.1:8080",
      "capabilities": { "chat": true, "vision": true }
    }
  ]
}
```

### VS Code / Cursor (`nexus.llm.localAdapters`)

The same objects go in the contributed setting. `nexus.llm.backend` is the selector; any registered manifest `name` is valid (unknown values fall back to the existing `auto` resolution).

```json
{
  "name": "mlx",
  "label": "MLX (mlx-vlm)",
  "protocol": "openai",
  "endpoint": "http://127.0.0.1:8080",
  "capabilities": { "chat": true, "vision": true }
}
```

### Other loopback servers

LM Studio's MLX mode, if you want it as a named adapter rather than the built-in `lmstudio`:

```json
{
  "name": "lmstudio-mlx",
  "label": "LM Studio (MLX)",
  "protocol": "openai",
  "endpoint": "http://127.0.0.1:1234",
  "capabilities": { "chat": true }
}
```

nativ's default loopback server:

```json
{
  "name": "nativ",
  "label": "nativ",
  "protocol": "openai",
  "endpoint": "http://127.0.0.1:8080",
  "capabilities": { "chat": true }
}
```

Restart the desktop sidecar (or reload the VS Code window) after editing so the registry rebuilds. Then select the adapter: set `nexus.llm.backend` to the manifest `name` (`mlx`, `lmstudio-mlx`, or `nativ` in the examples above).

## Confirm it works

1. The MLX (or LM Studio / nativ) server is listening on the loopback port you registered. `GET http://127.0.0.1:<port>/v1/models` returns a models list.
2. In Nexus Chat or Coding, the model picker lists that server's models (or you can type a model id the server advertises). Sending a short prompt streams a reply.
3. If Settings > Local API server is on, the same adapter is reachable from other tools on this machine through Nexus's own gateway at `http://127.0.0.1:<serving-port>/v1`. The gateway is the inverse of this adapter: it *serves* Nexus's models; the adapter *consumes* an MLX server. Both are loopback-only.

A request that names a non-loopback host never starts. Typical refusals:

- `http://192.168.1.10:8080` -- LAN, rejected.
- `http://10.0.0.5:8080` -- LAN, rejected.
- `https://api.example.com` -- remote, rejected.

## Why this is documentation, not a runtime

Nexus's shipped LLM path is Ollama (GGUF) plus LM Studio. MLX is a different weight format and a different engine. Bundling it would add a macOS-only, Apple-Silicon-only dependency, which breaks OS parity (every Windows claim must also work on macOS Intel and Linux, or be documented as a per-platform note). The adapter registry already exists so a user who *chooses* to run mlx-vlm (or nativ, or LM Studio MLX) can point Nexus at it without a Nexus release. That is the whole feature.

The on-device verification of this page lives in [testing/macos-mlx-smoke.md](../testing/macos-mlx-smoke.md). Fill it in on a physical Mac; the Windows development host cannot run this checklist.
