# v0.7.0 Phase 6 -- Multi-harness skill packaging + standalone deterministic-checks CLI

**Cycle**: v0.7.0
**Phase**: 6 (multi-harness skill packaging + standalone deterministic-checks CLI)
**Date**: 2026-05-14
**Plan reference**: [docs/archive/versions/v0/v0.7.0/plans/v0.7.0-cycle.md](../../plans/v0.7.0-cycle.md) Phase 6
**Comparison reference**: [docs/archive/versions/v0/v0.7.0/comparison-multi-source.md](../../comparison-multi-source.md) C29, C30
**ADR**: None this phase (both sub-tasks are mechanical packaging / tooling additions; no architectural decision rises to ADR threshold).

---

## 1. Scope

Phase 6 ships two LLM-free release artifacts:

1. **`scripts/package-skills.mjs`** -- exports the gemma-code skill catalog (`src/skills/catalog/<slug>/SKILL.md`) into four sibling agentic harnesses (Claude Code, Cursor, OpenCode, Gemini CLI). Outputs land under `dist/<harness>/`; the tree is gitignored and uploaded as four separate CI artifacts so the v0.7.0 release pipeline can attach them to the GitHub release without an extra manual step.
2. **`bin/gemma-check.mjs`** -- a standalone Node CLI wrapping a small hand-curated rule set. The CLI is published as the `gemma-check` binary, scans a directory or file recursively, and exits non-zero on findings. Initial rule set: `no-secret-patterns`, `no-math-random-for-tokens`, `no-committed-console-log`, `no-env-file-leakage`. The optional 5th rule (`no-bare-promise-rejection`) is deferred.

Both sub-tasks landed with full test coverage (74 new test cases; 2110 total tests pass; zero failures; line coverage 89.68% on `src/**/*.ts`). Four in-cycle gaps recorded: one DF (Cursor schema), one NI (deferred 5th rule), two WN (pre-existing deps-check carryovers + opportunistic legacy-script cleanup).

---

## 2. Sub-tasks executed

### 2.1 -- `scripts/package-skills.mjs` (sub-task 6.1)

The packaging script reads `src/skills/catalog/<slug>/SKILL.md` for every skill in the catalog (13 skills as of Phase 6 close) and writes a per-harness output tree under `dist/<harness>/`. The structure is a small adapter table:

```js
const HARNESSES = [
  { id: "claude-code",  relativePath: slug => `.claude/skills/${slug}/SKILL.md`,  render: raw => raw },
  { id: "opencode",     relativePath: slug => `.opencode/skills/${slug}/SKILL.md`, render: raw => raw },
  { id: "gemini-cli",   relativePath: slug => `.gemini/skills/${slug}/SKILL.md`,   render: raw => raw },
  { id: "cursor",       relativePath: slug => `.cursor/rules/${slug}.md`,          render: renderCursor, warn: true },
];
```

Claude Code, OpenCode, and Gemini CLI all consume the Anthropic SKILL.md schema verbatim, so the script emits byte-identical copies of each SKILL.md under the conventional path each harness reads from. Cursor is the open case: its native rule format is `.cursor/rules/<slug>.mdc` with frontmatter `description` / `globs` / `alwaysApply`, which differs enough from SKILL.md that a 1:1 mapping is non-trivial.

Rather than ship a half-baked mapping, the Cursor adapter does the minimal correct thing:

- Emits `.cursor/rules/<slug>.md` (not `.mdc`) so it does not falsely claim to be a native Cursor rule.
- Replaces the SKILL frontmatter with a placeholder `rule: SKILL\nname: <slug>` block plus an HTML comment explaining the deferral.
- Preserves the original frontmatter fields (`name`, `description`, `argument-hint`) as `# original: <key>: <value>` comment lines inside the HTML comment so a future native converter can read them back.
- Preserves the body verbatim.
- Logs a per-run warning to stderr (`WARN: cursor: schema differs from gemma-code's SKILL.md; emitting best-effort transform...`).
- The bundled `dist/cursor/README.md` documents the limitation prominently.

