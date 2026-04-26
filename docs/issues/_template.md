---
id: ISSUE-0001
title: Short descriptive title
state: open
github_issue:
opened: YYYY-MM-DD
closed:
severity: blocker
---

## What

One paragraph describing the observed behavior or problem. Include the
trigger (what the user did, what the agent did, what the system reported)
and the symptom (what should have happened versus what actually happened).
Be concrete enough that a future reader can recognise the same situation
without external context.

## Why

One paragraph explaining the root cause or motivation, written *after* the
investigation has converged. If the cause is still under investigation,
note "Working theory:" and the current best hypothesis; replace with the
confirmed cause when known. Do not leave speculation framed as fact.

## Resolution

- Bullet list of changes that resolved (or will resolve) the issue. One bullet
  per code change, configuration tweak, or doc update.
- Cite file paths in markdown link format (e.g. `[file.ts](src/file.ts)`)
  so the resolution narrative survives a refactor.
- If the resolution is "documented as known limitation, will not fix", say
  so explicitly and explain why.

## References

- Relevant file paths
- Related ADRs (if a decision was crystallised, link the ADR)
- Related GitHub PRs / issues (full URL or `#NN` short form)
- Related commit hashes (if the fix is already merged)

<!--
Filename convention: <id>-<short-slug>.md
  Examples:
    docs/issues/0001-ollama-warm-up-latency.md
    docs/issues/0007-memory-corroboration-backfill.md

Severity rubric (mirrored from docs/v0.5.0/tool-audit.md):
  blocker      — prevents reliable use; needs immediate fix
  friction     — works but inefficiently (more retries, brittle parsing)
  optimization — functions well but could be faster / cheaper / clearer

This pattern is opt-in. Small issues do not need an entry here.
Multi-week investigations or recurring patterns should.
-->
