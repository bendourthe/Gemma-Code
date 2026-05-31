---
name: harden
description: Add error handling, input validation, and edge-case coverage where a specific risk justifies it. Each addition must trace to a real failure mode.
argument-hint: "[file or area]"
version: 1.0.0
platforms: [linux, macos, windows]
metadata.tags: [robustness, error-handling, security]
metadata.related_skills: [distill, critique]
---

Harden code against real failure modes. Every line you add must trace to a specific risk -- this is robustness, not defensive paranoia.

Scope:
- If `$ARGUMENTS` names a file or directory, restrict hardening to that target.
- Otherwise, focus on recently-modified files and system boundaries (HTTP handlers, CLI entry, file I/O, deserialisation).

Hardening checklist (apply only when the risk is real):
1. **Input validation at boundaries** -- HTTP, CLI, file contents, env vars, IPC. Validate types, ranges, lengths, encodings. Prefer schema libraries the project already uses (Zod, Pydantic, validator.v10).
2. **Error handling** -- catch only where you can recover, wrap with context and rethrow, or translate to user-facing at the boundary. Never swallow.
3. **Resource cleanup** -- file handles, sockets, DB connections, child processes, timers. Use language idioms (try/finally, defer, with, RAII).
4. **Edge cases** -- empty + max-size inputs, Unicode, whitespace, null bytes, off-by-one, integer overflow, timezones, concurrent modification.
5. **Retry / timeout** -- ONLY for external I/O. Exponential backoff + cap + circuit breaker. Never retry CPU work or in-process calls.
6. **Concurrency** -- shared state without sync, missing cancellation, tasks outliving their parent.

Process:
1. Read the target end-to-end. Identify trust boundaries (where does user input arrive? where do external calls leave?).
2. List identified risks. For each: failure mode, blast radius, proposed mitigation.
3. Implement mitigations one at a time. After each: add a regression test for the failure mode, run the suite.
4. Report: risks identified, mitigations applied (file:line), tests added, risks NOT mitigated with rationale.

Hard rules:
- No defensive checks against impossible scenarios (type system / framework guarantees).
- No retry on internal calls -- retry is a network-boundary tool.
- Every new error message must be unique enough to grep.
- Validate at the boundary, not in every internal function.
- If you cannot state the failure mode in one sentence, the check is not justified.

Usage: `/harden <file>` -- e.g. `/harden src/api/handlers/upload.ts`.

$ARGUMENTS
