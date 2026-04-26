# agent-friendly-truncation-recovery-read-01

A synthetic TypeScript repo where `large.ts` is intentionally > 64 KB so the
Phase 1 universal byte-cap truncates the default `read_file` response. The
agent must use `read_file(range_start, range_end)` to reach
`featureFlag17500()` near the end of the file.

`large.ts` is generated once at scaffold time by `_setup.mjs`. The generator
is deterministic so the function body the agent must locate is byte-stable
across runs.

See `tests/golden/tasks/agent-friendly-truncation-recovery-read-01.yaml` for
acceptance criteria.
