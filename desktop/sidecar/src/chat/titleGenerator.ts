// v2.2.0 Phase 5 (5.3) -- name a chat from its first message.
//
// Every chat was literally called "New chat" (hardcoded in FolderTree), so a
// rail of ten conversations was ten identical rows. This asks the local model
// that is ALREADY loaded for a short title.
//
// Two constraints shape the design:
//
//   1. Never trigger a model switch just to name a chat. Titling is a
//      convenience; evicting the model a user is talking to in order to
//      produce a label would be absurd. If no model is resident, the caller
//      keeps the truncated-prompt fallback.
//   2. Never block the conversation. The caller shows the fallback title
//      immediately and applies a generated one only if it arrives.


/** Bounded so a slow or wedged model cannot hold a title request open. */
export const TITLE_TIMEOUT_MS = 5000;
const MAX_TITLE_CHARS = 60;
const FALLBACK_WORDS = 6;

export interface GenerateTitleInput {
  readonly chatId: string;
  readonly firstMessage: string;
  readonly modelId?: string;
}

export interface GenerateTitleResult {
  readonly title: string;
  readonly source: "model" | "fallback";
}

/**
 * Derive a title from the prompt itself. Used immediately on send, and as the
 * result whenever the model path is unavailable, slow, or unusable.
 */
export function fallbackTitle(firstMessage: string): string {
  const cleaned = firstMessage.replace(/\s+/g, " ").trim();
  if (!cleaned) return "New chat";
  const words = cleaned.split(" ").slice(0, FALLBACK_WORDS).join(" ");
  // The ellipsis counts toward the cap: slicing to the cap and THEN appending
  // it overshoots by three characters.
  return words.length > MAX_TITLE_CHARS
    ? `${words.slice(0, MAX_TITLE_CHARS - 3).trimEnd()}...`
    : words;
}

/**
 * Strip what small models habitually wrap around a title: surrounding quotes,
 * a "Title:" prefix, trailing punctuation, stray newlines. A raw model string
 * is not a title until this has run.
 */
export function sanitizeTitle(raw: string): string {
  let title = (raw ?? "").split(/\r?\n/)[0] ?? "";
  title = title.trim();
  title = title.replace(/^(title|chat title)\s*[:\-]\s*/i, "");
  title = title.replace(/^["'`*]+|["'`*]+$/g, "");
  title = title.replace(/[.,;:!?]+$/g, "");
  title = title.replace(/\s+/g, " ").trim();
  if (title.length > MAX_TITLE_CHARS) {
    title = `${title.slice(0, MAX_TITLE_CHARS - 3).trimEnd()}...`;
  }
  return title;
}

const PROMPT = (message: string): string =>
  "Give a short title (3 to 6 words) for a conversation that starts with the " +
  "message below. Reply with the title only, no quotes and no punctuation at " +
  `the end.\n\nMessage: ${message.slice(0, 500)}`;

export interface TitleModelPort {
  /** Ask the resident model. Resolves null when no model is available. */
  complete(prompt: string, modelId: string | undefined, signal: AbortSignal): Promise<string | null>;
}

/**
 * The slice of the handler context this module needs.
 *
 * Deliberately structural rather than importing `HandlerContext`: that type
 * lives in `handlers.ts`, whose import graph reaches a vscode-coupled logger,
 * and pulling it in here would make this module unloadable outside the editor
 * host (and would break every test that imports it).
 */
export interface TitleContext {
  chat?: unknown;
  titleModel?: TitleModelPort;
}

/**
 * Produce a title, degrading to the prompt-derived fallback on every failure
 * path: no model, timeout, empty answer, or an answer that sanitizes to
 * nothing usable.
 */
export async function generateChatTitle(
  input: GenerateTitleInput,
  ctx?: TitleContext,
  timeoutMs: number = TITLE_TIMEOUT_MS,
): Promise<GenerateTitleResult> {
  const fallback = fallbackTitle(input.firstMessage);
  const port = ctx?.titleModel ?? defaultTitleModel(ctx);
  if (!port) return { title: fallback, source: "fallback" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const raw = await port.complete(PROMPT(input.firstMessage), input.modelId, controller.signal);
    if (!raw) return { title: fallback, source: "fallback" };
    const title = sanitizeTitle(raw);
    // A model that answers with punctuation, an empty string, or a single
    // character has not produced a usable title.
    if (title.length < 2) return { title: fallback, source: "fallback" };
    return { title, source: "model" };
  } catch {
    // Timeout or transport failure: the fallback is already good enough.
    return { title: fallback, source: "fallback" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Build the production port from the handler context.
 *
 * Returns null when no chat runtime is available, which is what keeps titling
 * from ever forcing a model load.
 */
function defaultTitleModel(
  ctx?: TitleContext,
): TitleModelPort | null {
  const chat = ctx?.chat as unknown as
    | { completeOnce?: (prompt: string, modelId?: string) => Promise<string> }
    | undefined;
  const completeOnce = chat?.completeOnce;
  if (typeof completeOnce !== "function") return null;
  return {
    async complete(prompt, modelId, signal) {
      if (signal.aborted) return null;
      try {
        return await completeOnce(prompt, modelId);
      } catch {
        return null;
      }
    },
  };
}
