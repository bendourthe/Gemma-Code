/**
 * Heuristic classifier that decides whether a user request is complex enough
 * to warrant DAG-based orchestration vs. the simple ReAct loop. Extracted from
 * `Orchestrator.shouldUseOrchestrator` so the rules can be unit-tested and
 * swapped via dependency injection.
 */

export interface ComplexityResult {
  readonly complex: boolean;
  /** Short, human-readable explanation of which rule fired. */
  readonly reason: string;
}

const ORCHESTRATOR_TRIGGERS: readonly string[] = [
  "implement",
  "refactor",
  "build",
  "create a feature",
  "fix all",
  "update across",
  "redesign",
  "migrate",
  "convert all",
  "rewrite",
  "restructure",
  "overhaul",
];

const SIMPLE_PREFIXES: readonly string[] = [
  "what is",
  "what are",
  "explain",
  "read file",
  "show me",
  "help",
  "list",
  "describe",
  "how does",
  "where is",
];

const COMPLEXITY_LENGTH_THRESHOLD = 200;

export interface ComplexityClassifier {
  classify(text: string): ComplexityResult;
}

export class HeuristicComplexityClassifier implements ComplexityClassifier {
  classify(text: string): ComplexityResult {
    const lower = text.toLowerCase().trim();

    for (const prefix of SIMPLE_PREFIXES) {
      if (lower.startsWith(prefix)) {
        return { complex: false, reason: `simple-prefix:${prefix}` };
      }
    }

    for (const trigger of ORCHESTRATOR_TRIGGERS) {
      if (lower.includes(trigger)) {
        return { complex: true, reason: `trigger:${trigger}` };
      }
    }

    if (text.length > COMPLEXITY_LENGTH_THRESHOLD) {
      return {
        complex: true,
        reason: `length:${text.length}>${COMPLEXITY_LENGTH_THRESHOLD}`,
      };
    }

    return { complex: false, reason: "default" };
  }
}

export const defaultComplexityClassifier: ComplexityClassifier =
  new HeuristicComplexityClassifier();