Each output directory also gets a generated `README.md` (built by `buildHarnessReadme`) that names the harness, points back to `src/skills/catalog/` as the source of truth, summarises the schema mapping, and lists every shipped skill alphabetically. The README content is deterministic with respect to the catalog so the script can be re-run safely.

The `parseSkill` helper is a tiny YAML-ish parser scoped to the SKILL.md shape: it requires the leading `---\n` fence, finds the trailing `\n---\n` fence, parses `key: value` lines (skipping blanks and `#` comment lines), strips matching quotes, and returns `{ frontmatter, body }`. It throws on a missing leading or trailing fence; the script's `main()` catches the throw, logs `ERROR: <slug>/SKILL.md: <reason>`, and exits with code 2 so a malformed catalog file fails CI.

The script's `main()` entry is guarded with `if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)` so the unit tests can `import { HARNESSES, parseSkill, renderCursor, buildHarnessReadme } from "..."` without triggering writes.

CLI flags:

- `--quiet`: suppress per-skill log lines (final summary still prints).
- `--no-clean`: skip `rm -rf` of each harness output dir before writing. Useful when re-running incrementally during development.

CI integration: a new `package-skills` job in [.github/workflows/ci.yml](../../../../../.github/workflows/ci.yml) runs `npm run package:skills -- --quiet` on every push and uploads each `dist/<harness>/` tree as a separate `actions/upload-artifact@v4` artifact with 30-day retention. The artifacts have stable names (`skills-claude-code`, `skills-cursor`, `skills-opencode`, `skills-gemini-cli`) so the release pipeline can pick them up by name.

Local entry point: `npm run package:skills`. The script also runs cleanly with `node scripts/package-skills.mjs` for users who want to invoke it without npm.

### 2.2 -- `bin/gemma-check.mjs` (sub-task 6.2)

A new published `bin` (`gemma-check`) wraps a small rule set under `lib/checks/`. Each rule module exports the same three-symbol contract: `{ id, severity, scan(filePath, contents): Finding[] }`. The central registry is [lib/checks/index.mjs](../../../../lib/checks/index.mjs), which exports `RULES` (array, controls report ordering) and `RULE_BY_ID` (index by id).

The CLI's pipeline:

1. **`parseArgs(argv)`** -- positional paths default to `["."]`; flags: `--json`, `--rule <id>` (repeatable), `--list-rules`, `--help`. Unknown flags are collected for an exit-2 error message.
2. **`selectRules(requestedIds)`** -- empty list returns the full `RULES` array; non-empty list throws on unknown id.
3. **`walk(root)`** -- yields scannable files under `root`. Skips directories in `SKIPPED_DIRECTORIES` (`node_modules`, `.git`, `out`, `dist`, `coverage`, `.vscode-test`, `.stryker-tmp`, `.husky`, `.cache`, `.turbo`). Filters by `SCANNED_EXTENSIONS` (`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.mts`, `.cts`). Symlinks are not followed (avoids cycles and reads outside the target tree).
4. **`scanPath(target, rules)`** -- reads each file, calls every rule's `scan(filePath, contents)`, aggregates findings.
5. **Reporting** -- `reportJson` emits `{findings: [...]}`; `reportHuman` emits one `file:line:column  severity  rule  message` line per finding plus a tally footer.

Exit codes: `0` = no findings, `1` = one or more findings, `2` = invalid invocation or I/O error.

### 2.3 -- Rule implementations

Each rule lives in its own file under `lib/checks/`:

**`lib/checks/no-secret-patterns.mjs`** (error)

Patterns mirror `scripts/hooks/check-prompt-policy.mjs` verbatim:

- AWS access key: `/AKIA[0-9A-Z]{16}/`
- GitHub PAT: `/ghp_[A-Za-z0-9]{36}/`
- JWT triplet: `/eyJ[A-Za-z0-9_-]{10,400}\.eyJ[A-Za-z0-9_-]{10,800}\.[A-Za-z0-9_-]{10,400}/`
- SSH private-key header: `/-----BEGIN (?:RSA|OPENSSH|EC) PRIVATE KEY-----/`
- PEM private-key header: `/-----BEGIN PRIVATE KEY-----/`

