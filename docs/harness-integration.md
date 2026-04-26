# Optional Developer Harness Integration

Gemma Code ships three agent-agnostic harness scripts under `scripts/hooks/` that any AI coding agent (or any developer's local pre-commit toolchain) can wire into its lifecycle. The repository deliberately does not commit any agent-specific configuration (no `.claude/settings.local.json`, no `.cursor/`, no `.idea/agent.xml`). Each developer chooses which agent's harness to wire the scripts into and how.

This document records example wirings. The scripts themselves are the contract; the wirings are illustrative.

## What the scripts do

Each script reads a JSON event payload from stdin, exits 0 to allow, exits 2 with `BLOCKED: <reason>` on stderr to deny. They are pure Node ESM with zero npm dependencies, so they work on any machine that has Node 18+.

| Script | When to wire it | What it blocks |
| --- | --- | --- |
| `scripts/hooks/check-tool-permission.mjs` | Before every Bash / Write / Edit tool call | Reads/writes that target the secret-path denylist (`.env*`, `id_rsa*`, `**/secrets/**`, etc.) or paths outside the workspace root |
| `scripts/hooks/check-git-control-plane.mjs` | At session start | Sessions that begin on the `main` or `master` branch, or with more than `GEMMA_HOOK_DIRTY_LIMIT` (default 50) modified-or-untracked files |
| `scripts/hooks/check-prompt-policy.mjs` | When the user submits a prompt | Prompts containing common secret patterns (AWS keys, GitHub PATs, JWTs, SSH headers, Slack webhooks, etc.) |

Latency budget: all three scripts target less than 50 ms p99 on benign payloads. The benchmark suite (`tests/benchmarks/hooks.bench.ts`) enforces this.

## Configuration

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `GEMMA_HOOK_WORKSPACE_ROOT` | `process.cwd()` | Absolute path treated as the workspace root by the path guards |
| `GEMMA_HOOK_DIRTY_LIMIT` | `50` | Maximum modified-or-untracked file count before the git hook blocks |

Workspace-local override file:

- `<workspace>/.gemma-code/prompt-policy.json` (additive only, see schema below)

```json
{
  "extraPatterns": [
    { "name": "internal-token", "regex": "INT-[A-Z0-9]{20}" }
  ],
  "allowlist": ["AKIAIOSFODNN7EXAMPLE"]
}
```

Built-in patterns cannot be disabled. Patterns containing nested quantifiers (a common ReDoS shape) are rejected at load time.

## Example wirings

### Claude Code (`.claude/settings.local.json`)

Personal config; do not commit.

```json
{
  "permissions": { "allow": [], "deny": [] },
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash|Write|Edit", "hooks": [{ "type": "command", "command": "node scripts/hooks/check-tool-permission.mjs" }] }
    ],
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "node scripts/hooks/check-git-control-plane.mjs" }] }
    ],
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "node scripts/hooks/check-prompt-policy.mjs" }] }
    ]
  }
}
```

### Cursor

Cursor lacks a first-class generic hook system at the time of writing, but you can wire `check-tool-permission.mjs` into a husky pre-commit hook to catch the same accidents that Cursor's apply-edit flow would let through.

### husky pre-commit (any agent)

```bash
# .husky/pre-commit
#!/usr/bin/env bash
set -euo pipefail

# Block staged files that match the secret-path denylist.
for f in $(git diff --cached --name-only); do
  echo '{"tool_name":"Write","tool_input":{"file_path":"'"$f"'"}}' \
    | node scripts/hooks/check-tool-permission.mjs || exit 1
done
```

### Generic shell pipeline

Any agent that can pipe a JSON payload to a child process can use these scripts:

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"cat .env"}}' \
  | node scripts/hooks/check-tool-permission.mjs
echo "exit code: $?"   # 2
```

## Why these scripts are not wired into the repository

Gemma Code is an agent-agnostic project. Bundling a `.claude/settings.local.json` would imply Claude Code is the supported agent, which it is not — Cursor, Copilot, Continue, Aider, plain shell, and Gemma Code itself are equally first-class consumers. Each developer decides which agent they use locally and configures its harness accordingly. The repository's commitment is to ship the *scripts* and document the wirings.

For the same reason, the `.claude/`, `.vscode/`, `.idea/`, `.cursor/`, and similar agent-specific config directories are excluded from version control and are personal to each developer's local environment.
