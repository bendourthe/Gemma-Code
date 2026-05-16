---
name: incident-commander
description: Triage a failing build, test, or runtime error in safety-tiered order and write a post-incident playbook entry
argument-hint: "[failing output or path]"
version: 1.0.0
platforms: linux,macos,windows
metadata.tags: incident-response,triage,debugging
metadata.related_skills: [critique, harden]
---

You are acting as an incident commander for a failing build, test, or runtime error. Follow the structured six-step procedure below in a single response. Do not skip steps and do not run anything destructive without surfacing it as a permission-prompt first.

## Step 1: Read the failing output

Quote the failure verbatim (first error line + stack frame, plus the test name or job name). If the failure spans multiple frames, keep only the innermost-relevant frame plus the boundary frame in the caller.

## Step 2: Classify the failure

Pick exactly one classification and state your reasoning in one sentence:

- **regression** -- worked recently, now broken. Likely a recent code or dependency change.
- **flake** -- intermittent, timing-sensitive, or environment-dependent.
- **env** -- missing tool, wrong version, path issue, permissions, network.
- **dependency** -- newly upgraded or missing package, lockfile drift.
- **logic** -- the implementation is wrong (the test is right).
- **test** -- the test is wrong (the implementation is right).

## Step 3: Write a 3-tier remediation list, ordered by safety

Always produce three tiers. Each tier lists actions in increasing risk order.

- **Tier 1 (read-only diagnosis):** `git log`, `git diff`, reading files, running existing failing tests in isolation, inspecting logs. Zero state change.
- **Tier 2 (no-op verifications):** `npm run lint`, `npm run build`, dry runs, `--dry-run` flags, `git stash` (reversible). State change but trivially reversible.
- **Tier 3 (minimal targeted fix):** the smallest possible code edit that addresses the root cause. No refactors, no adjacent cleanup. Reference the exact file and line.

## Step 4: Execute the lowest-tier action only

Run Tier 1 first. If Tier 1 confirms the diagnosis, propose Tier 2 actions but PAUSE before running them. Only escalate to Tier 3 after Tier 2 confirms the failure mode reproduces deterministically.

## Step 5: Re-run the verification

After applying a Tier 3 fix, re-run the original failing command. Quote the new output verbatim. If it still fails, restart from Step 1 with the new evidence.

## Step 6: Write the playbook entry

When the incident is resolved, append a Markdown entry to `docs/v0.8.0/development/incidents/<YYYY-MM-DD>-<slug>.md` with:

- **Symptom:** what was failing
- **Classification:** from Step 2
- **Root cause:** one sentence
- **Fix:** what file/line was changed and why
- **Prevention:** the smallest test, lint rule, or invariant that would have caught this earlier

Keep the entry under 150 lines. The goal is a searchable record, not a postmortem novel.

$ARGUMENTS
