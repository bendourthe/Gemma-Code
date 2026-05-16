---
name: harden
description: Add error handling, input validation, and edge-case coverage where a specific risk justifies it. Each addition must trace to a real failure mode.
argument-hint: "[file or area]"
version: 1.0.0
platforms: [linux, macos, windows]
metadata.tags: [robustness, error-handling, security]
metadata.related_skills: [distill, critique]
---

You are hardening code against realistic failure modes. The goal is robustness, NOT defensive paranoia. Every line you add must trace to a specific, identifiable risk.

Scope:
- If `$ARGUMENTS` names a file, function, or directory, restrict hardening to that target.
- Otherwise, focus on the most-recently-modified files and the system boundaries (HTTP handlers, CLI entry points, file I/O, deserialisation).

Hardening checklist (apply each only when the risk is real):
1. **Input validation at boundaries** -- HTTP requests, CLI args, file contents, environment variables, IPC payloads. Validate types, ranges, lengths, encodings. Use schema libraries (Zod, Pydantic, validator.v10) over hand-rolled checks where the project already depends on them.
2. **Error handling** -- catch errors only where you can do something meaningful. Either: (a) recover and continue, (b) wrap with context and rethrow, (c) translate to a user-facing message at the boundary. Never swallow.
3. **Resource cleanup** -- file handles, network sockets, DB connections, child processes, timers. Use language-native idioms (try/finally, defer, with-statement, RAII).
4. **Edge cases** -- empty inputs, max-size inputs, Unicode, leading/trailing whitespace, null bytes, off-by-one at array boundaries, integer overflow, time-zone edge cases, concurrent modification.
5. **Retry / timeout** -- ONLY for I/O calls to external systems. Use exponential backoff with a cap and a circuit breaker. Never retry CPU-bound work or in-process calls.
6. **Concurrency** -- shared state without synchronisation, missing context cancellation, goroutines/promises that can outlive their parent.

Process:
1. Read the target end-to-end. Identify the trust boundaries (user input arrives where? external calls leave where?).
2. Build a list of identified risks. For each, write down:
   - The specific failure mode.
   - The blast radius if it occurs.
   - The proposed mitigation.
3. Implement the mitigations one at a time. After each:
   - Add a regression test that exercises the failure mode.
   - Run the test suite.
4. Report:
   - Risks identified.
   - Mitigations applied (with file:line).
   - Tests added.
   - Risks identified but NOT mitigated, with rationale (cost > benefit, blocked on broader work, etc.).

Hard rules:
- No defensive checks against scenarios that cannot occur given the type system or framework guarantees.
- No retry on internal calls; retry is a network-boundary tool.
- Every new error message must be unique enough to grep for in logs.
- Validate at the boundary, not in every internal function.
- If you cannot articulate the failure mode in one sentence, the check is not justified.

Usage example:
- `/harden src/api/handlers/upload.ts` -- harden the upload handler.
- `/harden src/storage/MemoryFiles.ts` -- harden the memory file I/O paths.

$ARGUMENTS
