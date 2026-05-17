// v0.9.0 Phase 5 sub-task 5.3 -- agent-batch overlap sub-command.
//
// Three classes of problem checked:
//
//   1. Duplicate issues: the same issue number appears in more than one task.
//   2. Missing dependencies: a `dependsOn` entry references an issue that
//      is not the subject of any task in this batch.
//   3. Dependency cycles: detected via depth-first traversal with a
//      visited-on-stack marker.
//
// All three are surfaced as a single object so the CLI sub-command can
// render a stable report.

export function detectDuplicateIssues(spec) {
  const seen = new Map();
  const dups = [];
  for (const t of spec.tasks) {
    const count = (seen.get(t.issue) ?? 0) + 1;
    seen.set(t.issue, count);
  }
  for (const [issue, count] of seen) {
    if (count > 1) dups.push({ issue, count });
  }
  return dups;
}

export function detectMissingDeps(spec) {
  const issues = new Set(spec.tasks.map((t) => t.issue));
  const missing = [];
  for (const t of spec.tasks) {
    for (const dep of t.dependsOn ?? []) {
      if (!issues.has(dep)) {
        missing.push({ issue: t.issue, missingDep: dep });
      }
    }
  }
  return missing;
}

export function detectCycles(spec) {
  const graph = new Map();
  for (const t of spec.tasks) {
    graph.set(t.issue, Array.isArray(t.dependsOn) ? [...t.dependsOn] : []);
  }
  const visited = new Set();
  const onStack = new Set();
  const cycles = [];

  function dfs(node, path) {
    if (onStack.has(node)) {
      const startIdx = path.indexOf(node);
      const cycle = startIdx >= 0 ? path.slice(startIdx) : [...path];
      cycles.push([...cycle, node]);
      return;
    }
    if (visited.has(node)) return;
    visited.add(node);
    onStack.add(node);
    path.push(node);
    for (const next of graph.get(node) ?? []) {
      if (!graph.has(next)) continue;
      dfs(next, path);
    }
    path.pop();
    onStack.delete(node);
  }

  for (const node of graph.keys()) {
    if (!visited.has(node)) {
      dfs(node, []);
    }
  }
  // Dedupe by canonical form (sorted-issue tuple).
  const seen = new Set();
  const out = [];
  for (const cyc of cycles) {
    const key = [...cyc].sort((a, b) => a - b).join("-");
    if (!seen.has(key)) {
      seen.add(key);
      out.push(cyc);
    }
  }
  return out;
}

export function analyzeOverlap(spec) {
  return {
    duplicates: detectDuplicateIssues(spec),
    missingDependencies: detectMissingDeps(spec),
    cycles: detectCycles(spec),
  };
}

export function formatOverlapReport(report) {
  const lines = [];
  if (report.duplicates.length > 0) {
    lines.push("Duplicate issues:");
    for (const d of report.duplicates) {
      lines.push(`  - #${d.issue} appears ${d.count} times`);
    }
  }
  if (report.missingDependencies.length > 0) {
    lines.push("Missing dependencies:");
    for (const m of report.missingDependencies) {
      lines.push(`  - task #${m.issue} depends on #${m.missingDep} which is not in this batch`);
    }
  }
  if (report.cycles.length > 0) {
    lines.push("Dependency cycles:");
    for (const c of report.cycles) {
      lines.push(`  - ${c.map((n) => `#${n}`).join(" -> ")}`);
    }
  }
  if (lines.length === 0) return "no overlap, missing deps, or cycles detected.\n";
  return lines.join("\n") + "\n";
}

export async function overlapCommand(rest) {
  if (rest.length === 0) {
    process.stderr.write("[agent-batch overlap] expected a spec file path\n");
    return 2;
  }
  const { loadSpecFile } = await import("./validate.mjs");
  const { safeParseSpec } = await import("./schema.mjs");

  let raw;
  try {
    raw = loadSpecFile(rest[0]);
  } catch (e) {
    process.stderr.write(`[agent-batch overlap] ${e.message}\n`);
    return 2;
  }
  const parsed = safeParseSpec(raw);
  if (!parsed.success) {
    process.stderr.write(
      "[agent-batch overlap] spec failed schema validation; run `validate` for details\n",
    );
    return 1;
  }
  const spec = parsed.data;
  const report = analyzeOverlap(spec);
  process.stdout.write(formatOverlapReport(report));
  const hasProblem =
    report.duplicates.length > 0 ||
    report.missingDependencies.length > 0 ||
    report.cycles.length > 0;
  return hasProblem ? 1 : 0;
}
