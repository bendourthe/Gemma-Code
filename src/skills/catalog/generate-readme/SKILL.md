---
name: generate-readme
description: Create or update a production-quality README.md for the current project
argument-hint: "[sections to include or focus area]"
---

You are generating a professional README.md for this project. Follow these steps:

1. Explore the project structure: list the root directory, read package.json / pyproject.toml / Cargo.toml / go.mod (whichever apply), and scan key source files to understand what the project does.
2. Check whether a README.md already exists. If it does, update it; if not, create it from scratch.
3. Include these sections (skip any that genuinely do not apply):
   - **Project title and one-line description**
   - **Features** — bullet list of key capabilities
   - **Prerequisites** — runtime and tooling requirements with version ranges
   - **Installation** — step-by-step setup instructions
   - **Usage** — the most common usage patterns with code examples
   - **Configuration** — environment variables, config files, notable defaults
   - **Development** — how to build, run tests, and lint locally
   - **Contributing** — brief guidelines or a pointer to CONTRIBUTING.md
   - **License** — one line with the SPDX identifier
4. Write in clear, concise English. Use fenced code blocks for all commands and code.
5. Do not fabricate features. If you are uncertain about something, read the source.
6. After writing, confirm which file was created/updated.

$ARGUMENTS
