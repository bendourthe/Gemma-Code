/**
 * v2.2.0 Phase 5 -- chat persistence IPC ops (5.1) and auto-titling (5.3).
 *
 * Every case runs against an in-memory store, so nothing here touches the
 * developer's real ~/.nexus/chat/explorer.db.
 *
 * Lives in the ROOT suite, not desktop/tests: `ChatExplorerStore` reaches a
 * vscode-coupled logger through `src/storage/dbPermissions`, which the desktop
 * (browser-ish) test environment cannot resolve.
 */

import { describe, expect, it, vi } from "vitest";

import { ChatExplorerStore } from "../../../modules/chat/storage/ChatExplorerStore";
import { createChatExplorerOps } from "../../../desktop/sidecar/src/chat/explorerRuntime";
import {
  fallbackTitle,
  generateChatTitle,
  sanitizeTitle,
  type TitleModelPort,
} from "../../../desktop/sidecar/src/chat/titleGenerator";

function ops() {
  const store = new ChatExplorerStore(":memory:");
  return { ops: createChatExplorerOps({ store, dbPath: ":memory:" }), store };
}

describe("chat.explorer ops", () => {
  it("creates a chat at the root with no folder required", () => {
    const { ops: o, store } = ops();
    const chat = o.createChat({
      folderId: null,
      title: "New chat",
      modelId: "gemma4:e4b",
    });
    expect(chat.folderId).toBeNull();
    expect(o.tree().tree.chats.map((c) => c.id)).toContain(chat.id);
    store.close();
  });

  it("round-trips messages through append and list", () => {
    const { ops: o, store } = ops();
    const chat = o.createChat({ folderId: null, title: "t", modelId: "m" });
    o.appendMessage({ chatId: chat.id, role: "user", content: "hello" });
    o.appendMessage({ chatId: chat.id, role: "assistant", content: "hi" });
    expect(
      o.listMessages({ chatId: chat.id }).messages.map((m) => m.content),
    ).toEqual(["hello", "hi"]);
    store.close();
  });

  it("distinguishes a machine rename from a user rename", () => {
    const { ops: o, store } = ops();
    const chat = o.createChat({
      folderId: null,
      title: "New chat",
      modelId: "m",
    });

    // Auto-title path: must NOT pin the title.
    const auto = o.renameChat({ id: chat.id, title: "Generated" });
    expect(auto.userRenamed).toBe(false);

    // User path: pins it.
    const manual = o.renameChat({ id: chat.id, title: "Mine", byUser: true });
    expect(manual.userRenamed).toBe(true);
    store.close();
  });

  it("persists a persona per chat", () => {
    const { ops: o, store } = ops();
    const chat = o.createChat({ folderId: null, title: "t", modelId: "m" });
    o.setPersona({ id: chat.id, persona: "Be brief." });
    const found = o.tree().tree.chats.find((c) => c.id === chat.id);
    expect(found?.persona).toBe("Be brief.");
    store.close();
  });

  it("organises chats into folders and moves them back to the root", () => {
    const { ops: o, store } = ops();
    const project = o.createFolder({ parentId: null, name: "Project" });
    const chat = o.createChat({ folderId: null, title: "t", modelId: "m" });
    expect(o.moveChat({ id: chat.id, folderId: project.id }).folderId).toBe(
      project.id,
    );
    expect(o.moveChat({ id: chat.id, folderId: null }).folderId).toBeNull();
    store.close();
  });

  it("searches chats by title", () => {
    const { ops: o, store } = ops();
    o.createChat({
      folderId: null,
      title: "Refactor the parser",
      modelId: "m",
    });
    o.createChat({ folderId: null, title: "Holiday plans", modelId: "m" });
    const hits = o.search({ query: "parser" });
    expect(hits.hits.length).toBeGreaterThan(0);
    store.close();
  });
});

