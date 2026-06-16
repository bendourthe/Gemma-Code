# ADR-0019: Manifest-driven local-runtime adapter registry

- **Status**: Accepted
- **Date**: 2026-06-15
- **Deciders**: v1.6.0 Phase 5 -- aisuite-harness adoption cycle (comparison item A3). Extends [ADR-0016](./0016-second-llm-backend.md).

## Context

ADR-0016 added LM Studio as a second `LLMClient` backend, selected by a hand-edited `if/else` switch in the composition root (`NexusCodingRuntime._resolveBackend`) keyed on the `nexus.llm.backend` setting (`ollama | lmstudio | auto`). Each new local runtime (llama.cpp server, vLLM, MLX, ...) would mean another branch in that switch, another settings enum value, and an edit to the runtime -- the exact convention-over-configuration friction the aisuite comparison flagged in item A3, where aisuite auto-discovers providers that conform to a known client pattern.

The constraint is the local-first thesis: any discovered adapter must speak a **loopback** endpoint only. A discovery surface that could register an arbitrary remote endpoint would reintroduce the outbound network surface, API-key, and per-token-billing concerns the project rejects by construction, in direct conflict with the AGENTS.md MCP Registry Policy.

This phase is the demand-gated A3 item, built as a forward-looking, guarded refactor (no third runtime ships this cycle).

## Decision

Introduce a config-driven `LocalAdapterRegistry` in `modules/coding/llm/LocalAdapterRegistry.ts`. An adapter is described by a validated manifest -- `{ name, protocol, endpoint, label?, capabilities? }` -- where `protocol` (`ollama` | `openai`) maps to one of the existing `LLMClient` factories. The two shipped adapters (Ollama, LM Studio) are expressed as built-in manifests rather than switch branches.

Concrete points:

- **Manifest validation is the policy gate.** `validateLocalAdapterManifest` runs a strict zod schema, then enforces a loopback-only endpoint (`127.0.0.0/8`, `::1`, `localhost` / `ip6-localhost` / `ip6-loopback`). A non-loopback endpoint is rejected with an error that **cites the AGENTS.md MCP Registry Policy**. The loopback check is intentionally stricter than `ssrf.isBlockedIp` (which also matches RFC-1918 LAN ranges): a *local runtime* must be loopback, not a LAN host.
- **The registry lives under `modules/coding/llm/`, not `core/`.** The `no-llm-outside-llm-folder` boundary rule restricts direct imports of the concrete clients to this folder, and `no-core-from-modules` forbids `core/` from importing the `modules/coding/utils/ssrf.ts` loopback primitive it mirrors. Keeping it here preserves both rules.
- **The composition root threads it.** `NexusCodingRuntime` builds a registry seeded with the built-ins plus any user manifests from the new `nexus.llm.localAdapters` setting (invalid / non-local entries are skipped with a warning, never aborting startup), rebuilds it on a live settings change, and `getOllamaClient()` delegates construction to `registry.createClient(name, ...)`. `nexus.llm.backend` is widened to any string so a user-registered adapter is selectable by its manifest name; an unknown value falls back to the existing `auto` resolution.

## Consequences

- **Positive**: Adding a local runtime that speaks an already-supported wire protocol is now a manifest-only change (a settings entry, no recompile). The local-only guarantee is enforced at a single, fully-tested gate that names the governing policy in its rejection. The `LLMClient` port and every consumer are unchanged.
- **Negative**: One more indirection between the setting and the concrete client. A genuinely new wire protocol still needs a new `LLMClient` implementation plus a `protocol` entry -- the registry removes the per-runtime switch edit, not the per-protocol adapter.
- **Neutral**: `nexus.llm.backend` is no longer a closed enum at the type level (still advertised as `ollama | lmstudio | auto` in `package.json` for the settings UI). No third runtime ships this cycle; the discovery path is exercised by tests only until concrete demand lands.

## Alternatives considered

- **Keep the hand-edited switch.** Rejected: it is the friction A3 targets; every new local runtime would touch the runtime, the settings enum, and the switch.
- **Put the registry in `core/registry/`.** Rejected: `core/` cannot import the `modules/coding/utils/ssrf.ts` loopback primitive (`no-core-from-modules`), and the concrete-client import rule keeps client construction in `modules/coding/llm/`. A core-side copy of the loopback list would be a second security-relevant primitive that can drift.
- **Allow LAN endpoints ("local network").** Rejected: a LAN box is another machine; the README single-machine / single-GPU thesis and the MCP Registry Policy scope "local" to loopback.
- **Discover manifests from a directory of `*.json` files.** Deferred: the settings array is the lower-risk, fully-unit-testable surface; a filesystem auto-discovery sweep is additive if demand appears (recorded in v1.6.0 known-gaps).

## Links

- Extends: [ADR-0016](./0016-second-llm-backend.md) (second LLM backend; selection mechanism superseded by this ADR).
- Plan: `docs/versions/v1/v1.6.0/plans/adoption-aisuite-harness.md` Phase 5 (AS007).
- Comparison: `docs/versions/v1/v1.6.0/comparison-aisuite.md` item A3.
- Policy: `AGENTS.md` MCP Registry Policy (local-only bucket).
