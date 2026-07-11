<!-- v0.9.0 Phase 5 sub-task 5.2 -- PR template + Submission Checklist gate.
     The `Submission Checklist` section is enforced by
     scripts/check-pr-checklist.mjs and .github/workflows/pr-quality.yml.
     Each box must be either `- [x]` or start with `- [ ] N/A: <reason>`. -->

## Summary

<!-- 1-3 sentences describing what this PR changes and why. -->

## Changes

<!-- Bulleted list of the substantive code, doc, and test changes. -->

-

## Test plan

<!-- Bulleted list of the commands you ran (or that CI will run) and the
     expected outcomes. Reference any operator follow-ups. -->

- [ ] `npm run lint`
- [ ] `npm run build`
- [ ] `npm run check`
- [ ] `npm test`
- [ ] Other:

## Linked issues

<!-- Closes #N / Refs #N / etc. -->

## Submission Checklist

<!-- The pr-quality.yml workflow refuses to merge until every box below is
     either ticked (`- [x]`) OR replaced with `- [ ] N/A: <one-line reason>`.
     Lying here breaks downstream consumers; please be honest. -->

- [ ] I have read CONTRIBUTING.md (or CONTRIBUTING-BEGINNERS.md)
- [ ] I completed the [self-review checklist](../docs/v1/v1.4/development/self-review-checklist.md) (G1-G5: DRY, all-symbols-called, DoD-verified-with-evidence, no-test-regression, TDD-red-evidence) and recorded the evidence above
- [ ] `npm run lint` passes locally
- [ ] `npm run check` passes locally
- [ ] `npm test` passes locally
- [ ] `npm run deps:check`, `npm run catalog:check`, `npm run perm-tier:check` all pass
- [ ] I added tests for new behaviour (or `- [ ] N/A: <reason>`)
- [ ] I updated docs / DEVLOG / ADR where relevant (or `- [ ] N/A: <reason>`)
- [ ] **No new outbound network calls or new third-party data processors introduced** (cite MCP Registry Policy if claiming exception)
- [ ] The evidence above is verified-only output per the [evidence-pack discipline](../docs/v1/v1.4/development/evidence-pack.md) (every claim is a captured command result, not an assertion). Note: PR ready is not release ready.