describe("fallbackTitle", () => {
  it("takes the first few words of the prompt", () => {
    expect(
      fallbackTitle("Help me refactor the parser module for clarity please"),
    ).toBe("Help me refactor the parser module");
  });

  it("collapses whitespace and newlines", () => {
    expect(fallbackTitle("  hello\n\n  world  ")).toBe("hello world");
  });

  it("falls back to New chat for an empty prompt", () => {
    expect(fallbackTitle("   ")).toBe("New session");
  });
});

describe("sanitizeTitle", () => {
  it("strips the wrappers small models add", () => {
    expect(sanitizeTitle('"Refactor the parser"')).toBe("Refactor the parser");
    expect(sanitizeTitle("Title: Refactor the parser")).toBe(
      "Refactor the parser",
    );
    expect(sanitizeTitle("Refactor the parser.")).toBe("Refactor the parser");
    expect(sanitizeTitle("**Refactor the parser**")).toBe(
      "Refactor the parser",
    );
  });

  it("keeps only the first line", () => {
    expect(sanitizeTitle("Refactor the parser\nHere is why...")).toBe(
      "Refactor the parser",
    );
  });

  it("caps an over-long title, ellipsis included", () => {
    // Regression: slicing to the cap and then appending "..." overshot it.
    const long = "word ".repeat(40);
    const title = sanitizeTitle(long);
    expect(title.length).toBeLessThanOrEqual(60);
    expect(title.endsWith("...")).toBe(true);
  });

  it("caps an over-long fallback title too", () => {
    const long = "supercalifragilistic ".repeat(10);
    expect(fallbackTitle(long).length).toBeLessThanOrEqual(60);
  });
});

describe("generateChatTitle", () => {
  const input = {
    chatId: "c1",
    firstMessage: "Help me refactor the parser module",
  };

  it("uses the model's answer when it is usable", async () => {
    const titleModel: TitleModelPort = {
      complete: async () => '"Parser refactor plan"',
    };
    const result = await generateChatTitle(input, { titleModel } as never);
    expect(result).toEqual({ title: "Parser refactor plan", source: "model" });
  });

  it("falls back when no model is available (never forces a load)", async () => {
    // The core constraint: titling must not trigger a model switch.
    const result = await generateChatTitle(input, {} as never);
    expect(result.source).toBe("fallback");
    expect(result.title).toBe("Help me refactor the parser module");
  });

  it("falls back when the model returns nothing", async () => {
    const titleModel: TitleModelPort = { complete: async () => null };
    expect(
      (await generateChatTitle(input, { titleModel } as never)).source,
    ).toBe("fallback");
  });

  it("falls back when the answer sanitizes to nothing usable", async () => {
    const titleModel: TitleModelPort = { complete: async () => "!!!" };
    const result = await generateChatTitle(input, { titleModel } as never);
    expect(result.source).toBe("fallback");
  });

  it("falls back when the model times out", async () => {
    const titleModel: TitleModelPort = {
      complete: (_p, _m, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    };
    const result = await generateChatTitle(input, { titleModel } as never, 20);
    expect(result.source).toBe("fallback");
  });

  it("falls back when the model throws", async () => {
    const titleModel: TitleModelPort = {
      complete: async () => {
        throw new Error("model exploded");
      },
    };
    expect(
      (await generateChatTitle(input, { titleModel } as never)).source,
    ).toBe("fallback");
  });

  it("does not pass the whole conversation to the titling prompt", async () => {
    const complete = vi.fn(
      async (_prompt: string, _modelId?: string, _signal?: AbortSignal) =>
        "A title",
    );
    const huge = "x".repeat(5000);
    await generateChatTitle({ chatId: "c", firstMessage: huge }, {
      titleModel: { complete },
    } as never);
    const prompt = String(complete.mock.calls[0]?.[0] ?? "");
    // Titling is a cheap side request; it must not become a large prompt.
    expect(prompt.length).toBeLessThan(1000);
  });
});
