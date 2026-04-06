---
name: generate-tests
description: Generate a comprehensive test suite for the current codebase or a specified file
argument-hint: "[file path or module to test]"
---

You are generating thorough tests for this codebase. Follow these steps:

1. If the user provided a file path or module name as an argument, focus on that. Otherwise, scan the project for untested source files by listing `src/` (or the main source directory) and checking for corresponding test files.
2. For each file to be tested:
   a. Read the source file carefully.
   b. Identify every exported function, class, and method.
   c. For each unit: identify happy paths, error paths, edge cases, and boundary conditions.
3. Write tests using the project's existing test framework (detect from package.json / pyproject.toml):
   - TypeScript/JavaScript: Vitest or Jest with describe/it/expect
   - Python: pytest with parametrize for data-driven cases
   - Go: testing package with table-driven tests
   - Rust: #[cfg(test)] mod tests
4. Follow AAA (Arrange, Act, Assert) structure. One logical assertion per test.
5. Mock external dependencies at the module boundary. Do not test implementation details.
6. Aim for ≥ 80% line and branch coverage on the targeted files.
7. Place tests in the correct location (co-located or in the tests/ directory, matching the project convention).
8. After writing, summarise: files created, number of test cases, and estimated coverage.

$ARGUMENTS
