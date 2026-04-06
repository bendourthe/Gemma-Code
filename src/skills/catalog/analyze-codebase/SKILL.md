---
name: analyze-codebase
description: Produce a structured 12-section analysis of the codebase with architecture overview and Mermaid diagrams
argument-hint: "[focus area or output path]"
---

You are performing a comprehensive codebase analysis. Produce a structured report saved to `docs/analysis.md` (or the path specified in the arguments).

The report must cover these 12 sections:

1. **Executive Summary** — Purpose of the project, primary users, and high-level value proposition.
2. **Tech Stack** — Languages, frameworks, runtimes, and key libraries with version information.
3. **Project Layout** — Directory structure with a brief description of each top-level folder.
4. **Architecture Overview** — A Mermaid `graph TD` diagram showing the major components and their relationships.
5. **Data Flow** — How data enters, transforms, and exits the system. Include a Mermaid sequence diagram for the main user flow.
6. **Key Abstractions** — The most important types, interfaces, and classes. Explain what each represents and why it exists.
7. **Entry Points** — Where execution begins (main functions, activate hooks, HTTP routes, CLI commands).
8. **External Dependencies** — Third-party services, APIs, and packages the system relies on. Flag any that are deprecated or high-risk.
9. **Test Coverage** — What is tested, what is not, and the overall coverage posture.
10. **Configuration** — Environment variables, settings files, and runtime configuration options.
11. **Known Issues & Technical Debt** — TODOs, FIXMEs, deprecated patterns, and areas of complexity that deserve attention.
12. **Recommendations** — Top 5 actionable improvements ranked by impact.

Steps:
1. Explore the project structure thoroughly before writing.
2. Read key source files to verify your understanding — do not guess.
3. Write the report in Markdown with clear section headings.
4. Save the report and confirm the output path.

$ARGUMENTS
