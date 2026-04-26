// Commitlint configuration. Conventional Commits is enforced via the
// commitlint workflow on PR push and via the husky commit-msg hook
// locally. Type allowlist mirrors the repo's existing commit history
// (`feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `ci`, `build`,
// `perf`, `revert`, `style`).
module.exports = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [
      2,
      "always",
      [
        "feat",
        "fix",
        "chore",
        "docs",
        "refactor",
        "test",
        "ci",
        "build",
        "perf",
        "revert",
        "style",
      ],
    ],
    "subject-case": [0],
    "header-max-length": [2, "always", 100],
    "body-max-line-length": [0],
    "footer-max-line-length": [0],
  },
};
