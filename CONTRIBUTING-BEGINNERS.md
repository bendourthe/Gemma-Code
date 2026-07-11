# Contributing to Nexus -- the beginner's path

Welcome. If you have never contributed to an open-source project before, or you do not yet have Node.js installed, you are in the right place. This guide takes you end-to-end on a fresh machine: install the tools, fork the repo, build the engine, find an issue, ship a pull request. Tone is procedural; every command is something you can copy verbatim.

> **Note on naming.** Nexus is the successor to Gemma Code, mid-pivot to a four-module desktop app (see [README.md](README.md) and [docs/versions/v1/v1.0.0/](docs/v1/v1.0)). Many code identifiers, settings keys, and scripts in this repository still use the legacy `gemma-code` naming and will be renamed in lockstep with the v1.0.0 plan. Commands you copy below match the current state of the repo.

The shorter, no-handholding version of this same workflow lives in [CONTRIBUTING.md](CONTRIBUTING.md). Once the first PR ships, that is the file to keep open.

This document is ASCII-only and assumes Windows 11, macOS, or Linux. Where the commands differ, the Windows variant is listed first.

## 1. Install the prerequisites

You need five things:

- **Node.js 20 or newer**. Download from <https://nodejs.org/>. Verify in a fresh terminal with `node --version`.
- **Git**. Windows: <https://git-scm.com/download/win>. macOS: `xcode-select --install`. Linux: your distro's package manager (`sudo apt install git` on Debian/Ubuntu).
- **GitHub CLI (`gh`)**. <https://cli.github.com/>. Run `gh auth login` once after installing.
- **VS Code**. <https://code.visualstudio.com/>. This is the editor that hosts the extension while you develop it.
- **Ollama** (or LM Studio). <https://ollama.com/download>. The extension talks to a local LLM server; nothing leaves your machine.

After Ollama is installed, pull the model the extension expects and start the server:

```
ollama serve
ollama pull gemma4:e4b
```

The server listens on `http://localhost:11434`. Leave it running in its own terminal.

## 2. Fork and clone

Forking puts your own copy of the repo under your GitHub account. Cloning downloads it.

```
gh repo fork bendourthe/Gemma-Code --clone
cd Gemma-Code
```

Your local clone now has two remotes: `origin` (your fork) and `upstream` (the canonical repo). Verify with `git remote -v`.

## 3. Install dependencies and build

```
npm install
npm run build
```

`npm install` reads `package.json` and pulls every dependency into `node_modules/`. `npm run build` runs the TypeScript compiler (`tsc`). The first build can take a minute; subsequent builds are seconds.

If `npm install` fails on Windows complaining about long paths, run `git config --system core.longpaths true` once and retry.

## 4. Launch the Extension Development Host

Open the repo in VS Code:

```
code .
```

Press `F5`. A second VS Code window opens labeled `[Extension Development Host]`. That window is running your local build of Gemma Code; the original window is the editor where you edit the source. Changes you make in the source window take effect in the host window after you re-launch.

The first command palette to try in the host window: `Gemma Code: Open Panel`.

## 5. Find an issue

Two starting points:

- `gh issue list --label "good first issue" --state open`
- The cycle's living TODO list at [docs/todos.md](docs/todos.md). Items there are smaller and already framed.

Pick one. If you are unsure, comment on the issue asking "I would like to take this, is it free?". Wait for a maintainer to assign it before sinking deep time.

## 6. Branch and make a change

Branch names follow the convention `<type>/<short-slug>` where `<type>` is one of `feat`, `fix`, `refactor`, `chore`, `docs`, `test`. The slug is lowercase kebab.

```
git fetch origin main
git checkout -b feat/my-first-change origin/main
```

Now edit the code. The project uses strict TypeScript: do not use `any`, do not call `console.log` inside `src/` (use [src/utils/logger.ts](src/utils/logger.ts) instead). Keep new files under 500 lines.

## 7. Run the local checks

Before you push, run the same gates CI runs:

```
npm run lint
npm test
npm run check
```

- `npm run lint` -- ESLint over `src/`.
- `npm test` -- Vitest unit + integration suites.
- `npm run check` -- gemma-check, the project's own ASCII / prompt-budget / catalog linter.

If any of them fail, fix the issue locally before pushing. Do not skip hooks with `--no-verify`.

## 8. Commit and push

Commit messages follow Conventional Commits. The subject line is under 70 characters and starts with the type and an optional scope:

```
git add path/to/changed/file.ts
git commit -m "feat(panel): add Recent searches section to memory view"
git push -u origin HEAD
```

Push only to your fork (`origin`), never directly to `main` on the canonical repo.

## 9. Open a pull request

```
gh pr create --base main --head <your-username>:feat/my-first-change --fill
```

`--fill` pre-populates the title and body from your commit. Edit the description to summarize the change in three or four sentences. If a PR template is offered, fill in every checkbox or replace it with `N/A: <reason>`.

## 10. What happens after you open the PR

- GitHub Actions runs the same gates you ran locally, plus the installer smoke test and golden-task suite. Watch the checks tab on the PR; if any go red, click through to read the log and push a fix.
- A maintainer (or a bot review) will leave comments. Address each comment by editing the code and pushing the fix to the same branch. The `pr-manager` subagent under `.claude/agents/pr-manager.md` automates this if you use Claude Code.
- Once checks are green and the maintainer approves, your PR is merged. Congratulations.

## 11. Troubleshooting

- **`npm install` errors about Python or `node-gyp`** -- some transitive dependencies need a C++ toolchain. Windows: install <https://visualstudio.microsoft.com/visual-cpp-build-tools/> and reboot. macOS: `xcode-select --install`. Linux: `sudo apt install build-essential`.
- **`Ollama not reachable`** -- the panel cannot find `http://localhost:11434`. Check `ollama serve` is running in another terminal; check no firewall is blocking the port; verify with `curl http://localhost:11434/api/tags`.
- **`Model not found: gemma4:e4b`** -- run `ollama pull gemma4:e4b` and wait for the download to finish.
- **`Port 11434 in use`** -- something else is bound to that port. Kill it (`taskkill /F /IM ollama.exe` on Windows; `pkill ollama` elsewhere) or set `OLLAMA_HOST=127.0.0.1:11435` and update the extension setting accordingly.
- **VS Code does not pick up the new build** -- close the Extension Development Host, re-run `npm run build`, press `F5` again.
- **My push was rejected** -- you are probably trying to push to the canonical repo instead of your fork. Run `git remote -v` and confirm `origin` points at your fork. If you pushed to `upstream` by accident, see [CONTRIBUTING.md](CONTRIBUTING.md) for recovery steps.

If you are stuck for more than fifteen minutes on any step, open an issue or ask in the existing issue thread. There is no penalty for asking; there is a real penalty for fighting an environment problem in silence.

Welcome aboard.