All patterns use bounded quantifiers so the rule is ReDoS-resistant by construction. Allow markers and comment context both suppress findings.

**`lib/checks/no-math-random-for-tokens.mjs`** (error)

Pattern: `/\bMath\.random\s*\(/`. Scopes to files whose full normalised path contains `auth` / `token` / `crypto` / `secret` / `password` / `jwt` / `session` (the "path contains" rule means a generically-named file under `src/auth/` is treated as sensitive). Allow markers + comment context suppress.

**`lib/checks/no-committed-console-log.mjs`** (warning)

Pattern: `/\bconsole\.log\s*\(/`. Skips test files (`tests/`, `test/`, `__tests__/`, `*.test.*`, `*.spec.*`). Allow markers + comment context suppress.

**`lib/checks/no-env-file-leakage.mjs`** (warning)

Pattern: `/(?<![A-Za-z0-9_$])\.env(?:\.[A-Za-z0-9_-]+)?(?![A-Za-z0-9])/`. The negative lookbehind is the key piece: it rejects property accessors (`process.env`, `vscode.env.openExternal`, `this._config.env`, `process.env[key]`) where the character preceding `.env` is alphanumeric / `_` / `$`. The trailing lookahead rejects coincidental matches like `.environment` / `.envoy` while still accepting the `.env.local` / `.env.production` family. The literal `.env.example` is allow-listed at match time. Test / example / docs files are skipped entirely.

**Optional 5th rule (deferred)**

`no-bare-promise-rejection` (regex `/\.catch\(\s*\)/`) is listed in the plan as optional. It is not shipped in Phase 6; the contract is `{ id, severity, scan }` so adding it later is a one-file change. Logged as in-cycle gap 10.O.8.

### 2.4 -- Cross-cutting helpers

Two cross-cutting helpers live in [lib/checks/helpers.mjs](../../../../lib/checks/helpers.mjs):

**`isAllowed(contents, offset, ruleId)`** recognises four marker shapes:

- `gemma-check-allow` (same line, any rule)
- `gemma-check-allow: <rule-id>[, <rule-id>...]` (same line, scoped)
- `gemma-check-allow-next-line` (preceding line, any rule)
- `gemma-check-allow-next-line: <rule-id>[, ...]` (preceding line, scoped)

The disambiguation between `gemma-check-allow` and `gemma-check-allow-next-line` is handled by a guard inside `markerMatches`: when looking for `gemma-check-allow`, the after-text is checked for a leading `-next-line` and rejected if present (otherwise the shorter marker would falsely match the longer one).

**`isInComment(contents, offset)`** detects matches sitting inside line comments (`//`), trailing comments (`code(); // ...`), JSDoc block openers (`/*`), and JSDoc continuation lines (` * ...`). It is a partial heuristic rather than a full `/*` -> `*/` state scanner -- sufficient for production rule use.

### 2.5 -- Production-source allow markers

Two production source files received single-line `gemma-check-allow` markers because they legitimately reference patterns the rules detect:

- [src/utils/secretPaths.ts](../../../../src/utils/secretPaths.ts) line 20: the `"**/.env*"` entry in `SECRET_PATH_PATTERNS` -- a denylist that detects env files, so it has to reference the literal.
- [src/storage/MemoryHealthCheck.ts](../../../../src/storage/MemoryHealthCheck.ts) line 19: the `SECRET_TOKEN_REGEX` that detects `.env.*` tokens -- same reason.

Both markers are scoped to a single rule id (`: no-env-file-leakage`) so the suppression cannot accidentally hide other findings on those lines.

---

## 3. Tests

### 3.1 New tests

**[tests/unit/cli/gemma-check.test.ts](../../../../tests/unit/cli/gemma-check.test.ts)** -- 60 cases organised into five layers:

