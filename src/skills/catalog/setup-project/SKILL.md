---
name: setup-project
description: Bootstrap a new project with standard structure, configuration files, and documentation
argument-hint: "[project type: ts | python | go | rust]"
---

You are bootstrapping a new project. Follow these steps:

1. Determine the project type from the argument (ts, python, go, rust) or infer it from existing files.
2. Create the standard directory structure:
   - `src/` — application source code
   - `tests/` — test suites (unit/, integration/, e2e/)
   - `docs/` — documentation
   - `configs/` — linter, formatter, and tool configuration
   - `scripts/` — build and utility scripts
   - `assets/` — static assets (if applicable)
3. Generate the following files if they do not already exist:
   - `.gitignore` — language-appropriate ignore patterns
   - `README.md` — project overview with placeholder sections
   - `CHANGELOG.md` — empty Keep a Changelog skeleton
   - Language-specific config: `tsconfig.json` / `pyproject.toml` / `go.mod` / `Cargo.toml`
   - Linter config: `.eslintrc` / `ruff.toml` / `.golangci.yml` / `.clippy.toml`
   - A `CLAUDE.md` at the project root with the tech stack, key commands, and conventions pre-filled.
4. If a package manifest already exists (package.json, etc.), add standard scripts: build, test, lint, format.
5. Create a `src/.gitkeep` and `tests/.gitkeep` if directories are empty.
6. After setup, list all created files and suggest next steps.

$ARGUMENTS
