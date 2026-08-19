/**
 * Already-applied edit detection (v1.19.1 Phase 2.3). vscode-free so the
 * extension EditFileTool and the headless edit_file twin share one heuristic.
 *
 * - `apply`: old_string occurs once and differs from new_string.
 * - `noop`: the edit is already in the file (identity replace, or old missing
 *   but new_string already present).
 * - `missing`: old_string is absent and new_string is not a plausible applied
 *   result.
 * - `ambiguous`: old_string occurs more than once.
 */

export type EditApplyKind = "apply" | "noop" | "missing" | "ambiguous";

export function classifyEditApply(
  original: string,
  oldString: string,
  newString: string,
): EditApplyKind {
  const occurrences = original.split(oldString).length - 1;
  if (occurrences > 1) return "ambiguous";
  if (occurrences === 1) {
    return oldString === newString ? "noop" : "apply";
  }
  if (newString.length > 0 && oldString !== newString && original.includes(newString)) {
    return "noop";
  }
  return "missing";
}

export function noopEditMessage(path: string): string {
  return (
    `No-op: the requested edit is already present in path "${path}". ` +
    `No changes made.`
  );
}
