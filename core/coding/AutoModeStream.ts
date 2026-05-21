/**
 * v1.1.0 Phase 11.3 -- shared Auto-Mode streaming reducer.
 *
 * Auto mode (the existing tool-using session flow under
 * `AgentLoop._runAutoMode`) lives in the daemon; the extension and the
 * desktop module both subscribe to the streaming events via Phase 2.2's
 * channel and feed them through the same reducer to render the tool-call
 * cards.
 *
 * The desktop side already has a tool-call reducer at
 * `desktop/src/modules/coding/toolCallCard.ts`; this module mirrors the
 * shape from a `core/` location so the extension's webview can import it
 * without reaching into the desktop workspace. The two are kept byte-equal
 * by the Phase 11.9 parity tests.
 */

export type AutoModeEvent =
  | { kind: "token"; text: string }
  | { kind: "toolCallHeader"; callId: string; name: string }
  | { kind: "toolCallArgDelta"; callId: string; delta: string }
  | { kind: "toolCallComplete"; callId: string; result: string }
  | { kind: "done"; finishReason?: string };

export interface AutoModeToolCard {
  readonly callId: string;
  readonly name: string;
  readonly args: string;
  readonly result: string | null;
}

export interface AutoModeTurn {
  readonly text: string;
  readonly cards: readonly AutoModeToolCard[];
  readonly done: boolean;
  readonly finishReason: string | null;
}

export function emptyAutoModeTurn(): AutoModeTurn {
  return Object.freeze({
    text: "",
    cards: Object.freeze([] as readonly AutoModeToolCard[]),
    done: false,
    finishReason: null,
  });
}

export function applyAutoModeEvent(
  state: AutoModeTurn,
  event: AutoModeEvent,
): AutoModeTurn {
  switch (event.kind) {
    case "token":
      return Object.freeze({ ...state, text: state.text + event.text });
    case "toolCallHeader": {
      // Duplicate-header guard: if the daemon re-emits the same callId we
      // keep the existing card (a name change would be silently ignored).
      // This matches the desktop reducer's behaviour.
      if (state.cards.some((c) => c.callId === event.callId)) return state;
      const card: AutoModeToolCard = Object.freeze({
        callId: event.callId,
        name: event.name,
        args: "",
        result: null,
      });
      return Object.freeze({
        ...state,
        cards: Object.freeze([...state.cards, card]),
      });
    }
    case "toolCallArgDelta": {
      const cards = state.cards.map((c) =>
        c.callId === event.callId
          ? Object.freeze({ ...c, args: c.args + event.delta })
          : c,
      );
      return Object.freeze({ ...state, cards: Object.freeze(cards) });
    }
    case "toolCallComplete": {
      const cards = state.cards.map((c) =>
        c.callId === event.callId
          ? Object.freeze({ ...c, result: event.result })
          : c,
      );
      return Object.freeze({ ...state, cards: Object.freeze(cards) });
    }
    case "done":
      return Object.freeze({
        ...state,
        done: true,
        finishReason: event.finishReason ?? null,
      });
  }
}

export function applyAutoModeEvents(
  events: readonly AutoModeEvent[],
): AutoModeTurn {
  let state = emptyAutoModeTurn();
  for (const event of events) state = applyAutoModeEvent(state, event);
  return state;
}

/**
 * Compact summary of a folded turn used by the Phase 11.9 parity snapshot.
 * Two folds are byte-equal when their summaries are equal.
 */
export function summarizeAutoModeTurn(state: AutoModeTurn): string {
  const cards = state.cards
    .map(
      (c) =>
        `${c.callId}:${c.name}:${c.args}:${c.result === null ? "<pending>" : c.result}`,
    )
    .join("|");
  return [
    `text=${state.text}`,
    `cards=${cards}`,
    `done=${state.done}`,
    `finish=${state.finishReason ?? ""}`,
  ].join(";");
}