1. **Helper unit tests** (15 cases): `isTestFile`, `isSecuritySensitiveFile`, `offsetToPosition`, `lineBounds`, `isInComment`, `isAllowed` (each with positive / negative / scoped / cross-marker disambiguation cases).
2. **Per-rule tests** (24 cases): each of the four rules exercised in isolation with positive matches, allowlist suppression, comment-context suppression, and at least one negative case.
3. **Registry sanity** (3 cases): non-empty `RULES`, all four shipped ids present, `RULE_BY_ID` indexed correctly.
4. **CLI helpers** (13 cases): `parseArgs` (every flag), `selectRules`, `walk` (yields scannable files only, single-file behaviour, missing-path behaviour, all documented extensions), `scanPath`.
5. **End-to-end spawn tests** (7 cases): drives `node bin/gemma-check.mjs` with each documented flag combination, asserts exit codes (0 / 1 / 2) and report shape (human and JSON).

**[tests/unit/scripts/package-skills.test.ts](../../../../tests/unit/scripts/package-skills.test.ts)** -- 14 cases:

1. **`parseSkill`** (5 cases): well-formed frontmatter, quote stripping, missing leading fence, missing trailing fence, comment lines inside frontmatter.
2. **`renderCursor`** (3 cases): replaces SKILL frontmatter with Cursor marker, preserves body verbatim, preserves original frontmatter as comments.
3. **`buildHarnessReadme`** (1 case): includes title, source pointer, full skill list.
4. **Harness adapter table** (4 cases): all four harnesses present, relative paths per harness, render functions identity for the three Anthropic-compatible harnesses, Cursor warn-flag.
5. **End-to-end spawn** (1 case): runs the real script against the real catalog, asserts the four output trees and READMEs exist.

### 3.2 Quality gates

- TypeScript: `npm run build` (tsc) clean.
- Lint: `npm run lint` (eslint src) clean.
- Tests: `npm test` reports **173 test files passed, 1 skipped (174); 2110 tests passed, 4 skipped (2114); 0 failures**. Up 74 from the Phase 5 baseline (2036 passing). The trailing Windows segfault during teardown is the pre-existing native-module cleanup artefact tracked at known-gaps Section 5.1.
- Coverage: `vitest run --coverage` reports **89.68% lines, 83.06% branches** on `src/**/*.ts`, well above the 80% / 75% CI thresholds.
- Catalog sync: `docs/index.md` regenerated after the `MemoryHealthCheck.ts` allow-marker added one line; the storage LOC tick is committed alongside the phase work.
- Self-check: `node bin/gemma-check.mjs src/` exits 0 (no findings).
- Skill packaging: `node scripts/package-skills.mjs` writes 13 skills across 4 harnesses (52 SKILL files + 4 README files) deterministically.

---

## 4. Deviations

