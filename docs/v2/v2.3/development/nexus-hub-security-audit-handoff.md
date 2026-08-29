# Nexus-Hub Security Audit Upstream Handoff

**Nexus-AI release**: v2.3.0
**Decision date**: 2026-08-28
**Ownership**: Nexus-Hub upstream only
**Current upstream status**: v4.1.1 confirmed, implementation not started, not released
**Seed comparison**: [Qwen3.8-Flash-Next, Video2X, and OpenWorker](../comparisons/v2.3.0-comparison-qwen-video2x-openworker.md)

## Decision

Nexus-AI does not import OpenWorker and does not edit, commit, or publish the sibling Nexus-Hub repository from this release plan. The useful delta is a skill-native Nexus-Hub workflow: compose existing security skills, produce explicit scanner receipts, and require an independent post-fix rescan. Nexus-AI may consume that capability later only through the normal versioned Hub release and sync path.

This handoff supersedes two stale details in the seed plan:

- `data/workflows.json`, not `data/bundles.json`, owns ordered workflow metadata. `data/bundles.json` owns install selectors such as `security-specialist` and is only conditional distribution-parity evidence.
- Scanner receipt states are `RAN`, `NOT_APPLICABLE`, `UNAVAILABLE`, `FAILED`, and `DECLINED`. `degraded` is an aggregate deterministic-coverage result. `skipped` is not a durable receipt state.

## Upstream scope

Nexus-Hub v4.1.1 should own the following deliverables:

1. A Security Audit preset that orders discovery, applicability classification, scanner execution, triage, remediation, retest, and independent review.
2. A schema-v2 scanner receipt for every applicable scanner family, including omissions and failures rather than silently dropping unavailable evidence.
3. Optional, local recipes for Semgrep, gitleaks, OSV-Scanner, Trivy configuration scanning, and Checkov. Recipes may explain installation, but the workflow must not install tools automatically.
4. A post-fix rescan that uses the same detector, configuration, and scope as the before receipt, records the finding delta, and is reviewed by an actor other than the fixer.
5. Backward compatibility for schema-v1 records without rewriting their meaning.

## Receipt contract

Each schema-v2 scanner receipt must record:

- Scanner identity and version.
- Scanner family and applicability evidence.
- Target scope.
- Configuration or ruleset fingerprint.
- Exact command as an argument list or an equivalent structured invocation.
- Exit code.
- Start and end timestamps.
- Artifact path.
- One closed-vocabulary state: `RAN`, `NOT_APPLICABLE`, `UNAVAILABLE`, `FAILED`, or `DECLINED`.
- A reason when the state is not `RAN`.

Corrected findings must link equivalent before and after receipts. Equivalence requires the same detector, configuration, and scope. The record must contain the finding delta and identify the fixer and the independent verifier. An applicable scanner in `UNAVAILABLE`, `FAILED`, or `DECLINED` state makes aggregate deterministic coverage degraded; the report must not present degraded coverage as a complete pass.

## Optional local scanner recipes

The recipes are guidance for tools a user installs and invokes locally. They must preserve these boundaries:

| Scanner      | Intended role                                     | Required constraint                                                                           |
| ------------ | ------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Semgrep      | Static application security testing               | Pin or record ruleset identity; do not upload source                                          |
| gitleaks     | Secret detection                                  | Record configuration and git scope; redact discovered secrets from reports                    |
| OSV-Scanner  | Dependency vulnerability inventory                | Record database/tool version and lockfile scope; do not infer reachability from a match alone |
| Trivy config | Infrastructure-as-code and configuration scanning | Use configuration mode only for this workflow; record policy/ruleset identity                 |
| Checkov      | Infrastructure-as-code policy scanning            | Run read-only; never apply infrastructure changes                                             |

Normal scanner database updates may use the scanner's documented behavior when the user invokes them, but Nexus-Hub itself must not hide an outbound call. A missing tool yields `UNAVAILABLE`; an intentional user refusal yields `DECLINED`. Neither may disappear from the coverage record.

## Explicit non-adoptions

The upstream work must not:

- Add OpenWorker as source, runtime, dependency, or attribution layer.
- Add a connector catalog, OAuth relay, hosted model, cloud reviewer, or generation service.
- Auto-install scanners or execute unreviewed installer commands.
- Treat reviewer approval as authority to bypass Nexus permission or confirmation controls.
- Let the fixer self-certify the final security result.
- Replace existing Nexus-Hub security skills when composition and narrow contract changes are sufficient.

## Nexus-Hub owner map

An upstream implementation plan should own these files or their direct successors:

