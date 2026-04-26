# agent-friendly-truncation-recovery-grep-02

A small fixture repo with 220 TODO comments split across 5 source files.
Half of them mention "performance"; the other half mention unrelated
topics. The default Phase 1 grep_codebase max_results is 50, so the agent
must page through results using the `next_offset` cursor to count
performance-tagged TODOs.

The fixture files are checked in (small enough to commit). See
`tests/golden/tasks/agent-friendly-truncation-recovery-grep-02.yaml` for
acceptance criteria.
