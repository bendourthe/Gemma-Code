---
name: generate-changelog
description: Generate or update CHANGELOG.md from the git history following Keep a Changelog format
argument-hint: "[version or date range]"
---

You are generating a CHANGELOG.md for this project following the Keep a Changelog format (https://keepachangelog.com).

Steps:
1. Run `git log --oneline --no-merges` to get the full commit history.
2. If a CHANGELOG.md already exists, read it to find the most recent documented version/date so you only add new entries.
3. Group commits by version tag (`git tag --sort=-version:refname`) or by date if no tags exist.
4. For each version/group, categorise commits into:
   - **Added** — new features
   - **Changed** — changes to existing behaviour
   - **Deprecated** — features that will be removed in a future release
   - **Removed** — features removed in this release
   - **Fixed** — bug fixes
   - **Security** — security patches
5. Write entries as user-facing descriptions, not raw commit messages. Translate technical diffs into plain-language change notes.
6. Format:
   ```
   ## [Unreleased]

   ## [1.2.0] - 2025-06-01
   ### Added
   - Description of new feature
   ```
7. Write the output to CHANGELOG.md and confirm the file path.

$ARGUMENTS
