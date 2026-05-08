/**
 * v0.7.0 Phase 4.7 -- End-of-task completion-report block (C27).
 *
 * Renders a compact key:value summary at the end of a multi-step task. The
 * report is built host-side by `buildCompletionReport(state)` (defined
 * below) by scanning the latest `update_todos` payload plus recent tool
 * calls; the renderer is purely presentational.
 *
 * Empty-state suppression: a report with no items is treated as no-op by
 * the runtime (the renderer returns an empty fragment-equivalent element
 * with class `completion-report-empty` so callers can detect and skip).
 *
 * Safety: every dynamic string flows through `textContent`; no innerHTML.
 */

export const COMPLETION_REPORT_FN_SOURCE = String.raw`
function renderCompletionReport(items) {
  if (!items || items.length === 0) {
    var empty = document.createElement('div');
    empty.className = 'completion-report-empty';
    return empty;
  }

  var card = document.createElement('section');
  card.className = 'completion-report';
  card.setAttribute('aria-label', 'Task completion report');

  var heading = document.createElement('div');
  heading.className = 'completion-report-heading';
  heading.textContent = 'Completion report';
  card.appendChild(heading);

  var table = document.createElement('table');
  table.className = 'completion-report-table';

  for (var i = 0; i < items.length; i += 1) {
    var item = items[i];
    var row = document.createElement('tr');
    row.className = 'completion-report-row';

    var fieldEl = document.createElement('td');
    fieldEl.className = 'completion-report-field';
    fieldEl.textContent = item.field;
    row.appendChild(fieldEl);

    var valueEl = document.createElement('td');
    valueEl.className = 'completion-report-value';
    if (item.href) {
      var link = document.createElement('a');
      link.className = 'completion-report-link';
      link.textContent = item.value;
      link.href = item.href;
      link.dataset.href = item.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      valueEl.appendChild(link);
    } else {
      valueEl.textContent = item.value;
    }
    row.appendChild(valueEl);

    table.appendChild(row);
  }

  card.appendChild(table);
  return card;
}
`;

export interface CompletionReportItem {
  field: string;
  value: string;
  href?: string;
}

export interface CompletionReportState {
  todos: ReadonlyArray<{
    content: string;
    activeForm: string;
    status: "pending" | "in_progress" | "completed";
  }>;
  /** File paths edited / created during the task. */
  editedFiles: readonly string[];
  /** Test commands executed during the task (e.g. "vitest run"). */
  testsRun: readonly string[];
  /** Optional commit SHA + message if the task ended in a commit. */
  commit?: { sha: string; message: string; href?: string };
}

/**
 * Host-side helper: scans the captured task state and emits the canonical
 * field list (Plan / Sub-task / Updates / Tests / Pre-flight / Commit).
 * Empty fields are dropped.
 */
export function buildCompletionReport(
  state: CompletionReportState,
): CompletionReportItem[] {
  const items: CompletionReportItem[] = [];

  if (state.todos.length > 0) {
    const completed = state.todos.filter((t) => t.status === "completed").length;
    const total = state.todos.length;
    items.push({
      field: "Plan",
      value: `${completed}/${total} todos complete`,
    });

    const lastDone = [...state.todos].reverse().find((t) => t.status === "completed");
    if (lastDone) {
      items.push({ field: "Sub-task done", value: lastDone.content });
    }
  }

  if (state.editedFiles.length > 0) {
    const max = 3;
    const head = state.editedFiles.slice(0, max).join(", ");
    const more = state.editedFiles.length > max
      ? ` (+${state.editedFiles.length - max} more)`
      : "";
    items.push({ field: "Updates landed", value: head + more });
  }

  if (state.testsRun.length > 0) {
    items.push({ field: "Tests run", value: state.testsRun.join("; ") });
  }

  if (state.commit) {
    items.push({
      field: "Commit",
      value: `${state.commit.sha.slice(0, 7)} ${state.commit.message}`,
      href: state.commit.href,
    });
  }

  return items;
}

export function compileCompletionReport(
  documentRef: Document,
): (items: readonly CompletionReportItem[]) => HTMLElement {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  const factory = new Function(
    "document",
    `${COMPLETION_REPORT_FN_SOURCE}\nreturn renderCompletionReport;`,
  );
  return factory(documentRef) as (
    items: readonly CompletionReportItem[],
  ) => HTMLElement;
}