| Responsibility                     | Nexus-Hub owner                                                                                 |
| ---------------------------------- | ----------------------------------------------------------------------------------------------- |
| Release contract                   | `docs/releases/v4/v4.1/development/v4.1.1-security-audit-contract.md`                           |
| Receipt schema reference           | `catalog/skills/code-review/security-review/references/closure-gate-review-record.md`           |
| Deterministic closure gate         | `catalog/skills/code-review/security-review/scripts/closure-gate.py`                            |
| SAST, secrets, and shared recipes  | `catalog/skills/code-review/security-review/SKILL.md` and `references/local-scanner-recipes.md` |
| Dependency scanning                | `catalog/skills/security/dependency-security-audit/SKILL.md`                                    |
| CVE reachability                   | `catalog/skills/security/cve-reachability-analyzer/SKILL.md`                                    |
| IaC and cloud posture scanning     | `catalog/skills/security-operations/cloud-security-posture-detection/SKILL.md`                  |
| Gitleaks prevention pointer        | `catalog/skills/security/pre-commit-checklist/SKILL.md`                                         |
| Remediation                        | `catalog/skills/security/security-patch-advisor/SKILL.md`                                       |
| Ordered preset                     | `catalog/skills/workflow/agent-presets/SKILL.md`                                                |
| Workflow metadata                  | `data/workflows.json`                                                                           |
| Independent read-only verification | `catalog/agents/security-reviewer.md`                                                           |
| Distribution integrity             | `MANIFEST.sha256`                                                                               |

Expected focused tests are `tests/skills/test_closure_gate.py`, `test_security_scanner_contract.py`, `test_security_audit_workflow.py`, `test_security_audit_contract_e2e.py`, and `tests/installer/test_install_selection.py`.

## Upstream acceptance criteria

- Every scanner family receives one valid closed-vocabulary receipt, including not-applicable, unavailable, failed, and declined cases.
- Schema-v2 validation rejects missing identity, applicability, scope, configuration fingerprint, timestamps, artifact, exit code, or omission reason fields.
- Schema-v1 records remain accepted unchanged.
- The ordered preset performs discovery before scanning, remediation only after triage, and independent verification after fixes.
- Before and after receipts prove equivalent detector, configuration, and scope before computing a finding delta.
- Scanner recipes remain optional, local, and read-only with no automatic installation or hidden network use.
- Focused-install selection includes every catalog owner required by the preset when `security-specialist` is selected.
- `MANIFEST.sha256` covers every affected catalog file plus `data/workflows.json`.
- Tests pass on the tagged release commit, not only on an implementation branch.

## Current upstream evidence

As of 2026-08-28, [Nexus-Hub PR 131](https://github.com/bendourthe/Nexus-Hub/pull/131) merged only the comparison, confirmed plan, and tracker update into `develop` at `0091e2627e1c656cf530e2f10e99292af0d2f0ad`. The tracker says confirmed and not started; all 32 implementation tasks remain unchecked. There is no official v4.1.1 implementation branch, tag, or GitHub Release.

The latest stable upstream release remains [v4.0.0](https://github.com/bendourthe/Nexus-Hub/releases/tag/v4.0.0), with `main` observed at `5bcfa89755fd77758551ec54bf4cecce6e05beac`. Nexus-AI's checked-in catalog receipt remains 3.21.0, while the separately installed local Nexus-Hub reports 4.0.0. None of those facts proves the v4.1.1 security workflow is installed.

## Nexus-AI consumption gate

Nexus-AI may claim this refinement as consumed only when all of the following are true:

1. The implementation merges green into Nexus-Hub `develop`, releases from `main`, and has an annotated `v4.1.1` tag plus a published GitHub Release.
2. The tagged `.claude-plugin/plugin.json` reports version `4.1.1`.
3. The tagged `MANIFEST.sha256` contains matching hashes for every affected `catalog/**` owner and `data/workflows.json`.
4. Nexus-AI sync reports `applied: true`, a passed prompt-injection scan, no quarantined required artifact, `manifestVerification.present: true`, and zero mismatches.
5. `~/.nexus-ai/catalog/nexus-hub-version.json` records version `4.1.1`, source `bendourthe/Nexus-Hub`, and the expected layout.
6. Installed catalog files prove the schema-v2 states, ordered preset, local scanner recipes, and independent read-only verifier.
7. `data/workflows.json` is verified separately against the tagged Hub source because the current Nexus-AI sync installs `catalog/**`, not `data/**`.
8. Focused Nexus-AI consumer tests pass; a version receipt by itself is not feature evidence.

## Consumer blocker to reconcile

The current offline snapshot builder compares the unprefixed Hub manifest version, for example `4.1.1`, literally with the GitHub tag, for example `v4.1.1`. Its tests use prefixed fixture versions and do not expose the mismatch. `build-hub-snapshot.py` must normalize that comparison before a valid v4.1.1 snapshot can be accepted. This is a Nexus-AI consumer gap for later reconciliation; it does not broaden this upstream handoff into a cross-repository implementation task.

Until every consumption gate passes, Nexus-AI documentation must describe this work as an upstream handoff, not an installed capability.
