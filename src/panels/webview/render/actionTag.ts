/**
 * v0.7.0 Phase 4.2 -- Action-type tag render primitive (C22).
 *
 * Replaces the legacy "Using tool: <name>..." line with a Claude-Code-style
 * label + target + size badge. Display labels are mapped from the canonical
 * tool name; unknown tools fall back to PascalCase.
 *
 * Safety: every dynamic string flows through `textContent`; the renderer
 * never assigns to `innerHTML` (DOMPurify requirement satisfied trivially).
 */

const ACTION_TAG_LABEL_TABLE = {
  read_file: "Read",
  write_file: "Write",
  edit_file: "Edit",
  create_file: "Write",
  delete_file: "Delete",
  list_directory: "Ls",
  grep_codebase: "Grep",
  run_terminal: "Bash",
  web_search: "Search",
  fetch_page: "Fetch",
  tail_output: "Tail",
  grep_output: "GrepOutput",
  compress_range: "Compress",
  compress_message: "Compress",
  update_todos: "Todos",
} as const;

function pascalCase(name: string): string {
  return name
    .split(/[_-]/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join("");
}

/** Public for tests; the runtime keeps an inlined copy with the same mapping. */
export function actionLabelFor(toolName: string): string {
  return (ACTION_TAG_LABEL_TABLE as Record<string, string>)[toolName] ?? pascalCase(toolName);
}

/** Public for tests; the runtime keeps an inlined copy with the same logic. */
export function actionTargetFor(toolName: string, params: Record<string, unknown>): string {
  if (toolName === "grep_codebase" || toolName === "grep_output") {
    return String(params["pattern"] ?? "");
  }
  if (toolName === "run_terminal") {
    return String(params["command"] ?? "");
  }
  if (toolName === "web_search") {
    return String(params["query"] ?? "");
  }
  if (toolName === "fetch_page") {
    return String(params["url"] ?? "");
  }
  return String(params["path"] ?? "");
}

const TABLE_AS_JS = JSON.stringify(ACTION_TAG_LABEL_TABLE);

export const ACTION_TAG_FN_SOURCE = String.raw`
var ACTION_TAG_LABEL_TABLE = ${TABLE_AS_JS};

function __actionPascal(name) {
  var parts = name.split(/[_-]/);
  var out = '';
  for (var i = 0; i < parts.length; i += 1) {
    var p = parts[i];
    if (!p) continue;
    out += p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
  }
  return out;
}

function actionLabelFor(toolName) {
  return Object.prototype.hasOwnProperty.call(ACTION_TAG_LABEL_TABLE, toolName)
    ? ACTION_TAG_LABEL_TABLE[toolName]
    : __actionPascal(toolName);
}

function actionTargetFor(toolName, params) {
  if (toolName === 'grep_codebase' || toolName === 'grep_output') return String(params.pattern || '');
  if (toolName === 'run_terminal') return String(params.command || '');
  if (toolName === 'web_search')   return String(params.query || '');
  if (toolName === 'fetch_page')   return String(params.url || '');
  return String(params.path || '');
}

function renderActionTag(toolName, params, status, badge) {
  var el = document.createElement('div');
  el.className = 'action-tag action-status-' + status;

  var labelEl = document.createElement('span');
  labelEl.className = 'action-label';
  labelEl.textContent = actionLabelFor(toolName);
  el.appendChild(labelEl);

  var targetEl = document.createElement('span');
  targetEl.className = 'action-target';
  targetEl.textContent = actionTargetFor(toolName, params || {});
  el.appendChild(targetEl);

  if (badge) {
    var badgeEl = document.createElement('span');
    badgeEl.className = 'action-badge';
    badgeEl.textContent = badge;
    el.appendChild(badgeEl);
  }

  return el;
}
`;

/** Compile the runtime renderer against a host `document` (jsdom in tests). */
export function compileActionTag(
  documentRef: Document,
): (
  toolName: string,
  params: Record<string, unknown>,
  status: "started" | "completed" | "failed",
  badge?: string,
) => HTMLElement {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  const factory = new Function(
    "document",
    `${ACTION_TAG_FN_SOURCE}\nreturn renderActionTag;`,
  );
  return factory(documentRef) as (
    toolName: string,
    params: Record<string, unknown>,
    status: "started" | "completed" | "failed",
    badge?: string,
  ) => HTMLElement;
}
