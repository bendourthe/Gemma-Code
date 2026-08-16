# macOS Apple-Silicon MLX smoke (manual)

v1.16.0 Phase 5 (adoption item A3). macOS cannot be virtualized on the Windows dev host, so the MLX-via-`localAdapters` path is verified manually on a physical Apple Silicon Mac using this checklist. It mirrors the [v1.11.0 macOS install checklist](../../v1.11/testing/macos-install-checklist.md) pattern: preconditions, numbered steps, a recorded result. No model weights and no MLX runtime ship in CI.

**Preconditions:** Apple Silicon Mac (M1 or later) with Nexus desktop (or Nexus Code) installed, and an OpenAI-compatible MLX server the operator already trusts (mlx-vlm, LM Studio in MLX mode, or nativ). Record macOS version and chip. Do not run an untrusted installer to obtain the server; this checklist only registers a server that is already running on loopback.

Follow the how-to at [guides/mlx-via-local-adapters.md](../guides/mlx-via-local-adapters.md).

## A. Server is local

- [ ] The MLX (or LM Studio / nativ) process is listening on `127.0.0.1` (not a LAN or public bind).
- [ ] `GET http://127.0.0.1:<port>/v1/models` returns HTTP 200 and a JSON models list.
- [ ] A raw `POST http://127.0.0.1:<port>/v1/chat/completions` with a one-token prompt streams or returns a completion (proves the server, independent of Nexus).

## B. Manifest registers

- [ ] `~/.nexus/settings.json` (desktop) or the VS Code `nexus.llm.localAdapters` setting contains a manifest whose `protocol` is `"openai"` and whose `endpoint` is the loopback URL from A, with **no** trailing `/v1`.
- [ ] `nexus.llm.backend` equals that manifest's `name`.
- [ ] Reloading the desktop sidecar / VS Code window does not warn about a rejected manifest.
- [ ] A deliberately non-loopback endpoint (`http://192.168.1.10:8080`) is refused with a message that cites the MCP Registry Policy.

## C. Nexus lists and chats

- [ ] Chat or Coding shows at least one model id advertised by the MLX server (or accepts typing that id).
- [ ] Sending a short prompt ("Reply with the single word pong.") streams a reply. No outbound network beyond loopback.
- [ ] (Optional) With Settings > Local API server on, `GET http://127.0.0.1:<serving-port>/v1/models` (bearer token required) still lists Nexus's own installed models. This is a separate surface; it does not have to list the MLX server's models.

## D. Result

Record: date, macOS version, chip (e.g. M2 Pro), which server (mlx-vlm / LM Studio MLX / nativ), endpoint, per-step pass/fail. File a failure as a v1.16.0 known-gaps row. A blank checklist means the smoke has not been run on hardware yet; that is a recorded gap, not a silent pass.
