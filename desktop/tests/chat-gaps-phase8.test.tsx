/**
 * v2.2.0 Phase 8 -- known-gap closures in the chat module.
 *
 * DF-12: the module appeared to require a folder before it would let you talk.
 * DF-13: the title generator shipped in Phase 5 but nothing ever called it.
 */

import { readFileSync } from "node:fs";
import * as path from "node:path";

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { FolderTree } from "../src/modules/chat/FolderTree";
import { InMemoryChatExplorerClient } from "../src/modules/chat/chatExplorerClient";

describe("DF-12: chats do not require a folder", () => {
  it("the empty state starts a chat, not a folder", async () => {
    const user = userEvent.setup();
    const client = new InMemoryChatExplorerClient();
    render(<FolderTree client={client} />);

    await user.click(screen.getByTestId("folder-tree-empty-cta"));

    const tree = client.listTree();
    // A chat at the root, and no folder was created to hold it.
    expect(tree.chats.length).toBe(1);
    expect(tree.children.length).toBe(0);
  });

  it("the store has always accepted a root chat", () => {
    const client = new InMemoryChatExplorerClient();
    const chat = client.createChat({ folderId: null, title: "New chat", modelId: "m" });
    // Only the button insisted on a folder; this path was never blocked.
    expect(chat.folderId).toBeNull();
  });
});

describe("DF-13: first message names the chat", () => {
  const source = readFileSync(
    path.resolve(__dirname, "../src/modules/chat/ChatPage.tsx"),
    "utf8",
  );

  it("calls generateTitle from the send path", () => {
    expect(source).toContain(".generateTitle(chat.id, prompt)");
  });

  it("only fires on the first message of a still-default chat", () => {
    // Re-titling on every send, or re-titling a chat the user named, would
    // fight the user's own rename.
    expect(source).toContain("chat.messageCount === 0");
    expect(source).toContain('chat.title === "New chat"');
  });

  it("survives a titling failure instead of failing the send", () => {
    expect(source).toContain(".catch(() => undefined)");
  });

  it("treats titling as an optional client capability", async () => {
    // The in-memory client has no model, so it must not claim to title.
    const client = new InMemoryChatExplorerClient() as unknown as {
      generateTitle?: unknown;
    };
    expect(client.generateTitle).toBeUndefined();
  });

  it("refreshes the rail so the new name is visible", async () => {
    const client = new InMemoryChatExplorerClient();
    client.createChat({ folderId: null, title: "New chat", modelId: "m" });
    const { rerender } = render(<FolderTree client={client} refreshToken={0} />);
    expect(screen.getByText("New chat")).toBeTruthy();

    const chat = client.listTree().chats[0];
    client.renameChat(chat.id, "Renamed elsewhere");
    // Without the token the rail keeps a stale row: the rename happened in
    // the message pane, not in the tree.
    rerender(<FolderTree client={client} refreshToken={1} />);
    expect(screen.getByText("Renamed elsewhere")).toBeTruthy();
  });
});

describe("DF-orphans: components this cycle retired are gone", () => {
  it.each(["src/components/LocalModelStatusDock.tsx", "src/pages/ModulePlaceholder.tsx"])(
    "%s no longer exists",
    (rel) => {
      expect(() => readFileSync(path.resolve(__dirname, "..", rel), "utf8")).toThrow();
    },
  );

  it("nothing imports them", () => {
    const app = readFileSync(path.resolve(__dirname, "../src/App.tsx"), "utf8");
    expect(app).not.toContain("LocalModelStatusDock");
    expect(app).not.toContain("ModulePlaceholder");
  });
});

// Keeps vi imported for parity with the rest of the desktop suite setup.
void vi;
