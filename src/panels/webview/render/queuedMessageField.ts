/**
 * v0.7.0 Phase 4.6 -- Queued-message-field render primitive (C26).
 *
 * Replaces the standard input area while a stream is active. Shows a
 * `Queue another message...` field plus a `+` attach button and a stop
 * button (replaces the send arrow). Queued messages buffer client-side and
 * dispatch as the next user turn once the active stream completes; if the
 * user clicks stop, the queued buffer is dropped.
 *
 * Safety: every dynamic string flows through `textContent`; no innerHTML.
 */

export const QUEUED_MESSAGE_FIELD_FN_SOURCE = String.raw`
function renderQueuedMessageField(handlers) {
  var wrap = document.createElement('div');
  wrap.className = 'queued-message-field';
  wrap.setAttribute('aria-label', 'Queue another message');

  var attach = document.createElement('button');
  attach.type = 'button';
  attach.className = 'queued-attach-btn';
  attach.setAttribute('aria-label', 'Attach to next message');
  attach.title = 'Attach';
  attach.textContent = '+';
  wrap.appendChild(attach);

  var input = document.createElement('textarea');
  input.className = 'queued-input';
  input.rows = 1;
  input.placeholder = 'Queue another message...';
  input.setAttribute('aria-label', 'Queued message input');
  wrap.appendChild(input);

  var stop = document.createElement('button');
  stop.type = 'button';
  stop.className = 'queued-stop-btn';
  stop.setAttribute('aria-label', 'Stop streaming and drop the queued buffer');
  stop.title = 'Stop';
  stop.textContent = '■';
  wrap.appendChild(stop);

  attach.addEventListener('click', function () {
    if (handlers && typeof handlers.onAttach === 'function') handlers.onAttach();
  });

  stop.addEventListener('click', function () {
    if (handlers && typeof handlers.onStop === 'function') handlers.onStop();
  });

  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      var text = input.value.trim();
      if (text && handlers && typeof handlers.onQueue === 'function') {
        handlers.onQueue(text);
        input.value = '';
      }
    }
  });

  return wrap;
}
`;

export interface QueuedFieldHandlers {
  onAttach: () => void;
  onStop: () => void;
  onQueue: (text: string) => void;
}

export function compileQueuedMessageField(
  documentRef: Document,
): (handlers: QueuedFieldHandlers) => HTMLElement {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  const factory = new Function(
    "document",
    `${QUEUED_MESSAGE_FIELD_FN_SOURCE}\nreturn renderQueuedMessageField;`,
  );
  return factory(documentRef) as (handlers: QueuedFieldHandlers) => HTMLElement;
}
