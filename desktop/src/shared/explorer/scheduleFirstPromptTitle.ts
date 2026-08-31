/**
 * v2.4.2 Phase 2 -- name a new session from the first prompt without using
 * the 45-character prompt slice as the durable title.
 *
 * Immediate rename uses `fallbackTitle` (about 6 words). A later model title
 * may replace it unless the user already renamed.
 */

import { fallbackTitle } from "../../../sidecar/src/chat/titleGenerator";
import { ipc } from "../../lib/ipc";

export const DEFAULT_SESSION_TITLE = "New chat";

export function isUntitledSession(
  title: string | null | undefined,
  userRenamed?: boolean,
): boolean {
  return userRenamed !== true && (title ?? DEFAULT_SESSION_TITLE) === DEFAULT_SESSION_TITLE;
}

export async function applyImmediateFallbackTitle(opts: {
  readonly sessionId: string;
  readonly prompt: string;
  readonly userRenamed?: boolean;
  readonly currentTitle?: string;
  readonly rename: (id: string, title: string, byUser?: boolean) => unknown;
}): Promise<string> {
  if (!isUntitledSession(opts.currentTitle ?? DEFAULT_SESSION_TITLE, opts.userRenamed)) {
    return opts.currentTitle ?? DEFAULT_SESSION_TITLE;
  }
  const immediate = fallbackTitle(opts.prompt);
  if (immediate === DEFAULT_SESSION_TITLE) return immediate;
  await Promise.resolve(opts.rename(opts.sessionId, immediate, false)).catch(() => undefined);
  return immediate;
}

export async function refineGeneratedTitle(opts: {
  readonly sessionId: string;
  readonly prompt: string;
  readonly userRenamed?: boolean;
  readonly rename: (id: string, title: string, byUser?: boolean) => unknown;
  readonly generateTitle?: (
    id: string,
    prompt: string,
  ) => Promise<{ title: string } | null | undefined>;
  readonly isStillAutoTitle?: () => Promise<boolean> | boolean;
}): Promise<void> {
  if (opts.userRenamed === true) return;
  const generate =
    opts.generateTitle ??
    (async (id: string, prompt: string) => {
      const reply = await ipc.call<{ title: string }>("chat.generateTitle", {
        chatId: id,
        firstMessage: prompt,
      });
      return reply.ok ? reply.value : null;
    });
  try {
    const result = await generate(opts.sessionId, opts.prompt);
    if (!result?.title) return;
    const stillAuto = opts.isStillAutoTitle ? await opts.isStillAutoTitle() : true;
    if (!stillAuto) return;
    await Promise.resolve(opts.rename(opts.sessionId, result.title, false)).catch(() => undefined);
  } catch {
    // Titling is a convenience.
  }
}