1. **Cursor schema mapping deferred**. The Cursor adapter ships a best-effort transform (`.cursor/rules/<slug>.md` with placeholder `rule: SKILL` frontmatter) rather than a native `.cursor/rules/<slug>.mdc` because the schema gap (`description` / `globs` / `alwaysApply` vs SKILL's `name` / `description` / `argument-hint`) is too wide for a one-shot translation. The original SKILL frontmatter is preserved as inline comments so a future converter can recover it. Logged as in-cycle gap 10.O.7 (P2 / DF).
2. **Optional 5th `gemma-check` rule deferred**. `no-bare-promise-rejection` (regex `/\.catch\(\s*\)/`) is listed in the plan as optional. The 4 mandatory rules ship; the 5th is left for v0.8.0 or until a real incident motivates it. Logged as in-cycle gap 10.O.8 (P3 / NI).
3. **Two production allow markers**. `src/utils/secretPaths.ts` line 20 (`"**/.env*"` in the secret-path denylist) and `src/storage/MemoryHealthCheck.ts` line 19 (`SECRET_TOKEN_REGEX`) each received a one-line `gemma-check-allow` marker scoped to `no-env-file-leakage`. These are necessary because the rule's intent (detect `.env` references in production source) and the files' intent (detect `.env` references in scanned content) collide -- the files have to reference the literal patterns they are designed to find.
4. **Legacy script noise not addressed in scope**. `scripts/check-bench-regressions.mjs` (~6 `console.log` calls intentional in a CLI script) and `scripts/hooks/check-prompt-policy.mjs` + `scripts/hooks/lib/secret-paths.mjs` are flagged by `gemma-check` on direct scan. The Phase 6 plan scopes the acceptance gate to `src/` only, so these are out of scope. Cleanup is opportunistic. Logged as in-cycle gap 10.O.10 (P3 / WN).
5. **Pre-existing dependency-cruiser violations**. `npm run deps:check` reports 4 violations carried over from Phases 4 / 5 (3 `no-storage-from-panels` + 1 `no-panels-from-tools`). Verified via `git stash` baseline that the count is unchanged before vs. after Phase 6. Logged as in-cycle gap 10.O.9 (P3 / WN) and will be addressed in Phase 8.

---

## 5. Files changed

### New

- `scripts/package-skills.mjs` -- 197 lines, packaging script + adapter table + parseSkill + renderCursor + buildHarnessReadme.
- `bin/gemma-check.mjs` -- 218 lines, CLI bootstrap + parseArgs + walk + selectRules + scanPath + report functions.
- `lib/checks/index.mjs` -- 20 lines, rule registry (RULES + RULE_BY_ID).
- `lib/checks/helpers.mjs` -- 119 lines, isTestFile / isExampleFile / isSecuritySensitiveFile / offsetToPosition / lineBounds / finding / isInComment / isAllowed.
- `lib/checks/no-committed-console-log.mjs` -- 41 lines.
- `lib/checks/no-math-random-for-tokens.mjs` -- 41 lines.
- `lib/checks/no-env-file-leakage.mjs` -- 47 lines.
- `lib/checks/no-secret-patterns.mjs` -- 52 lines.
- `tests/unit/cli/gemma-check.test.ts` -- 60 test cases, ~360 lines.
- `tests/unit/scripts/package-skills.test.ts` -- 14 test cases, ~150 lines.

### Modified

- `package.json` -- added `bin.gemma-check` entry; added `package:skills` and `check` scripts.
- `.github/workflows/ci.yml` -- added `package-skills` and `gemma-check` jobs.
- `README.md` -- added "Use Gemma Code's skills in other agentic harnesses" and "`gemma-check` -- standalone deterministic checks CLI" sections.
- `docs/archive/versions/v0/v0.7.0/architecture.md` -- expanded sections 5 (Multi-harness skill packaging) and 6 (gemma-check CLI) with full per-rule and per-harness tables.
- `docs/index.md` -- storage LOC ticked from 6966 to 6967 after the MemoryHealthCheck.ts allow-marker.
- `src/utils/secretPaths.ts` -- one inline `// gemma-check-allow: no-env-file-leakage` marker on the `"**/.env*"` denylist line.
- `src/storage/MemoryHealthCheck.ts` -- one inline `// gemma-check-allow-next-line: no-env-file-leakage` marker before `SECRET_TOKEN_REGEX`.
- `docs/archive/versions/v0/v0.7.0/known-gaps.md` -- four new in-cycle gap rows (10.O.7 through 10.O.10) and recomputed Section 10.3 summary.

---

## 6. Next

**Phase 7 (HNSW vector index + background workers)** is optional / time-permitting per the cycle plan. If skipped, Phase 8 follows directly.

**Phase 8 (release gate + ADRs + CHANGELOG + v0.7.0 baselines)** is mandatory and closes the cycle. The Phase 8 ADR slate (ADR-0006 compress tool, ADR-0007 memory file architecture, ADR-0008 webview render protocol) needs cross-reference updates given the actual ADR landings (ADR-0013 for the render protocol, ADR-0014 for the memory file architecture).

Open carryovers expected to close in Phase 8:

- 10.O.4 (ADR-0014 numbering note in plan cross-references)
- 10.O.9 (deps-cruiser ratchet pass)
- 10.O.10 (legacy-script `gemma-check` noise -- opportunistic cleanup during Phase 8 polish)

Open items expected to defer to v0.8.0:

- 10.O.1, 10.O.2, 10.O.3 (Phase 4 panel-host wiring carryovers -- only land when the dogfood loop exercises them).
- 10.O.5 (MemoryPanel section-mapping heuristic -- revisit after user testing).
- 10.O.7 (native Cursor rule conversion -- pending real Cursor user feedback).
- 10.O.8 (`no-bare-promise-rejection` rule -- pending real incident motivation).
