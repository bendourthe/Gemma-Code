/**
 * v0.7.0 Phase 4.4 -- Structured todo-block render primitive (C24).
 *
 * Renders the latest payload of `update_todos` as a checkbox list. Each
 * todo's status drives the leading glyph (filled = completed, hollow =
 * pending, asterisk = in_progress). When in_progress, the active-form
 * (present-continuous) text is shown so the user sees what is happening
 * right now; otherwise the imperative `content` is rendered.
 *
 * Safety: every dynamic string flows through `textContent`; no innerHTML.
 */

export const TODO_BLOCK_FN_SOURCE = String.raw`
function renderTodoBlock(todos) {
  var block = document.createElement('section');
  block.className = 'todo-block';
  block.setAttribute('aria-label', 'Update Todos');

  var heading = document.createElement('div');
  heading.className = 'todo-block-heading';
  heading.textContent = 'Update Todos';
  block.appendChild(heading);

  var list = document.createElement('ul');
  list.className = 'todo-block-list';

  for (var i = 0; i < todos.length; i += 1) {
    var t = todos[i];
    var li = document.createElement('li');
    li.className = 'todo-item todo-status-' + t.status;

    var glyph = document.createElement('span');
    glyph.className = 'todo-glyph';
    glyph.setAttribute('aria-hidden', 'true');
    if (t.status === 'completed') {
      glyph.textContent = '■';
    } else if (t.status === 'in_progress') {
      glyph.textContent = '★';
      li.classList.add('todo-glow');
    } else {
      glyph.textContent = '□';
    }
    li.appendChild(glyph);

    var text = document.createElement('span');
    text.className = 'todo-text';
    text.textContent = t.status === 'in_progress' ? t.activeForm : t.content;
    li.appendChild(text);

    list.appendChild(li);
  }

  block.appendChild(list);
  return block;
}
`;

export interface TodoEntryShape {
  content: string;
  activeForm: string;
  status: "pending" | "in_progress" | "completed";
}

export function compileTodoBlock(
  documentRef: Document,
): (todos: TodoEntryShape[]) => HTMLElement {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  const factory = new Function(
    "document",
    `${TODO_BLOCK_FN_SOURCE}\nreturn renderTodoBlock;`,
  );
  return factory(documentRef) as (todos: TodoEntryShape[]) => HTMLElement;
}
