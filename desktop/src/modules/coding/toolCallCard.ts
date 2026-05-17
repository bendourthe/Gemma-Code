// Tool-call rendering state machine for the desktop Coding module. The
// sidecar emits a stream of `CodingSessionEvent` records; this reducer folds
// them into per-call card descriptors that the UI renders. The reducer is
// pure so it is straightforward to unit-test against canned event sequences.

export type StreamEvent =
  | { kind: "token"; text: string }
  | { kind: "toolCallHeader"; callId: string; name: string }
  | { kind: "toolCallArgDelta"; callId: string; delta: string }
  | { kind: "toolCallComplete"; callId: string; result: string }
  | { kind: "done"; finishReason?: string };

export interface ToolCallCard {
  callId: string;
  name: string;
  args: string;
  result: string | null;
}

export interface RenderedTurn {
  text: string;
  cards: ToolCallCard[];
  done: boolean;
  finishReason?: string;
}

export function emptyTurn(): RenderedTurn {
  return { text: "", cards: [], done: false };
}

export function applyEvent(state: RenderedTurn, e: StreamEvent): RenderedTurn {
  switch (e.kind) {
    case "token":
      return { ...state, text: state.text + e.text };
    case "toolCallHeader":
      return {
        ...state,
        cards: [
          ...state.cards,
          { callId: e.callId, name: e.name, args: "", result: null },
        ],
      };
    case "toolCallArgDelta": {
      const cards = state.cards.map((c) =>
        c.callId === e.callId ? { ...c, args: c.args + e.delta } : c,
      );
      return { ...state, cards };
    }
    case "toolCallComplete": {
      const cards = state.cards.map((c) =>
        c.callId === e.callId ? { ...c, result: e.result } : c,
      );
      return { ...state, cards };
    }
    case "done":
      return { ...state, done: true, finishReason: e.finishReason };
  }
}

export function applyEvents(events: readonly StreamEvent[]): RenderedTurn {
  let state = emptyTurn();
  for (const e of events) state = applyEvent(state, e);
  return state;
}
