/**
 * v0.7.0 Phase 4.3 -- Numbered permission prompt render primitive (C23).
 *
 * Renders the four-option Claude-Code-style permission prompt as a
 * non-modal inline element with keyboard shortcuts. The legacy Yes/No
 * aliases (y/n + Enter/Esc) remain valid to preserve muscle memory; the
 * "yes-for-all" semantic now means "for this workspace" (persists in
 * .vscode/settings.json under gemma-code.permissionOverrides), per the
 * v0.6.0 Phase 1.2 floor that clamps tier-2 overrides to >= 1.
 *
 * Safety: every dynamic string flows through `textContent`; no innerHTML.
 */

export const PERMISSION_PROMPT_FN_SOURCE = String.raw`
function renderPermissionPrompt(payload, onResolve) {
  var card = document.createElement('div');
  card.className = 'permission-prompt';
  card.dataset.promptId = payload.id;
  card.setAttribute('role', 'group');
  card.setAttribute('aria-label', 'Permission prompt for ' + payload.toolName);
  card.tabIndex = 0;

  var header = document.createElement('div');
  header.className = 'permission-prompt-header';
  var nameEl = document.createElement('span');
  nameEl.className = 'permission-prompt-tool';
  nameEl.textContent = payload.toolName;
  header.appendChild(nameEl);
  card.appendChild(header);

  var descEl = document.createElement('p');
  descEl.className = 'permission-prompt-description';
  descEl.textContent = payload.description;
  card.appendChild(descEl);

  if (payload.commandEcho) {
    var echo = document.createElement('pre');
    echo.className = 'permission-prompt-command';
    echo.textContent = payload.commandEcho;
    card.appendChild(echo);
  }

  var optionsEl = document.createElement('ol');
  optionsEl.className = 'permission-prompt-options';
  var byKey = {};
  var byAlias = {};

  for (var i = 0; i < payload.options.length; i += 1) {
    var opt = payload.options[i];
    var li = document.createElement('li');
    li.className = 'permission-prompt-option';
    li.dataset.optionKey = opt.key;
    li.dataset.optionValue = opt.value;

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'permission-prompt-button';
    btn.textContent = opt.key + ' - ' + opt.label;
    btn.dataset.optionValue = opt.value;
    li.appendChild(btn);

    optionsEl.appendChild(li);

    byKey[opt.key] = opt;
    for (var a = 0; a < opt.aliases.length; a += 1) {
      byAlias[opt.aliases[a].toLowerCase()] = opt;
    }
  }

  card.appendChild(optionsEl);

  var freeformWrap = document.createElement('div');
  freeformWrap.className = 'permission-prompt-freeform';
  freeformWrap.hidden = true;
  var freeformInput = document.createElement('textarea');
  freeformInput.className = 'permission-prompt-freeform-input';
  freeformInput.rows = 2;
  freeformInput.placeholder = 'Tell Gemma what to do instead...';
  freeformWrap.appendChild(freeformInput);
  card.appendChild(freeformWrap);

  var resolved = false;
  function resolve(value, freeformText) {
    if (resolved) return;
    resolved = true;
    document.removeEventListener('keydown', onKey, true);
    card.classList.add('permission-prompt-resolved');
    onResolve({ value: value, freeformText: freeformText });
  }

  function pickOption(opt) {
    if (opt.value === 'freeform') {
      freeformWrap.hidden = false;
      freeformInput.focus();
      return;
    }
    resolve(opt.value, undefined);
  }

  optionsEl.addEventListener('click', function (e) {
    var target = e.target;
    if (!target || target.tagName !== 'BUTTON') return;
    var value = target.dataset.optionValue;
    for (var k in byKey) {
      if (byKey[k].value === value) { pickOption(byKey[k]); return; }
    }
  });

  freeformInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      var text = freeformInput.value;
      resolve('freeform', text);
    }
  });

  function onKey(e) {
    if (resolved) return;
    var active = document.activeElement;
    var inFreeform = active === freeformInput;
    if (inFreeform) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      var no = byKey['3'];
      if (no) resolve(no.value, undefined);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      var yes = byKey['1'];
      if (yes) resolve(yes.value, undefined);
      return;
    }
    if (Object.prototype.hasOwnProperty.call(byKey, e.key)) {
      e.preventDefault();
      pickOption(byKey[e.key]);
      return;
    }
    var alias = byAlias[e.key.toLowerCase()];
    if (alias) {
      e.preventDefault();
      pickOption(alias);
    }
  }

  document.addEventListener('keydown', onKey, true);

  return card;
}
`;

export interface PermissionPromptOption {
  key: "1" | "2" | "3" | "4";
  label: string;
  value: "yes" | "yes-for-all" | "no" | "freeform";
  aliases: string[];
}

export interface PermissionPromptPayload {
  id: string;
  toolName: string;
  description: string;
  commandEcho: string | null;
  options: PermissionPromptOption[];
}

export interface PermissionPromptResolution {
  value: "yes" | "yes-for-all" | "no" | "freeform";
  freeformText?: string;
}

/**
 * Default 4-option layout (1 yes, 2 yes-for-all, 3 no, 4 freeform). Used by
 * ConfirmationGate.requestPrompt() to assemble the canonical UX.
 */
export function defaultPermissionOptions(toolName: string): PermissionPromptOption[] {
  return [
    { key: "1", label: "Yes", value: "yes", aliases: ["y"] },
    {
      key: "2",
      label: `Yes, allow ${toolName} for all projects`,
      value: "yes-for-all",
      aliases: ["a"],
    },
    { key: "3", label: "No", value: "no", aliases: ["n"] },
    {
      key: "4",
      label: "Tell Gemma what to do instead",
      value: "freeform",
      aliases: ["t"],
    },
  ];
}

/** Compile the runtime renderer against a host `document` (jsdom in tests). */
export function compilePermissionPrompt(
  documentRef: Document,
): (
  payload: PermissionPromptPayload,
  onResolve: (resolution: PermissionPromptResolution) => void,
) => HTMLElement {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  const factory = new Function(
    "document",
    `${PERMISSION_PROMPT_FN_SOURCE}\nreturn renderPermissionPrompt;`,
  );
  return factory(documentRef) as (
    payload: PermissionPromptPayload,
    onResolve: (resolution: PermissionPromptResolution) => void,
  ) => HTMLElement;
}
